import SwiftUI

struct QueueView: View {
    @Bindable var model: PlayerModel
    @State private var query = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("网易云播放列表").font(.headline)
                Spacer()
                Button("刷新", systemImage: "arrow.clockwise") { model.refreshQueue() }
            }
            TextField("搜索歌曲或歌手", text: $query).textFieldStyle(.roundedBorder)
            if let error = model.actionError { Text(error).font(.caption).foregroundStyle(.secondary) }
            List {
                ForEach(Array(model.queue.filter { query.isEmpty || ($0.title + $0.artist).localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, track in
                    HStack {
                        Image(systemName: model.track?.id == track.id ? "speaker.wave.2.fill" : "music.note")
                            .foregroundStyle(model.track?.id == track.id ? Color.accentColor : .secondary)
                        VStack(alignment: .leading) {
                            Text(track.title).lineLimit(1)
                            Text(track.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Text(PlayerModel.time(track.duration)).font(.caption).monospacedDigit()
                    }
                    .listRowSeparator(.hidden)
                }
            }
            Text("共 \(model.queue.count) 首 · 当前队列只读，选曲请在网易云中操作").font(.caption).foregroundStyle(.secondary)
        }.padding(16).frame(width: 350, height: 440)
            .onAppear { model.refreshQueue() }
    }
}
