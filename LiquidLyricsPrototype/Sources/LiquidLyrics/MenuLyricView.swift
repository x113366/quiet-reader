import AppKit

// Draw inside the existing status button so its identity, width and click handling stay stable.
final class MenuLyricView: NSView {
    static let lyricFont = NSFont.systemFont(ofSize: 13, weight: .medium)
    static var textWidth: CGFloat {
        ceil((String(repeating: "汉", count: 12) as NSString).size(withAttributes: [.font: lyricFont]).width)
    }
    var text = ""
    var progress = 0.0
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    func update(text: String, progress: Double) {
        guard self.text != text || self.progress != progress else { return }
        self.text = text; self.progress = progress; needsDisplay = true
    }
    override func draw(_ dirtyRect: NSRect) {
        let color: NSColor = (superview as? NSButton)?.isHighlighted == true ? .selectedMenuItemTextColor : .labelColor
        let attributes: [NSAttributedString.Key: Any] = [.font: Self.lyricFont, .foregroundColor: color]
        let size = (text as NSString).size(withAttributes: attributes)
        let viewport = bounds.insetBy(dx: 10, dy: 0)
        let characters = Array(text)
        let position = min(Double(characters.count), max(0, progress * Double(characters.count)))
        let whole = min(characters.count, Int(position))
        let prefix = String(characters.prefix(whole))
        var cursor = (prefix as NSString).size(withAttributes: attributes).width
        if whole < characters.count {
            let next = (String(characters.prefix(whole + 1)) as NSString).size(withAttributes: attributes).width
            cursor += (next - cursor) * (position - Double(whole))
        }
        let offset = min(max(0, size.width - viewport.width), max(0, cursor - viewport.width / 2))
        let x = size.width <= viewport.width ? viewport.midX - size.width / 2 : viewport.minX - offset
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: viewport).addClip()
        (text as NSString).draw(at: NSPoint(x: x, y: bounds.midY - size.height / 2), withAttributes: attributes)
        NSGraphicsContext.restoreGraphicsState()
    }
}

enum MenuLyricTiming {
    static func progress(line: LyricLine, time: Double, fallbackEnd: Double) -> Double {
        let end = line.end.isFinite && line.end > line.start ? line.end : fallbackEnd
        if !line.words.isEmpty {
            let count = line.words.reduce(0) { $0 + $1.text.count }
            guard count > 0 else { return 0 }
            let elapsed = line.words.reduce(0.0) { sum, word in
                let fraction = word.duration > 0 ? min(1, max(0, (time - word.start) / word.duration)) : (time >= word.start ? 1.0 : 0.0)
                return sum + Double(word.text.count) * fraction
            }
            return elapsed / Double(count)
        }
        guard end.isFinite, end > line.start else { return 0 }
        return min(1, max(0, (time - line.start) / (end - line.start)))
    }
}
