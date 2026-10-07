import Testing
import Foundation
@testable import LiquidLyrics

@Test func lrcRepeatedTagsCRLFAndOffset() throws {
    let document = try #require(LyricsParser.lrc("[offset:+300]\r\n[00:01.20][00:03.450]你好\r\n[00:05]世界", source: "test"))
    #expect(document.lines.map(\.start) == [1.2, 3.45, 5])
    #expect(document.offset == 0.3)
    #expect(document.currentIndex(at: 0) == nil)
    #expect(document.currentIndex(at: 1) == 0)
    #expect(document.currentIndex(at: 3.2) == 1)
}
@Test func yrcAbsoluteTimeAndLiteralParentheses() throws {
    let doc = try #require(LyricsParser.yrc("[1000,2000](1000,500,0)你(oh)(1500,1500,0)好\r\n{}", source: "test"))
    #expect(doc.lines[0].text == "你(oh)好")
    #expect(doc.lines[0].words[1].start == 1.5)
    #expect(doc.lines[0].words[1].duration == 1.5)
    #expect(LyricsParser.yrc("invalid", source: "test") == nil)
}
@Test func identityRejectsCoverAndWrongDuration() {
    let query = PlaybackTrack(id: "", title: "Hello", artist: "Artist", duration: 200)
    #expect(TrackMatcher.matches(title: "HELLO!", artist: "Artist", duration: 203, query: query))
    #expect(!TrackMatcher.matches(title: "Hello", artist: "Cover", duration: 200, query: query))
    #expect(!TrackMatcher.matches(title: "Hello", artist: "Artist", duration: 203.1, query: query))
}
@Test func pausedAndBoundedClock() {
    let date = Date()
    let track = PlaybackTrack(id: "1", title: "A", artist: "B", duration: 100)
    var snapshot = PlaybackSnapshot(track: track, position: 10, capturedAt: date)
    #expect(snapshot.elapsed(at: date.addingTimeInterval(5)) == 10)
    snapshot.playing = true
    #expect(snapshot.elapsed(at: date.addingTimeInterval(5)) == 15)
    #expect(snapshot.elapsed(at: date.addingTimeInterval(500)) == 100)
}
@Test func tableCompactionCannotOverrideLiveLog() {
    var cache = NetEaseLastPlayingStateCache()
    let current = NetEaseLastPlayingState(current: 50, resourceID: "1")
    _ = cache.observeLog(current)
    #expect(cache.bootstrapFromTable(.init(current: 20, resourceID: "1")) == current)
}

private actor FetchLog {
    var calls: [String] = []
    func record(_ name: String) { calls.append(name) }
}
private struct TestSource: LyricsProvider {
    var name: String
    var result: LyricsDocument?
    var fail = false
    var log: FetchLog
    func lyrics(for track: PlaybackTrack) async throws -> LyricsDocument? {
        await log.record(name)
        if fail { throw CompanionError.unavailable("offline") }
        return result
    }
}
@Test func fallbackOrderAndPositiveCache() async throws {
    let log = FetchLog()
    let doc = LyricsParser.lrc("[00:01]line", source: "LRCLIB")!
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let service = LyricsService(providers: [TestSource(name: "netease", fail: true, log: log), TestSource(name: "lrclib", result: doc, log: log), TestSource(name: "local", result: doc, log: log)], directory: directory)
    let track = PlaybackTrack(id: "1", title: "one", artist: "artist", duration: 100)
    #expect(try await service.lyrics(for: track)?.source == "LRCLIB")
    #expect(try await service.lyrics(for: track)?.source == "LRCLIB")
    #expect(await log.calls == ["netease", "lrclib"])
}
@Test func translationAlignmentAndOffsetInverse() throws {
    var doc = try #require(LyricsParser.lrc("[offset:200]\n[00:01]one\n[00:05]two", source: "test"))
    LyricsParser.attach("[00:01.20]一\n[00:05]二", romanization: false, to: &doc)
    #expect(doc.lines[0].translation == "一")
    let offset = 0.5
    let seekPosition = doc.lines[1].start - offset - doc.offset
    #expect(doc.currentIndex(at: seekPosition + offset + 0.00001) == 1)
}

@Test func menuLyricEstimatedAndWordTiming() {
    var line = LyricLine(id: 0, start: 10, end: 20, text: "你好世界")
    #expect(MenuLyricTiming.progress(line: line, time: 15, fallbackEnd: 30) == 0.5)
    #expect(MenuLyricTiming.progress(line: line, time: 5, fallbackEnd: 30) == 0)
    #expect(MenuLyricTiming.progress(line: line, time: 25, fallbackEnd: 30) == 1)
    line.words = [.init(text: "你好", start: 10, duration: 2), .init(text: "世界", start: 16, duration: 2)]
    #expect(MenuLyricTiming.progress(line: line, time: 14, fallbackEnd: 30) == 0.5)
    #expect(MenuLyricTiming.progress(line: line, time: 17, fallbackEnd: 30) == 0.75)
}
