import AppKit
@preconcurrency import ApplicationServices

actor LocalPlaybackReader {
    private var reader: NetEaseLastPlayingReader?
    private var base: URL?
    func read() -> (NetEaseLastPlayingState, PlaybackTrack)? {
        if base == nil {
            let home = FileManager.default.homeDirectoryForCurrentUser
            base = ["Library/Application Support/com.netease.163music", "Library/Containers/com.netease.163music/Data"]
                .map { home.appendingPathComponent($0) }
                .first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("Documents/storage").path) }
            if let base { reader = NetEaseLastPlayingReader(containerURL: base) }
        }
        guard let base, let state = reader?.read(), let id = state.songID else { return nil }
        let queue = base.appendingPathComponent("Documents/storage/file_storage/webdata/file/playingList")
        guard let data = try? Data(contentsOf: queue), data.count < 30_000_000,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["list"] as? [[String: Any]],
              let entry = list.first(where: { String(describing: $0["id"] ?? "") == id }),
              let track = entry["track"] as? [String: Any], let title = track["name"] as? String else { return nil }
        let artists = (track["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
        let album = track["album"] as? [String: Any] ?? [:]
        let duration = state.resourceDuration ?? ((track["duration"] as? Double ?? 0) / 1000)
        var artwork = (album["picUrl"] as? String).flatMap(URL.init(string:))
        if var components = artwork.flatMap({ URLComponents(url: $0, resolvingAgainstBaseURL: false) }), components.scheme == "http" {
            components.scheme = "https"; artwork = components.url
        }
        return (state, PlaybackTrack(id: id, title: title, artist: artists, album: album["name"] as? String ?? "", duration: duration, artworkURL: artwork))
    }
    func queueTracks() -> [PlaybackTrack] {
        _ = read()
        guard let base,
              let data = try? Data(contentsOf: base.appendingPathComponent("Documents/storage/file_storage/webdata/file/playingList")), data.count < 30_000_000,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["list"] as? [[String: Any]] else { return [] }
        return list.compactMap { entry in
            guard let track = entry["track"] as? [String: Any], let title = track["name"] as? String else { return nil }
            let artists = (track["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
            return PlaybackTrack(id: String(describing: entry["id"] ?? ""), title: title, artist: artists, duration: (track["duration"] as? Double ?? 0) / 1000)
        }
    }
    func reset() { reader?.reset() }
}

@MainActor final class NetEasePlaybackProvider: QueuePlaybackProvider {
    static let bundleID = "com.netease.163music"
    private let local = LocalPlaybackReader()
    private let remote = MediaRemoteClient()
    private let audio = CoreAudioPlaybackActivity()
    private let accessibility = NetEaseControls()
    private var estimator = NetEaseProgressEstimator()
    private var lastRemote: RemoteState?
    private var nextRemote = Date.distantPast
    private var hadLocalState = false
    private var current: PlaybackSnapshot = .init()
    func snapshot() async -> PlaybackSnapshot {
        guard let application = NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).first else {
            current = .init(message: "打开网易云音乐并播放一首歌")
            estimator = .init()
            return current
        }
        // Probe remote metadata at a low rate. The UI interpolates timestamps between samples.
        if Date() >= nextRemote {
            lastRemote = await remote.snapshot()
            nextRemote = Date().addingTimeInterval(0.5)
        }
        let localState = await local.read()
        hadLocalState = localState != nil
        let ownedRemote = lastRemote?.bundleIdentifier == Self.bundleID ? lastRemote : nil
        if let (state, track) = localState {
            if let remote = ownedRemote,
               TrackMatcher.normalized(remote.title) == TrackMatcher.normalized(track.title),
               abs((remote.durationMicros ?? 0) / 1_000_000 - track.duration) <= 3 {
                current = remote.snapshot
                current.track = track
                current.message = "网易云 · 系统时钟 / 本地歌曲信息"
                return current
            }
            let audible = audio.isRunningOutput(bundleIdentifier: Self.bundleID, processIdentifiers: [application.processIdentifier])
            let playing = audible ?? ownedRemote?.playing ?? false
            let position = estimator.update(songID: track.id, duration: track.duration, exactProgress: state.current, isPlaying: playing, now: Date())
            let sameRemote = ownedRemote.map { TrackMatcher.normalized($0.title) == TrackMatcher.normalized(track.title) } ?? false
            current = .init(track: track, position: position, playing: playing,
                            artwork: sameRemote ? ownedRemote?.artworkData.flatMap { Data(base64Encoded: $0) } : nil,
                            message: "网易云 · 本地同步", canControl: AXIsProcessTrusted() || ownedRemote != nil,
                            canSeek: ownedRemote != nil || accessibility.hasSeekControl(pid: application.processIdentifier))
        } else if let ownedRemote { current = ownedRemote.snapshot }
        else { current = .init(message: "等待网易云播放信息；请在网易云播放一首歌") }
        return current
    }
    func send(_ command: PlaybackCommand) async throws {
        guard let application = NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).first else {
            throw CompanionError.unavailable("网易云音乐尚未运行")
        }
        if let latest = await remote.snapshot(), latest.bundleIdentifier == Self.bundleID {
            try await remote.send(command)
        } else {
            try accessibility.send(command, pid: application.processIdentifier, duration: current.track?.duration ?? 0)
        }
        nextRemote = .distantPast
        if case .seek = command { estimator = .init() }
    }
    func playbackQueue() async -> [PlaybackTrack] { await local.queueTracks() }
    func setPlaybackMode(_ mode: PlaybackMode) async throws {
        guard let latest = await remote.snapshot(), latest.bundleIdentifier == Self.bundleID else {
            throw CompanionError.unavailable("请先在网易云播放歌曲，再调整播放方式")
        }
        _ = try await remote.run(["shuffle", mode == .shuffle ? "3" : "1"])
        _ = try await remote.run(["repeat", mode == .repeatOne ? "2" : (mode == .repeatAll || mode == .shuffle ? "3" : "1")])
    }
    func stop() {}
}

@MainActor final class NetEaseControls {
    private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    private func find(pid: pid_t, predicate: (AXUIElement) -> Bool) -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }
        let root = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(root, 0.2)
        var queue = [root], index = 0
        // Bounded traversal prevents hangs when a Chromium tree changes during inspection.
        while index < queue.count, index < 1200 {
            let item = queue[index]; index += 1
            if predicate(item) { return item }
            if let children = attribute(item, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children) }
        }
        return nil
    }
    private func seekControl(pid: pid_t) -> AXUIElement? {
        find(pid: pid) { item in
            guard attribute(item, kAXRoleAttribute) as? String == kAXSliderRole else { return false }
            let labels = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].compactMap { attribute(item, $0) as? String }.joined(separator: " ").lowercased()
            var settable: DarwinBoolean = false
            AXUIElementIsAttributeSettable(item, kAXValueAttribute as CFString, &settable)
            return settable.boolValue && ["进度", "progress", "播放位置", "seek"].contains { labels.contains($0) }
        }
    }
    func hasSeekControl(pid: pid_t) -> Bool { seekControl(pid: pid) != nil }
    func send(_ command: PlaybackCommand, pid: pid_t, duration: Double) throws {
        guard AXIsProcessTrusted() else { throw CompanionError.unavailable("请在设置中授予辅助功能权限以控制网易云") }
        if case .seek(let seconds) = command {
            guard duration > 0, let slider = seekControl(pid: pid),
                  let min = attribute(slider, kAXMinValueAttribute) as? NSNumber,
                  let max = attribute(slider, kAXMaxValueAttribute) as? NSNumber else {
                throw CompanionError.unavailable("此版网易云没有公开可写进度控件，暂不支持跳转")
            }
            let value = min.doubleValue + (max.doubleValue - min.doubleValue) * Swift.max(0, Swift.min(1, seconds / duration))
            guard AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, NSNumber(value: value)) == .success else {
                throw CompanionError.unavailable("网易云未接受进度调整")
            }
            return
        }
        let titles: Set<String>
        switch command {
        case .toggle: titles = ["播放", "暂停", "Play", "Pause"]
        case .previous: titles = ["上一个", "上一首", "Previous"]
        case .next: titles = ["下一个", "下一首", "Next"]
        case .seek: return
        }
        guard let item = find(pid: pid, predicate: { item in
            attribute(item, kAXRoleAttribute) as? String == kAXMenuItemRole && titles.contains(attribute(item, kAXTitleAttribute) as? String ?? "")
        }), AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else {
            throw CompanionError.unavailable("未找到网易云播放菜单，请检查客户端版本")
        }
    }
    static func requestPermission() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }
}
