import Foundation
import CryptoKit

actor LyricsHTTP {
    static let shared = LyricsHTTP()
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        return URLSession(configuration: config)
    }()
    func data(_ base: String, query: [String: String]) async throws -> Data {
        var components = URLComponents(string: base)!
        components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: components.url!)
        request.setValue("LiquidLyrics/0.2 (macOS desktop companion)", forHTTPHeaderField: "User-Agent")
        if components.host == "music.163.com" { request.setValue("https://music.163.com/", forHTTPHeaderField: "Referer") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, data.count < 8_000_000 else {
            throw CompanionError.unavailable("歌词服务暂时不可用")
        }
        return data
    }
}

struct NetEaseLyricsProvider: LyricsProvider {
    func lyrics(for track: PlaybackTrack) async throws -> LyricsDocument? {
        let ids: [String]
        if !track.id.isEmpty, track.id.allSatisfy(\.isNumber) { ids = [track.id] }
        else { ids = try await search(track) }
        var fallback: LyricsDocument?
        for id in ids.prefix(3) {
            try Task.checkCancellation()
            let data = try await LyricsHTTP.shared.data("https://music.163.com/api/song/lyric/v1", query: ["id":id,"lv":"-1","kv":"-1","tv":"-1","rv":"-1","yv":"-1","ytv":"-1","yrv":"-1"])
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            func raw(_ key: String) -> String? { (json[key] as? [String: Any])?["lyric"] as? String }
            if var document = raw("yrc").flatMap({ LyricsParser.yrc($0, source: "网易云 YRC") }) {
                LyricsParser.attach(raw("ytlrc") ?? raw("tlyric"), romanization: false, to: &document)
                LyricsParser.attach(raw("yromalrc") ?? raw("romalrc"), romanization: true, to: &document)
                return document
            }
            if fallback == nil, var document = raw("lrc").flatMap({ LyricsParser.lrc($0, source: "网易云 LRC") }) {
                LyricsParser.attach(raw("tlyric"), romanization: false, to: &document)
                LyricsParser.attach(raw("romalrc"), romanization: true, to: &document)
                fallback = document
            }
        }
        return fallback
    }
    private func search(_ track: PlaybackTrack) async throws -> [String] {
        let data = try await LyricsHTTP.shared.data("https://music.163.com/api/cloudsearch/pc", query: ["s":"\(track.title) \(track.artist)","type":"1","limit":"10"])
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let songs = (json?["result"] as? [String: Any])?["songs"] as? [[String: Any]] ?? []
        return songs.compactMap { song in
            let artist = (song["ar"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
            guard let name = song["name"] as? String, let duration = song["dt"] as? Double,
                  TrackMatcher.matches(title: name, artist: artist, duration: duration / 1000, query: track),
                  let id = song["id"] as? NSNumber else { return nil }
            return id.stringValue
        }
    }
}
struct LRCLIBLyricsProvider: LyricsProvider {
    func lyrics(for track: PlaybackTrack) async throws -> LyricsDocument? {
        let data = try await LyricsHTTP.shared.data("https://lrclib.net/api/search", query: ["track_name":track.title,"artist_name":track.artist])
        let candidates = try JSONDecoder().decode([Candidate].self, from: data)
        for entry in candidates.sorted(by: { abs($0.duration - track.duration) < abs($1.duration - track.duration) }) {
            guard TrackMatcher.matches(title: entry.trackName, artist: entry.artistName, duration: entry.duration, query: track),
                  let raw = entry.syncedLyrics, let document = LyricsParser.lrc(raw, source: "LRCLIB") else { continue }
            return document
        }
        return nil
    }
    private struct Candidate: Decodable { var trackName: String; var artistName: String; var duration: Double; var syncedLyrics: String? }
}
struct LocalLyricsProvider: LyricsProvider {
    static let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Music/LiquidLyrics", isDirectory: true)
    func lyrics(for track: PlaybackTrack) async throws -> LyricsDocument? {
        guard let urls = try? FileManager.default.contentsOfDirectory(at: Self.folder, includingPropertiesForKeys: nil) else { return nil }
        let full = TrackMatcher.normalized("\(track.artist) - \(track.title)")
        let title = TrackMatcher.normalized(track.title)
        let files = urls.filter { $0.pathExtension.lowercased() == "lrc" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        let file = files.first { TrackMatcher.normalized($0.deletingPathExtension().lastPathComponent) == full }
            ?? files.first { TrackMatcher.normalized($0.deletingPathExtension().lastPathComponent) == title }
        guard let file else { return nil }
        let data = try Data(contentsOf: file)
        guard data.count < 2_000_000, let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else { return nil }
        return LyricsParser.lrc(text, source: "本地 LRC")
    }
}

actor LyricsService {
    private struct Entry: Codable { var saved: Date; var document: LyricsDocument }
    private let providers: [any LyricsProvider]
    private let directory: URL
    init(providers: [any LyricsProvider] = [NetEaseLyricsProvider(), LRCLIBLyricsProvider(), LocalLyricsProvider()], directory: URL? = nil) {
        self.providers = providers
        self.directory = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("LiquidLyrics/v1")
    }
    func lyrics(for track: PlaybackTrack, refresh: Bool = false) async throws -> LyricsDocument? {
        let key = SHA256.hash(data: Data(track.identity.utf8)).map { String(format:"%02x",$0) }.joined()
        let url = directory.appendingPathComponent(key + ".json")
        if !refresh, let data = try? Data(contentsOf: url), let cached = try? JSONDecoder().decode(Entry.self, from: data),
           Date().timeIntervalSince(cached.saved) < 7 * 86400 { return cached.document }
        var errors: [String] = []
        for provider in providers {
            try Task.checkCancellation()
            do {
                if let document = try await provider.lyrics(for: track) {
                    try Task.checkCancellation()
                    // Local files are re-read so user edits take effect immediately on refresh.
                    if document.source != "本地 LRC" {
                        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                        if let data = try? JSONEncoder().encode(Entry(saved: Date(), document: document)) { try? data.write(to: url, options: .atomic) }
                    }
                    return document
                }
            } catch is CancellationError { throw CancellationError() }
            catch { errors.append(error.localizedDescription) }
        }
        if !errors.isEmpty { throw CompanionError.unavailable("在线歌词暂不可用；可导入本地 LRC") }
        return nil
    }
}
