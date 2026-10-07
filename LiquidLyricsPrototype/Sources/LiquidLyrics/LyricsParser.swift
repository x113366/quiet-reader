import Foundation

enum LyricsParser {
    private static func matches(_ pattern: String, _ text: String) -> [NSTextCheckingResult] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
    }
    private static func capture(_ match: NSTextCheckingResult, _ index: Int, _ text: String) -> String {
        guard let range = Range(match.range(at: index), in: text) else { return "" }
        return String(text[range])
    }
    static func lrc(_ text: String, source: String) -> LyricsDocument? {
        var rows: [LyricLine] = []
        var offset = 0.0
        for raw in text.components(separatedBy: .newlines) {
            if let tag = matches(#"\[offset:([+-]?\d+)\]"#, raw).first {
                offset = (Double(capture(tag, 1, raw)) ?? 0) / 1000
            }
            let tags = matches(#"\[(\d+):(\d{2}(?:\.\d+)?)\]"#, raw)
            guard let last = tags.last else { continue }
            let body = (raw as NSString).substring(from: last.range.location + last.range.length).trimmingCharacters(in: .whitespaces)
            guard !body.isEmpty else { continue }
            for tag in tags {
                let start = (Double(capture(tag, 1, raw)) ?? 0) * 60 + (Double(capture(tag, 2, raw)) ?? 0)
                rows.append(.init(id: 0, start: start, end: start + 8, text: body))
            }
        }
        return finish(rows, source: source, offset: offset)
    }
    static func yrc(_ text: String, source: String) -> LyricsDocument? {
        var rows: [LyricLine] = []
        for raw in text.components(separatedBy: .newlines) {
            guard let header = matches(#"^\[(\d+),(\d+)\]"#, raw).first else { continue }
            let start = (Double(capture(header, 1, raw)) ?? 0) / 1000
            let duration = (Double(capture(header, 2, raw)) ?? 0) / 1000
            let tags = matches(#"\((\d+),(\d+),\d+\)"#, raw)
            var words: [LyricWord] = []
            for (i, tag) in tags.enumerated() {
                let from = tag.range.location + tag.range.length
                let to = i + 1 < tags.count ? tags[i + 1].range.location : (raw as NSString).length
                guard to > from else { continue }
                let body = (raw as NSString).substring(with: NSRange(location: from, length: to - from))
                let wordStart = (Double(capture(tag, 1, raw)) ?? 0) / 1000
                let wordDuration = (Double(capture(tag, 2, raw)) ?? 0) / 1000
                words.append(.init(text: body, start: wordStart, duration: wordDuration))
            }
            guard !words.isEmpty else { continue }
            rows.append(.init(id: 0, start: start, end: start + duration, text: words.map(\.text).joined(), words: words))
        }
        return finish(rows, source: source, offset: 0)
    }
    private static func finish(_ rows: [LyricLine], source: String, offset: Double) -> LyricsDocument? {
        guard !rows.isEmpty else { return nil }
        let sorted = rows.sorted { $0.start < $1.start }
        let lines = sorted.enumerated().map { index, original in
            var row = original
            row.id = index
            if row.words.isEmpty, index + 1 < sorted.count { row.end = sorted[index + 1].start }
            return row
        }
        return .init(lines: lines, source: source, offset: offset)
    }
    static func attach(_ text: String?, romanization: Bool, to document: inout LyricsDocument) {
        guard let text, let auxiliary = lrc(text, source: "auxiliary") else { return }
        for i in document.lines.indices {
            let target = document.lines[i].start
            if let line = auxiliary.lines.min(by: { abs($0.start - target) < abs($1.start - target) }), abs(line.start - target) <= 0.8 {
                if romanization { document.lines[i].romanization = line.text }
                else { document.lines[i].translation = line.text }
            }
        }
    }
}
