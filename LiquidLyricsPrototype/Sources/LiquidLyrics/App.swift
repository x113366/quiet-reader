import AppKit
import SwiftUI

final class FloatingPanel: NSPanel {
    var lyricsOnly = false
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func sendEvent(_ event: NSEvent) {
        let dragArea = lyricsOnly ? NSRect(x: 20, y: frame.height - 20, width: frame.width - 40, height: 16)
            : NSRect(x: 20, y: frame.height - 68, width: frame.width - 40, height: 48)
        if event.type == .leftMouseDown, dragArea.contains(event.locationInWindow) { performDrag(with: event); return }
        super.sendEvent(event)
    }
}
final class TransparentRootView: NSView { override var isOpaque: Bool { false } }

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate {
    var panel: FloatingPanel!
    let model = PlayerModel()
    let settings = AppSettings()
    var statusItem: NSStatusItem!
    let menuLyricView = MenuLyricView()
    var settingsWindow: NSWindow?
    var appliedDesktopVisibility: Bool?
    var menuLyricsTask: Task<Void, Never>?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "设置…", action: #selector(showSettings), keyEquivalent: ",").target = self
        appMenu.addItem(withTitle: "退出 Liquid Lyrics", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu; NSApp.mainMenu = menu
        panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 280, height: 380), styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        panel.title = "Liquid Lyrics"
        panel.isMovable = true; panel.minSize = NSSize(width: 280, height: 380); panel.maxSize = NSSize(width: 420, height: 600)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: PlayerView(model: model, settings: settings))
        hosting.sizingOptions = []; hosting.focusRingType = .none; hosting.autoresizingMask = [.width, .height]
        let root = TransparentRootView(frame: NSRect(x: 0, y: 0, width: 280, height: 380))
        root.wantsLayer = true; root.layer?.backgroundColor = NSColor.clear.cgColor
        root.layer?.cornerRadius = 26; root.layer?.cornerCurve = .continuous; root.layer?.masksToBounds = true
        hosting.frame = root.bounds; root.addSubview(hosting); panel.contentView = root
        panel.delegate = self
        restoreFrame()
        let contextMenu = NSMenu(); contextMenu.delegate = self; root.menu = contextMenu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.autosaveName = "LiquidLyrics.CurrentLine"
        statusItem.button?.setAccessibilityIdentifier("LiquidLyrics.CurrentLine")
        statusItem.button?.setAccessibilityLabel("Liquid Lyrics 当前歌词")
        statusItem.button?.image = NSImage(systemSymbolName: "text.bubble", accessibilityDescription: "Liquid Lyrics")
        if let button = statusItem.button {
            menuLyricView.frame = button.bounds
            menuLyricView.autoresizingMask = [.width, .height]
            menuLyricView.isHidden = true
            button.addSubview(menuLyricView)
        }
        let statusMenu = NSMenu(); statusMenu.delegate = self; statusItem.menu = statusMenu
        settings.onChange = { [weak self] in self?.applySettings() }
        applySettings()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(netEaseLaunched(_:)), name: NSWorkspace.didLaunchApplicationNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(netEaseTerminated(_:)), name: NSWorkspace.didTerminateApplicationNotification, object: nil)
        if (settings.values.desktopVisible ?? true) && (settings.values.followNetEase != true || !NSRunningApplication.runningApplications(withBundleIdentifier: "com.netease.163music").isEmpty) {
            panel.orderFrontRegardless()
        } else { panel.orderOut(nil) }
        model.start()
        if settings.values.launchNetEase ?? true { launchNetEase() }
        menuLyricsTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.updateMenuLyrics()
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
    }
    private func launchNetEase() {
        guard NSRunningApplication.runningApplications(withBundleIdentifier: NetEasePlaybackProvider.bundleID).isEmpty else { return }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: NetEasePlaybackProvider.bundleID) else {
            model.actionError = "未找到网易云音乐，请先安装客户端"; return
        }
        let config = NSWorkspace.OpenConfiguration(); config.activates = false
        NSWorkspace.shared.openApplication(at: url, configuration: config) { [weak self] _, error in
            if let error { Task { @MainActor [weak self] in self?.model.actionError = "无法启动网易云：" + error.localizedDescription } }
        }
    }
    private func updateMenuLyrics() {
        guard let button = statusItem.button else { return }
        guard settings.values.menuBarLyrics == true else {
            menuLyricView.isHidden = true
            if statusItem.length != NSStatusItem.squareLength { statusItem.length = NSStatusItem.squareLength }
            button.title = ""; button.image = NSImage(systemSymbolName: "text.bubble", accessibilityDescription: "Liquid Lyrics"); button.toolTip = "Liquid Lyrics"
            return
        }
        let line: String
        var progress = 0.0
        if let document = model.document, let index = document.currentIndex(at: model.position + settings.values.offset) {
            let current = document.lines[index]
            line = current.text
            progress = MenuLyricTiming.progress(line: current, time: model.position + settings.values.offset + document.offset, fallbackEnd: model.track?.duration ?? current.start)
        } else { line = model.track == nil ? "等待播放" : "等待歌词" }
        let fixedWidth = MenuLyricView.textWidth + 20
        if statusItem.length != fixedWidth { statusItem.length = fixedWidth }
        if button.image != nil { button.image = nil }
        if !button.title.isEmpty { button.title = "" }
        if button.toolTip != line { button.toolTip = line; button.setAccessibilityValue(line) }
        menuLyricView.isHidden = false
        menuLyricView.update(text: line, progress: progress)

    }
    @objc private func netEaseLaunched(_ notification: Notification) {
        guard settings.values.followNetEase == true,
              let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == "com.netease.163music" else { return }
        if (settings.values.desktopVisible ?? true) { panel.orderFrontRegardless() }
    }
    @objc private func netEaseTerminated(_ notification: Notification) {
        guard settings.values.followNetEase == true,
              let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == "com.netease.163music" else { return }
        panel.orderOut(nil)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPlayer(); return true
    }
    func applySettings() {
        panel.level = settings.values.alwaysOnTop ? .floating : .normal
        panel.collectionBehavior = settings.values.allSpaces ? [.canJoinAllSpaces, .fullScreenAuxiliary] : [.fullScreenAuxiliary]
        panel.ignoresMouseEvents = settings.values.clickThrough
        panel.alphaValue = settings.values.opacity
        panel.lyricsOnly = settings.values.lyricsOnly
        let desktopVisible = settings.values.desktopVisible ?? true
        if appliedDesktopVisibility != desktopVisible {
            appliedDesktopVisibility = desktopVisible
            if desktopVisible { panel.orderFrontRegardless() } else { panel.orderOut(nil) }
        }
        updateMenuLyrics()
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let info = NSMenuItem(title: model.status, action: nil, keyEquivalent: ""); info.isEnabled = false; menu.addItem(info)
        add("显示桌面播放器", #selector(toggleDesktop), to: menu)
        menu.items.last?.state = (settings.values.desktopVisible ?? true) ? .on : .off
        add("显示菜单栏当前句", #selector(toggleMenuLyrics), to: menu)
        menu.items.last?.state = settings.values.menuBarLyrics == true ? .on : .off
        add(settings.values.clickThrough ? "关闭鼠标穿透" : "开启鼠标穿透", #selector(toggleClickThrough), to: menu)
        add(settings.values.lyricsOnly ? "显示完整播放器" : "纯歌词模式", #selector(toggleLyricsOnly), to: menu)
        add("设置…", #selector(showSettings), to: menu)
        menu.addItem(.separator())
        add("退出", #selector(quit), to: menu)
    }
    private func add(_ title: String, _ action: Selector, to menu: NSMenu) { let item = menu.addItem(withTitle: title, action: action, keyEquivalent: ""); item.target = self }
    @objc func toggleMenuLyrics() { settings.values.menuBarLyrics = !(settings.values.menuBarLyrics ?? false) }
    @objc func toggleDesktop() { settings.values.desktopVisible = !(settings.values.desktopVisible ?? true) }
    @objc func showPlayer() { settings.values.desktopVisible = true; settings.values.clickThrough = false; panel.makeKeyAndOrderFront(nil) }
    @objc func hidePlayer() { settings.values.desktopVisible = false; panel.orderOut(nil); settingsWindow?.orderOut(nil) }
    @objc func toggleClickThrough() { settings.values.clickThrough.toggle() }
    @objc func toggleLyricsOnly() { settings.values.lyricsOnly.toggle() }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func showSettings() {
        if settingsWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 660), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "Liquid Lyrics 设置"; window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SettingsView(settings: settings, model: model, hidePlayer: { [weak self] in self?.hidePlayer() }))
            window.center(); settingsWindow = window
        }
        NSApp.activate(); settingsWindow?.makeKeyAndOrderFront(nil)
    }
    func windowDidResize(_ notification: Notification) { panel.invalidateShadow(); saveFrame() }
    func windowDidMove(_ notification: Notification) { saveFrame() }
    func windowDidBecomeKey(_ notification: Notification) { panel.invalidateShadow() }
    func windowDidResignKey(_ notification: Notification) { panel.invalidateShadow() }
    func saveFrame() { UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: "companion.frame") }
    func restoreFrame() {
        guard let screen = NSScreen.main else { return }
        var frame = NSRect(x: screen.visibleFrame.maxX - 304, y: screen.visibleFrame.midY - 190, width: 280, height: 380)
        if let stored = UserDefaults.standard.string(forKey: "companion.frame") { frame = NSRectFromString(stored) }
        frame.size.width = max(280, min(420, frame.width)); frame.size.height = max(380, min(600, frame.height))
        let visible = NSScreen.screens.first(where: { $0.visibleFrame.intersects(frame) })?.visibleFrame ?? screen.visibleFrame
        frame.origin.x = max(visible.minX, min(visible.maxX - frame.width, frame.minX))
        frame.origin.y = max(visible.minY, min(visible.maxY - frame.height, frame.minY))
        panel.setFrame(frame, display: true)
    }
    func applicationWillTerminate(_ notification: Notification) { menuLyricsTask?.cancel(); NSWorkspace.shared.notificationCenter.removeObserver(self); saveFrame(); model.stop() }
}
@main struct LiquidLyricsApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.accessory); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
