import AppKit
import SwiftUI

enum LyricTypography {
    struct Choice: Identifiable {
        let id: String
        let title: String
    }
    static var choices: [Choice] {
        [Choice(id: "system", title: "系统默认"),
         Choice(id: "PingFangSC-Regular", title: "苹方 · 简洁"),
         Choice(id: "STSong", title: "华文宋体 · 书卷"),
         Choice(id: "STKaiti", title: "华文楷体 · 古典"),
         Choice(id: "HannotateSC-W5", title: "手札体 · 手写"),
         Choice(id: "HanziPenSC-W3", title: "翩翩体 · 轻盈")]
            .filter { $0.id == "system" || NSFont(name: $0.id, size: 17) != nil }
    }
    static func font(name: String?, size: Double, emphasized: Bool = false) -> NSFont {
        // STSong only has Regular; use the installed Songti SC family with real bold glyphs.
        if name == "STSong", let songti = NSFont(name: emphasized ? "STSongti-SC-Bold" : "STSongti-SC-Regular", size: size) {
            return songti
        }
        guard let name, name != "system", let font = NSFont(name: name, size: size) else {
            return .systemFont(ofSize: size, weight: emphasized ? .semibold : .regular)
        }
        return emphasized ? NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) : font
    }
    static func rowHeight(text: String, width: Double, font: NSFont, gap: Double, auxiliary: Double) -> Double {
        let measured = (text as NSString).boundingRect(with: NSSize(width: max(1, width), height: 1000),
            options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font]).height
        let line = max(font.pointSize * 1.25, font.ascender - font.descender + font.leading)
        return ceil(min(line * 2, max(line, measured))) + gap + auxiliary
    }
}
