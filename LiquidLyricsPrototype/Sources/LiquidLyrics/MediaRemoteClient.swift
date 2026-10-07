import Foundation

// All private API work runs in the pinned BSD helper, outside the UI process.
actor MediaRemoteClient {
    private var failed = false
    private var base: URL { Bundle.main.resourceURL!.appendingPathComponent("MediaRemote") }
    func run(_ arguments: [String]) async throws -> Data {
        guard !failed else { throw CompanionError.unavailable("系统播放接口已停止，请重新启动应用") }
        let script = base.appendingPathComponent("mediaremote-adapter.pl")
        guard FileManager.default.fileExists(atPath: script.path) else { throw CompanionError.unavailable("缺少播放辅助组件，请使用 run.sh 构建") }
        let framework = base.appendingPathComponent("MediaRemoteAdapter.framework")
        do { return try await Task.detached(priority: .utility) {
            let process = Process()
            let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
            process.arguments = [script.path, framework.path] + arguments
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 4, execute: timeout)
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            timeout.cancel()
            guard process.terminationStatus == 0 else { throw CompanionError.unavailable("系统播放接口调用失败") }
            return data
        }.value
        } catch { failed = true; throw error }
    }
    func snapshot() async -> RemoteState? {
        do {
            let data = try await run(["get", "--micros"])
            return try JSONDecoder().decode(RemoteState?.self, from: data)
        } catch { return nil }
    }
    func send(_ command: PlaybackCommand) async throws {
        switch command {
        case .toggle: _ = try await run(["send","2"])
        case .previous: _ = try await run(["send","5"])
        case .next: _ = try await run(["send","4"])
        case .seek(let seconds): _ = try await run(["seek",String(Int64(seconds * 1_000_000))])
        }
    }
}
struct RemoteState: Decodable, Sendable {
    var bundleIdentifier: String
    var playing: Bool
    var title: String
    var artist: String?
    var album: String?
    var durationMicros: Double?
    var elapsedTimeMicros: Double?
    var timestampEpochMicros: Double?
    var playbackRate: Double?
    var artworkData: String?
    var uniqueIdentifier: String?
    var snapshot: PlaybackSnapshot {
        let track = PlaybackTrack(id: uniqueIdentifier ?? "", title: title, artist: artist ?? "", album: album ?? "", duration: (durationMicros ?? 0) / 1_000_000)
        return PlaybackSnapshot(track: track, position: (elapsedTimeMicros ?? 0) / 1_000_000, playing: playing,
            rate: playbackRate ?? 1, capturedAt: timestampEpochMicros.map { Date(timeIntervalSince1970: $0 / 1_000_000) } ?? Date(),
            artwork: artworkData.flatMap { Data(base64Encoded: $0) }, message: "系统播放信息", canControl: true, canSeek: true)
    }
}
