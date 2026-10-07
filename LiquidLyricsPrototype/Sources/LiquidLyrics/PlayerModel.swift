import SwiftUI
import UniformTypeIdentifiers

@MainActor @Observable final class PlayerModel {
    var queue: [PlaybackTrack] = []
    var track: PlaybackTrack?
    var position = 0.0
    var isPlaying = false
    var isSeeking = false
    var document: LyricsDocument?
    var artwork: NSImage?
    var tint: Color = .teal
    var albumHue = 0.48
    var albumSecondaryHue = 0.56
    var status = "正在连接网易云音乐…"
    var lyricsStatus = "等待歌曲"
    var actionError: String?
    var canControl = false
    var canSeek = false
    var demoMode = false
    var following = true
    var rotationElapsed = 0.0
    var playbackStarted: Date?
    @ObservationIgnored private var provider: any PlaybackProvider = NetEasePlaybackProvider()
    @ObservationIgnored private let service = LyricsService()
    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    @ObservationIgnored private var lyricsTask: Task<Void, Never>?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var clockTask: Task<Void, Never>?
    @ObservationIgnored private var latest = PlaybackSnapshot()
    @ObservationIgnored private var commandPending = false
    @ObservationIgnored private var statusUntil = Date.distantPast
    func start() {
        guard playbackTask == nil else { return }
        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if !demoMode {
                    let snapshot = await provider.snapshot()
                    if !demoMode { receive(snapshot) }
                }
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            }
        }
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if !isSeeking { position = latest.elapsed(at: Date()) }
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
    }
    func stop() { playbackTask?.cancel(); clockTask?.cancel(); lyricsTask?.cancel(); artworkTask?.cancel(); provider.stop() }
    private func receive(_ snapshot: PlaybackSnapshot) {
        let changed = track?.identity != snapshot.track?.identity
        let wasPlaying = isPlaying
        if wasPlaying != snapshot.playing {
            if let start = playbackStarted { rotationElapsed += Date().timeIntervalSince(start) }
            playbackStarted = snapshot.playing ? Date() : nil
        }
        latest = snapshot
        isPlaying = snapshot.playing
        canControl = snapshot.canControl
        canSeek = snapshot.canSeek
        if !commandPending, Date() >= statusUntil { status = snapshot.message }
        track = snapshot.track
        if changed {
            rotationElapsed = 0
            playbackStarted = isPlaying ? Date() : nil
            document = nil; artwork = nil; tint = .teal; following = true
            lyricsTask?.cancel(); artworkTask?.cancel()
            reloadLyrics()
            loadArtwork(snapshot)
        } else if artwork == nil { loadArtwork(snapshot) }
    }
    func angle(at date: Date) -> Double { (rotationElapsed + (playbackStarted.map { date.timeIntervalSince($0) } ?? 0)) * 18 }
    func refreshQueue() {
        guard let source = provider as? any QueuePlaybackProvider else { return }
        Task { queue = await source.playbackQueue() }
    }
    func changeMode(_ mode: PlaybackMode) {
        guard !commandPending, let source = provider as? any QueuePlaybackProvider else { return }
        commandPending = true
        Task {
            defer { commandPending = false }
            do {
                try await source.setPlaybackMode(mode)
                actionError = "已发送“\(mode.rawValue)”指令，请以网易云实际状态为准"
            } catch { actionError = error.localizedDescription }
        }
    }
    func toggle() { command(.toggle) }
    func skip(_ delta: Int) { command(delta < 0 ? .previous : .next) }
    func seek(_ seconds: Double) { command(.seek(max(0, min(track?.duration ?? 0, seconds)))) }
    func seek(line: LyricLine, offset: Double) { seek(line.start - offset - (document?.offset ?? 0)); following = true }
    private func command(_ command: PlaybackCommand) {
        guard !commandPending else { return }
        if demoMode {
            latest.position = position; latest.capturedAt = Date()
            switch command {
            case .toggle: latest.playing.toggle()
            case .seek(let value): latest.position = value
            case .next, .previous: latest.position = 0
            }
            receive(latest); return
        }
        actionError = nil
        commandPending = true
        Task {
            defer { commandPending = false }
            do { try await provider.send(command); status = "已发送控制，等待网易云确认" }
            catch { status = error.localizedDescription; actionError = error.localizedDescription }
            statusUntil = Date().addingTimeInterval(4)
        }
    }
    func reloadLyrics(refresh: Bool = false) {
        lyricsTask?.cancel()
        guard let track else { document = nil; lyricsStatus = "在网易云播放一首歌"; return }
        guard !demoMode else { return }
        lyricsStatus = "正在查找歌词…"
        let identity = track.identity
        lyricsTask = Task {
            do {
                let result = try await service.lyrics(for: track, refresh: refresh)
                try Task.checkCancellation()
                guard self.track?.identity == identity else { return }
                document = result
                lyricsStatus = result?.source ?? "暂无匹配歌词，可在设置中导入 LRC"
            } catch is CancellationError {} catch {
                if self.track?.identity == identity { lyricsStatus = error.localizedDescription }
            }
        }
    }
    func importLRC() {
        guard let track else { status = "先播放歌曲，再导入对应歌词"; return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "lrc") ?? .plainText]
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url,
              let text = try? String(contentsOf: url, encoding: .utf8), let parsed = LyricsParser.lrc(text, source: "本地 LRC") else { return }
        document = parsed; lyricsStatus = "本地 LRC · 手动选择"; following = true
        lyricsTask?.cancel()
        let safe = "\(track.artist) - \(track.title)".replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        try? FileManager.default.createDirectory(at: LocalLyricsProvider.folder, withIntermediateDirectories: true)
        try? Data(text.utf8).write(to: LocalLyricsProvider.folder.appendingPathComponent(safe + ".lrc"), options: .atomic)
    }
    private func loadArtwork(_ snapshot: PlaybackSnapshot) {
        if let data = snapshot.artwork { applyArtwork(data); return }
        guard artworkTask == nil || artworkTask?.isCancelled == true, let url = snapshot.track?.artworkURL else { return }
        let identity = snapshot.track?.identity
        artworkTask = Task {
            var request = URLRequest(url: url); request.timeoutInterval = 8
            if let (data, _) = try? await URLSession.shared.data(for: request), !Task.isCancelled, track?.identity == identity, data.count < 8_000_000 { applyArtwork(data) }
        }
    }
    private func applyArtwork(_ data: Data) {
        guard let image = NSImage(data: data) else { return }
        artwork = image
        // Sample only when artwork changes, not on the playback/animation clock.
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 16, pixelsHigh: 16, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 64, bitsPerPixel: 32),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return }
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
        image.draw(in: NSRect(x: 0, y: 0, width: 16, height: 16))
        NSGraphicsContext.restoreGraphicsState()
        var weights = Array(repeating: 0.0, count: 24)
        for y in 0..<16 {
            for x in 0..<16 {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                      color.alphaComponent > 0.5, color.saturationComponent > 0.12,
                      color.brightnessComponent > 0.12 else { continue }
                let bucket = min(23, Int(color.hueComponent * 24))
                weights[bucket] += color.saturationComponent * color.brightnessComponent
            }
        }
        let ranked = weights.indices.sorted { weights[$0] > weights[$1] }
        if let first = ranked.first, weights[first] > 0 {
            albumHue = (Double(first) + 0.5) / 24
            let second = ranked.first { index in
                let distance = abs(index - first)
                return min(distance, 24 - distance) >= 3 && weights[index] > 0
            } ?? first
            albumSecondaryHue = (Double(second) + 0.5) / 24
        } else { albumHue = 0.58; albumSecondaryHue = 0.58 }
        tint = Color(hue: albumHue, saturation: 0.48, brightness: 0.62)
    }
    func setDemo(_ enabled: Bool) {
        demoMode = enabled
        lyricsTask?.cancel(); artworkTask?.cancel(); artworkTask = nil
        if enabled {
            let demo = PlaybackTrack(id: "demo", title: "晚风来信", artist: "林间电台 · 演示", duration: 192)
            receive(.init(track: demo, position: 20, message: "演示模式 · 不播放音频", canControl: true, canSeek: true))
            let lines = ["把城市的灯留在身后","让晚风慢慢经过耳朵","这一刻不必急着往前走","月光会陪你停留","沿着安静的街口","拾起一颗散落的星球","把未说完的话交给夜色","明天再慢慢问候"]
            document = LyricsParser.yrc(lines.enumerated().map { i, text in
                "[\(i * 24000),24000]" + text.enumerated().map { j, ch in "(\(i * 24000 + j * 700),700,0)\(ch)" }.joined()
            }.joined(separator: "\n"), source: "演示 YRC")
            lyricsStatus = "演示 YRC"
        } else { receive(.init(message: "正在连接网易云音乐…")) }
    }
    static func time(_ value: Double) -> String { String(format: "%d:%02d", Int(max(0,value)) / 60, Int(max(0,value)) % 60) }
}
