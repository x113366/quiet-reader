import SwiftUI
import ServiceManagement

@MainActor @Observable final class AppSettings {
    struct Values: Codable, Equatable {
        var fontSize: Double = 17
        // Optional additions keep existing saved settings decodable.
        var launchNetEase: Bool?
        var menuBarLyrics: Bool?
        var menuBarOnly: Bool? // Legacy migration only.
        var desktopVisible: Bool?
        var followNetEase: Bool?
        var lyricFont: String?
        var lyricGap: Double?
        var visibleLines = 0 // 0: adapt to window height
        var alignment = "left"
        var opacity = 1.0
        var translation = true
        var romanization = false
        var rotation = true
        var dynamicTint = true
        var offset = 0.0 // Positive means lyrics appear earlier.
        var alwaysOnTop = true
        var allSpaces = true
        var clickThrough = false
        var lyricsOnly = false
    }
    var values: Values {
        didSet {
            if let data = try? JSONEncoder().encode(values) { UserDefaults.standard.set(data, forKey: "companion.settings.v1") }
            onChange?()
        }
    }
    var startupMessage: String?
    func setFollowNetEase(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            values.followNetEase = enabled
            startupMessage = enabled && SMAppService.mainApp.status == .requiresApproval ? "请在系统设置 → 通用 → 登录项中允许 Liquid Lyrics。" : nil
        } catch { startupMessage = "无法更新登录项：" + error.localizedDescription }
    }
    @ObservationIgnored var onChange: (() -> Void)?
    init() {
        values = UserDefaults.standard.data(forKey: "companion.settings.v1")
            .flatMap { try? JSONDecoder().decode(Values.self, from: $0) } ?? Values()
        if values.desktopVisible == nil {
            values.desktopVisible = values.menuBarOnly != true
            if values.menuBarOnly == true { values.menuBarLyrics = true }
            values.menuBarOnly = nil
        }
        // Always allow recovery after restarting; click-through is a session-only mode.
        values.clickThrough = false
    }
}

struct SettingsView: View {
    @Bindable var settings: AppSettings
    @Bindable var model: PlayerModel
    var hidePlayer: () -> Void
    var body: some View {
        Form {
            Section("歌词") {
                HStack { Text("字号"); Slider(value: $settings.values.fontSize, in: 13...24, step: 1); Text("\(Int(settings.values.fontSize))") }
                Picker("中文字体", selection: Binding(get: { settings.values.lyricFont ?? "system" }, set: { settings.values.lyricFont = $0 })) {
                    ForEach(LyricTypography.choices) { choice in Text(choice.title).tag(choice.id) }
                }
                Text("月光会陪你停留 · 歌词预览")
                    .font(Font(LyricTypography.font(name: settings.values.lyricFont, size: settings.values.fontSize)))
                HStack {
                    Text("歌词间距")
                    Slider(value: Binding(get: { settings.values.lyricGap ?? 4 }, set: { settings.values.lyricGap = $0 }), in: 2...20, step: 1)
                    Text("\(Int(settings.values.lyricGap ?? 4)) pt").monospacedDigit()
                }
                Picker("显示行数", selection: $settings.values.visibleLines) {
                    Text("随窗口高度变化").tag(0)
                    ForEach(3...8, id: \.self) { Text("\($0) 行").tag($0) }
                }
                Picker("对齐", selection: $settings.values.alignment) { Text("左对齐").tag("left"); Text("居中").tag("center"); Text("右对齐").tag("right") }
                Toggle("翻译（歌词源提供时）", isOn: $settings.values.translation)
                Toggle("罗马音（歌词源提供时）", isOn: $settings.values.romanization)
                HStack { Text("Offset"); Slider(value: $settings.values.offset, in: -5...5, step: 0.1); Text(String(format: "%+.1fs", settings.values.offset)).monospacedDigit() }
                Text("正值让歌词提前；点击歌词跳转时自动抵消偏移。").font(.caption).foregroundStyle(.secondary)
                HStack { Button("导入本地 LRC…") { model.importLRC() }; Button("重新获取歌词") { model.reloadLyrics(refresh: true) } }
            }
            Section("启动") {
                Toggle("启动本应用时打开网易云", isOn: Binding(get: { settings.values.launchNetEase ?? true }, set: { settings.values.launchNetEase = $0 }))
                Toggle("跟随网易云启动", isOn: Binding(get: { settings.values.followNetEase ?? false }, set: { settings.setFollowNetEase($0) }))
                Text("开启后登录时驻留菜单栏；网易云启动时显示，退出时收起。彻底退出本应用后，需重新打开才能继续跟随。").font(.caption).foregroundStyle(.secondary)
                if let message = settings.startupMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
                Button("管理系统登录项…") { SMAppService.openSystemSettingsLoginItems() }
            }
            Section("显示位置") {
                Toggle("菜单栏显示当前句", isOn: Binding(get: { settings.values.menuBarLyrics ?? false }, set: { settings.values.menuBarLyrics = $0 }))
                Toggle("显示桌面播放器", isOn: Binding(get: { settings.values.desktopVisible ?? true }, set: { settings.values.desktopVisible = $0 }))
                Text("固定 12 个汉字宽度，当前句居中显示，跟随歌词偏移；长句随播放进度滚动，悬停查看全文。点击仍可打开控制菜单。").font(.caption).foregroundStyle(.secondary)
            }
            Section("窗口") {
                Button("收起到菜单栏", systemImage: "menubar.arrow.up") { hidePlayer() }
                Text("隐藏窗口后继续同步；点击菜单栏歌词图标，勾选“显示桌面播放器”恢复。").font(.caption).foregroundStyle(.secondary)
                Toggle("始终置顶", isOn: $settings.values.alwaysOnTop)
                Toggle("显示在所有 Space", isOn: $settings.values.allSpaces)
                Toggle("鼠标穿透（从菜单栏解除）", isOn: $settings.values.clickThrough)
                Toggle("纯歌词模式", isOn: $settings.values.lyricsOnly)
                HStack { Text("窗口不透明度"); Slider(value: $settings.values.opacity, in: 0.45...1) }
                Toggle("播放时旋转封面", isOn: $settings.values.rotation)
                Toggle("专辑配色 · 文字与梦幻渐变", isOn: $settings.values.dynamicTint)
            }
            Section("播放连接") {
                Text(model.status).font(.caption).textSelection(.enabled)
                Text("歌词来源：" + model.lyricsStatus).font(.caption).foregroundStyle(.secondary)
                Button("授予辅助功能权限…") { NetEaseControls.requestPermission() }
                Button(model.demoMode ? "连接网易云音乐" : "进入演示模式") { model.setDemo(!model.demoMode) }
                Text("网易云负责音频播放。本应用只读取播放状态和歌词；未获权限或客户端不支持的控制会显示原因。").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).frame(width: 440, height: 660)
    }
}
