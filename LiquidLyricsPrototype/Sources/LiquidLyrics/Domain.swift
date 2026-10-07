import Foundation

struct PlaybackTrack: Codable, Equatable, Sendable {
    var id: String
    var title: String
    var artist: String
    var album: String = ""
    var duration: Double
    var artworkURL: URL?
    var identity: String { "\(id)|\(title)|\(artist)|\(Int(duration))" }
}

struct PlaybackSnapshot: Sendable {
    var track: PlaybackTrack?
    var position: Double = 0
    var playing = false
    var rate: Double = 1
    var capturedAt = Date()
    var artwork: Data?
    var message = "等待网易云音乐"
    var canControl = false
    var canSeek = false
    func elapsed(at date: Date) -> Double {
        let advance = playing ? max(0, date.timeIntervalSince(capturedAt)) * rate : 0
        return max(0, min(track?.duration ?? 0, position + advance))
    }
}

enum PlaybackCommand: Sendable { case previous, toggle, next, seek(Double) }
@MainActor protocol PlaybackProvider: AnyObject {
    func snapshot() async -> PlaybackSnapshot
    func send(_ command: PlaybackCommand) async throws
    func stop()
}

struct LyricWord: Codable, Equatable, Sendable {
    var text: String
    var start: Double
    var duration: Double
}
struct LyricLine: Codable, Equatable, Identifiable, Sendable {
    var id: Int
    var start: Double
    var end: Double
    var text: String
    var words: [LyricWord] = []
    var translation: String?
    var romanization: String?
}
struct LyricsDocument: Codable, Sendable {
    var lines: [LyricLine]
    var source: String
    var offset: Double = 0
    func currentIndex(at time: Double) -> Int? {
        let target = time + offset
        var low = 0, high = lines.count
        while low < high {
            let mid = (low + high) / 2
            if lines[mid].start <= target { low = mid + 1 } else { high = mid }
        }
        return low > 0 ? low - 1 : nil
    }
}
protocol LyricsProvider: Sendable {
    func lyrics(for track: PlaybackTrack) async throws -> LyricsDocument?
}

enum CompanionError: LocalizedError {
    case unavailable(String)
    var errorDescription: String? { switch self { case .unavailable(let reason): reason } }
}

enum TrackMatcher {
    static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
    }
    static func matches(title: String, artist: String, duration: Double, query: PlaybackTrack) -> Bool {
        guard query.duration > 0, duration.isFinite, duration > 0,
              abs(duration - query.duration) <= 3,
              normalized(title) == normalized(query.title) else { return false }
        let wanted = normalized(query.artist), candidate = normalized(artist)
        return !wanted.isEmpty && !candidate.isEmpty && wanted == candidate
    }
}


enum PlaybackMode: String, CaseIterable, Sendable {
    case sequential = "顺序播放", repeatAll = "列表循环", repeatOne = "单曲循环", shuffle = "随机播放"
}
@MainActor protocol QueuePlaybackProvider: PlaybackProvider {
    func playbackQueue() async -> [PlaybackTrack]
    func setPlaybackMode(_ mode: PlaybackMode) async throws
}
