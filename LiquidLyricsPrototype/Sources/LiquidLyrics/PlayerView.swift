import SwiftUI

struct PlayerView: View {
    @Bindable var model: PlayerModel
    @Bindable var settings: AppSettings
    @State private var showQueue = false
    @State private var seekPreview = 0.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private var ink: Color {
        guard settings.values.dynamicTint else { return .primary }
        return Color(hue: model.albumHue, saturation: colorScheme == .dark ? 0.22 : 0.48, brightness: colorScheme == .dark ? 0.96 : 0.32)
    }
    private var quietInk: Color {
        guard settings.values.dynamicTint else { return .secondary }
        return Color(hue: model.albumHue, saturation: 0.22, brightness: colorScheme == .dark ? 0.78 : 0.44)
    }
    private var accent: Color { settings.values.dynamicTint ? model.tint : .teal }
    var body: some View {
        VStack(spacing: 16) {
            if !settings.values.lyricsOnly { header }
            lyrics
            if !settings.values.lyricsOnly { transport }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { albumWash }
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }
    // Decorative album color wash above the native glass, below text and controls.
    // The system still supplies refraction, highlights and interactive button glass.
    @ViewBuilder private var albumWash: some View {
        if settings.values.dynamicTint {
            GeometryReader { geometry in
                let dark = colorScheme == .dark
                let first = Color(hue: model.albumHue, saturation: dark ? 0.38 : 0.24, brightness: dark ? 0.30 : 1)
                let second = Color(hue: model.albumSecondaryHue, saturation: dark ? 0.32 : 0.20, brightness: dark ? 0.25 : 1)
                ZStack {
                    LinearGradient(colors: [first.opacity(0.48), second.opacity(0.14), first.opacity(0.24)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    RadialGradient(colors: [second.opacity(0.42), .clear], center: .topTrailing, startRadius: 0, endRadius: geometry.size.height * 0.75)
                    RadialGradient(colors: [first.opacity(0.30), .clear], center: .bottomLeading, startRadius: 0, endRadius: geometry.size.width)
                }
            }.clipShape(.rect(cornerRadius: 26)).allowsHitTesting(false)
        }
    }
    private var header: some View {
        HStack(spacing: 12) {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !model.isPlaying || reduceMotion || !settings.values.rotation)) { context in
                Group {
                    if let artwork = model.artwork { Image(nsImage: artwork).resizable().scaledToFill() }
                    else { ZStack { Circle().fill(accent.opacity(0.7)); Image(systemName: "music.note").foregroundStyle(.white) } }
                }.frame(width: 44, height: 44).clipShape(Circle())
                    .rotationEffect(.degrees(settings.values.rotation && !reduceMotion ? model.angle(at: context.date) : 0))
            }.accessibilityLabel("专辑封面")
            VStack(alignment: .leading, spacing: 4) {
                Text(model.track?.title ?? "网易云桌面伴侣").foregroundStyle(ink).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                Text(model.track?.artist ?? "等待音乐响起").font(.system(size: 11)).foregroundStyle(quietInk).lineLimit(1)
            }
            Spacer(minLength: 0)
        }.frame(height: 48).help("拖动顶部移动窗口；右键打开设置")
    }
    private var lyricAnimation: Animation? { reduceMotion ? nil : .easeInOut(duration: 0.38) }
    private var lyrics: some View {
        GeometryReader { geometry in
            if let document = model.document, !document.lines.isEmpty {
                let font = LyricTypography.font(name: settings.values.lyricFont, size: settings.values.fontSize * 1.15, emphasized: true)
                let active = document.currentIndex(at: model.position + settings.values.offset)
                ScrollViewReader { proxy in
                    ScrollView(.vertical) {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(document.lines.enumerated()), id: \.element.id) { index, line in
                                lyricRow(line, active: active == line.id, distance: active.map { abs(index - $0) } ?? 0)
                                    .frame(height: rowHeight(line, width: geometry.size.width, viewport: geometry.size.height, font: font)).id(line.id)
                            }
                        }
                        .padding(.top, max(0, (geometry.size.height - (font.pointSize * 1.25 + (settings.values.lyricGap ?? 4))) / 3))
                        .padding(.bottom, max(0, (geometry.size.height - (font.pointSize * 1.25 + (settings.values.lyricGap ?? 4))) * 2 / 3))
                    }
                    .scrollIndicators(.hidden)
                    .onScrollPhaseChange { _, phase in
                        if phase == .interacting || phase == .tracking { model.following = false }
                    }
                    .onChange(of: active) { _, value in
                        guard model.following, let value else { return }
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.38)) { proxy.scrollTo(value, anchor: UnitPoint(x: 0.5, y: 1.0 / 3.0)) }
                    }
                    .onChange(of: model.following) { _, following in
                        if following, let active { withAnimation(lyricAnimation) { proxy.scrollTo(active, anchor: UnitPoint(x: 0.5, y: 1.0 / 3.0)) } }
                    }
                    .onChange(of: geometry.size) { _, _ in
                        if model.following, let active { proxy.scrollTo(active, anchor: UnitPoint(x: 0.5, y: 1.0 / 3.0)) }
                    }
                    .onAppear { if let active { proxy.scrollTo(active, anchor: UnitPoint(x: 0.5, y: 1.0 / 3.0)) } }
                    .overlay(alignment: .bottomTrailing) {
                        if !model.following { Button("回到当前") { model.following = true }.buttonStyle(.glass).controlSize(.small) }
                    }
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: model.track == nil ? "music.note" : "text.alignleft").font(.title2).foregroundStyle(quietInk)
                    Text(model.lyricsStatus).font(.system(size: 13)).foregroundStyle(quietInk).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
    private func rowHeight(_ line: LyricLine, width: Double, viewport: Double, font: NSFont) -> Double {
        let auxiliary = (settings.values.translation && line.translation != nil ? 18.0 : 0) + (settings.values.romanization && line.romanization != nil ? 18.0 : 0)
        let natural = LyricTypography.rowHeight(text: line.text, width: width, font: font, gap: settings.values.lyricGap ?? 4, auxiliary: auxiliary)
        return settings.values.visibleLines == 0 ? natural : max(natural, viewport / Double(settings.values.visibleLines))
    }
    private func lyricRow(_ line: LyricLine, active: Bool, distance: Int) -> some View {
        let alignment: Alignment = settings.values.alignment == "center" ? .center : settings.values.alignment == "right" ? .trailing : .leading
        let textAlignment: TextAlignment = settings.values.alignment == "center" ? .center : settings.values.alignment == "right" ? .trailing : .leading
        return Button {
            model.seek(line: line, offset: settings.values.offset)
        } label: {
            VStack(alignment: settings.values.alignment == "center" ? .center : settings.values.alignment == "right" ? .trailing : .leading, spacing: 3) {
                highlighted(line, active: active)
                    .font(Font(LyricTypography.font(name: settings.values.lyricFont, size: settings.values.fontSize * 1.15, emphasized: active)))
                    .bold(active)
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .scaleEffect(active ? 1 : max(0.65, (settings.values.fontSize - Double(distance) * 1.5) / (settings.values.fontSize * 1.15)), anchor: settings.values.alignment == "center" ? .center : settings.values.alignment == "right" ? .trailing : .leading)
                    .animation(lyricAnimation, value: distance)
                    .animation(lyricAnimation, value: active)
                if settings.values.translation, let text = line.translation { Text(text).font(.system(size: 11)).foregroundStyle(quietInk).lineLimit(1) }
                if settings.values.romanization, let text = line.romanization { Text(text).font(.system(size: 11)).foregroundStyle(quietInk).lineLimit(1) }
            }.multilineTextAlignment(textAlignment).frame(maxWidth: .infinity, alignment: alignment)
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel(line.text)
            .accessibilityAddTraits(active ? .isSelected : [])
            .help(model.canSeek ? "点击跳转到这句歌词" : "当前播放连接不支持跳转")
    }
    private func highlighted(_ line: LyricLine, active: Bool) -> Text {
        guard active else { return Text(line.text).foregroundColor(quietInk.opacity(0.72)) }
        guard !line.words.isEmpty else { return Text(line.text).foregroundColor(ink) }
        let time = model.position + settings.values.offset + (model.document?.offset ?? 0)
        return line.words.reduce(Text("")) { text, word in
            Text("\(text)\(Text(word.text).foregroundColor(time >= word.start ? ink : quietInk))")
        }
    }
    private var transport: some View {
        VStack(spacing: 10) {
            VStack(spacing: 2) {
                Slider(value: $seekPreview, in: 0...max(1, model.track?.duration ?? 1), onEditingChanged: { editing in
                    model.isSeeking = editing
                    if !editing { model.seek(seekPreview) }
                })
                .onAppear { seekPreview = model.position }
                .onChange(of: model.position) { _, value in if !model.isSeeking { seekPreview = value } }
                .tint(accent).disabled(!model.canSeek).accessibilityLabel("播放进度")
                HStack { Text(PlayerModel.time(model.position)); Spacer(); Text(PlayerModel.time(model.track?.duration ?? 0)) }
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(quietInk)
            }
            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(PlaybackMode.allCases, id: \.self) { mode in
                            Button(mode.rawValue) { model.changeMode(mode) }
                        }
                    } label: { Image(systemName: "repeat").frame(width: 16, height: 24) }
                        .menuIndicator(.hidden).buttonStyle(.glass).accessibilityLabel("播放方式")
                    Spacer(minLength: 0)
                    Button { model.skip(-1) } label: { Image(systemName: "backward.end.fill").frame(width: 24, height: 28) }
                        .buttonStyle(.glass).accessibilityLabel("上一首").keyboardShortcut(.leftArrow, modifiers: .command)
                    Button { model.toggle() } label: { Image(systemName: model.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 19)).frame(width: 34, height: 36) }
                        .buttonStyle(.glassProminent).tint(accent).accessibilityLabel(model.isPlaying ? "暂停" : "播放").keyboardShortcut(.space, modifiers: [])
                    Button { model.skip(1) } label: { Image(systemName: "forward.end.fill").frame(width: 24, height: 28) }
                        .buttonStyle(.glass).accessibilityLabel("下一首").keyboardShortcut(.rightArrow, modifiers: .command)
                    Spacer(minLength: 0)
                    Button { showQueue.toggle() } label: { Image(systemName: "list.bullet").frame(width: 16, height: 24) }
                        .buttonStyle(.glass).accessibilityLabel("播放列表")
                        .popover(isPresented: $showQueue) { QueueView(model: model) }
                }.buttonBorderShape(.circle).controlSize(.regular).disabled(model.track == nil)
            }
            if let error = model.actionError {
                Text(error).font(.system(size: 10)).foregroundStyle(quietInk).lineLimit(2)
            }
        }.help(model.status)
    }
}
