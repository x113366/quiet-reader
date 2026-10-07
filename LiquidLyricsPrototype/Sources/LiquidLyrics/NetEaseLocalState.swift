// Adapted from CloudLyrics 6ef1beff (MIT), copyright 2026 hellomyonly55.
// See ThirdPartyLicenses/CloudLyrics-MIT.txt. Local read-only state decoding only.
import ApplicationServices
import CommonCrypto
import Foundation

struct NetEaseLastPlayingState: Decodable, Equatable, Sendable {
    var current: TimeInterval
    var resourceDuration: TimeInterval?
    var resourceID: String
    var trackID: String?

    private enum CodingKeys: String, CodingKey {
        case current, resourceDuration, resourceID = "resourceId", trackID = "trackId"
    }

    var songID: String? {
        if !resourceID.isEmpty { return resourceID }
        guard let trackID, !trackID.isEmpty else { return nil }
        return trackID
    }
}

struct NetEaseProgressEstimator {
    private var songID: String?
    private var progress: TimeInterval = 0
    private var exactProgress: TimeInterval = 0
    private var observedAt: Date?
    private var wasPlaying = false
    private var pendingBackwardProgress: TimeInterval?

    mutating func update(
        songID: String,
        duration: TimeInterval?,
        exactProgress: TimeInterval,
        isPlaying: Bool,
        now: Date
    ) -> TimeInterval {
        let incomingProgress = max(0, exactProgress)
        if self.songID != songID {
            self.songID = songID
            self.exactProgress = incomingProgress
            progress = incomingProgress
            observedAt = now
            wasPlaying = isPlaying
            pendingBackwardProgress = nil
            return normalized(progress, duration: duration)
        }

        let exactChanged = abs(self.exactProgress - incomingProgress) > 0.001
        if exactChanged {
            let movedBackward = incomingProgress < self.exactProgress
            if movedBackward, isPlaying {
                if let pendingBackwardProgress,
                   abs(pendingBackwardProgress - incomingProgress) > 0.001 {
                    // A second advancing native value in the lower range
                    // confirms a real seek or same-track repeat.
                    self.exactProgress = incomingProgress
                    self.pendingBackwardProgress = nil
                    progress = incomingProgress
                    observedAt = now
                    wasPlaying = true
                    return normalized(progress, duration: duration)
                }

                // LevelDB compaction can expose one old lastPlaying record for
                // a single scan. Keep advancing from the last trusted value
                // until another distinct lower value confirms the jump.
                if pendingBackwardProgress == nil {
                    pendingBackwardProgress = incomingProgress
                }
                if wasPlaying, let observedAt {
                    progress += max(0, now.timeIntervalSince(observedAt))
                }
                self.observedAt = now
                wasPlaying = true
                return normalized(progress, duration: duration)
            }

            pendingBackwardProgress = nil
            self.exactProgress = incomingProgress
            if movedBackward {
                // A confirmed lower native value means a seek or same-track
                // repeat and is authoritative even while paused.
                progress = incomingProgress
            } else if !isPlaying {
                // A delayed forward write can arrive after audio has stopped.
                // Freeze at the furthest trusted point instead of snapping back
                // from interpolation to the older on-disk value.
                progress = max(progress, incomingProgress)
            } else {
                // Native progress is written at whole-second boundaries. It can
                // arrive after interpolation has already crossed a lyric time,
                // so a normal forward sample must never pull the display back.
                progress = max(progress, incomingProgress)
            }
            observedAt = now
            wasPlaying = isPlaying
            return normalized(progress, duration: duration)
        }

        pendingBackwardProgress = nil

        if wasPlaying, !isPlaying {
            // CoreAudio stopping is authoritative for motion, but lastPlaying
            // may lag several seconds. Freeze; never rewind to that stale value.
            progress = max(progress, incomingProgress)
            observedAt = now
            wasPlaying = false
            return normalized(progress, duration: duration)
        }

        if wasPlaying, isPlaying, let observedAt {
            progress += max(0, now.timeIntervalSince(observedAt))
        }
        self.observedAt = now
        wasPlaying = isPlaying
        progress = normalized(progress, duration: duration)
        return progress
    }

    private func normalized(_ value: TimeInterval, duration: TimeInterval?) -> TimeInterval {
        guard let duration, duration > 0 else { return value }
        return min(value, duration)
    }
}

struct NetEasePlaybackActivityResolver {
    static let staleInterval: TimeInterval = 6.5

    private var songID: String?
    private var exactProgress: TimeInterval?
    private var lastExactChangeAt: Date?

    mutating func resolve(
        songID: String,
        exactProgress: TimeInterval,
        audible: Bool?,
        now: Date
    ) -> Bool {
        if self.songID != songID || self.exactProgress.map({ abs($0 - exactProgress) > 0.001 }) != false {
            self.songID = songID
            self.exactProgress = exactProgress
            lastExactChangeAt = now
        }
        if let audible { return audible }
        guard let lastExactChangeAt else { return false }
        return now.timeIntervalSince(lastExactChangeAt) <= Self.staleInterval
    }
}

enum NetEaseLastPlayingDecoder {
    private static let marker = Array("lastPlaying".utf8)
    private static let key = Array(")(13daqP@ssw0rd~".utf8)

    static func decode(base64: String) -> NetEaseLastPlayingState? {
        guard let encrypted = Data(base64Encoded: base64),
              !encrypted.isEmpty,
              encrypted.count.isMultiple(of: kCCBlockSizeAES128),
              let decrypted = decrypt(encrypted),
              let state = try? JSONDecoder().decode(NetEaseLastPlayingState.self, from: decrypted),
              state.songID != nil,
              state.current.isFinite,
              state.current >= 0 else { return nil }
        return state
    }

    static func states(in data: Data) -> [(offset: Int, state: NetEaseLastPlayingState)] {
        let bytes = Array(data)
        guard bytes.count >= marker.count else { return [] }
        var results: [(Int, NetEaseLastPlayingState)] = []
        var markerStart = 0

        while markerStart <= bytes.count - marker.count {
            guard let found = find(marker, in: bytes, from: markerStart) else { break }
            let valueStart = found + marker.count
            let valueEnd = min(bytes.count, valueStart + 1_024)
            var cursor = valueStart

            while cursor < valueEnd {
                while cursor < valueEnd, !isBase64Byte(bytes[cursor]) { cursor += 1 }
                let runStart = cursor
                while cursor < valueEnd, isBase64Byte(bytes[cursor]), bytes[cursor] != 61 { cursor += 1 }
                var runEnd = cursor
                if cursor < valueEnd, bytes[cursor] == 61 {
                    runEnd += 1
                    cursor += 1
                    if cursor < valueEnd, bytes[cursor] == 61 {
                        runEnd += 1
                        cursor += 1
                    }
                }

                if runEnd - runStart >= 64 {
                    let maximumPrefix = min(16, runEnd - runStart - 64)
                    let maximumSuffix = min(16, runEnd - runStart - 64)
                    candidateLoop: for prefix in 0...maximumPrefix {
                        for suffix in 0...maximumSuffix {
                            let start = runStart + prefix
                            let end = runEnd - suffix
                            let length = end - start
                            guard length >= 64, length.isMultiple(of: 4) else { continue }
                            let encoded = String(decoding: bytes[start..<end], as: UTF8.self)
                            if let state = decode(base64: encoded) {
                                results.append((start, state))
                                break candidateLoop
                            }
                        }
                    }
                }

                if cursor == runStart { cursor += 1 }
            }
            markerStart = found + marker.count
        }
        return results
    }

    private static func decrypt(_ encrypted: Data) -> Data? {
        let outputCapacity = encrypted.count + kCCBlockSizeAES128
        var output = Data(count: outputCapacity)
        var outputLength = 0
        let status = output.withUnsafeMutableBytes { outputBytes in
            encrypted.withUnsafeBytes { encryptedBytes in
                key.withUnsafeBytes { keyBytes in
                    CCCrypt(
                        CCOperation(kCCDecrypt),
                        CCAlgorithm(kCCAlgorithmAES),
                        CCOptions(kCCOptionPKCS7Padding | kCCOptionECBMode),
                        keyBytes.baseAddress,
                        key.count,
                        nil,
                        encryptedBytes.baseAddress,
                        encrypted.count,
                        outputBytes.baseAddress,
                        outputCapacity,
                        &outputLength
                    )
                }
            }
        }
        guard status == kCCSuccess else { return nil }
        output.removeSubrange(outputLength..<output.count)
        return output
    }

    private static func find(_ needle: [UInt8], in bytes: [UInt8], from start: Int) -> Int? {
        guard start <= bytes.count - needle.count else { return nil }
        for index in start...(bytes.count - needle.count) where bytes[index] == needle[0] {
            if bytes[index..<(index + needle.count)].elementsEqual(needle) { return index }
        }
        return nil
    }

    private static func isBase64Byte(_ byte: UInt8) -> Bool {
        (65...90).contains(byte) || (97...122).contains(byte) ||
            (48...57).contains(byte) || byte == 43 || byte == 47 || byte == 61
    }
}

struct NetEaseLastPlayingStateCache {
    private(set) var state: NetEaseLastPlayingState?

    mutating func observeLog(_ candidate: NetEaseLastPlayingState) -> NetEaseLastPlayingState {
        state = candidate
        return candidate
    }

    mutating func bootstrapFromTable(_ candidate: NetEaseLastPlayingState) -> NetEaseLastPlayingState {
        guard state == nil else { return state! }
        state = candidate
        return candidate
    }

    mutating func reset() { state = nil }
}

final class NetEaseLastPlayingReader: @unchecked Sendable {
    private struct Signature: Equatable {
        var size: Int
        var modifiedAt: Date
    }

    private let directoryURL: URL
    private var signatures: [String: Signature] = [:]
    private var cache = NetEaseLastPlayingStateCache()

    init(containerURL: URL) {
        directoryURL = containerURL.appendingPathComponent(
            "Documents/storage/CEFCache/Local Storage/leveldb",
            isDirectory: true
        )
    }

    func read() -> NetEaseLastPlayingState? {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        ) else { return cache.state }

        var changedLogs: [(URL, Signature)] = []
        var changedTables: [(URL, Signature)] = []
        for url in urls {
            let extensionName = url.pathExtension.lowercased()
            guard extensionName == "log" || extensionName == "ldb",
                  let values = try? url.resourceValues(forKeys: keys),
                  values.isRegularFile == true,
                  let size = values.fileSize,
                  let modifiedAt = values.contentModificationDate else { continue }
            let signature = Signature(size: size, modifiedAt: modifiedAt)
            guard signatures[url.path] != signature else { continue }
            signatures[url.path] = signature
            if extensionName == "log" {
                changedLogs.append((url, signature))
            } else {
                changedTables.append((url, signature))
            }
        }

        changedLogs.sort { newer($0, than: $1) }
        for (url, signature) in changedLogs {
            guard let data = tail(of: url, size: signature.size) else { continue }
            if let state = NetEaseLastPlayingDecoder.states(in: data).last?.state {
                return cache.observeLog(state)
            }
        }

        // SSTables are a bootstrap fallback. During live playback, LevelDB
        // compaction may create a table that still contains older revisions of
        // lastPlaying; it must not replace a state already observed from the
        // append-only log.
        guard cache.state == nil else { return cache.state }

        changedTables.sort { newer($0, than: $1) }
        for (url, _) in changedTables {
            guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { continue }
            if let state = NetEaseLastPlayingDecoder.states(in: data).first?.state {
                return cache.bootstrapFromTable(state)
            }
        }
        return cache.state
    }

    func reset() {
        signatures.removeAll(keepingCapacity: true)
        cache.reset()
    }

    private func tail(of url: URL, size: Int) -> Data? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let maximumBytes = 128 * 1_024
        let start = max(0, size - maximumBytes)
        do {
            try handle.seek(toOffset: UInt64(start))
            return try handle.readToEnd()
        } catch {
            return nil
        }
    }

    private func newer(_ lhs: (URL, Signature), than rhs: (URL, Signature)) -> Bool {
        if lhs.1.modifiedAt != rhs.1.modifiedAt { return lhs.1.modifiedAt > rhs.1.modifiedAt }
        return lhs.0.lastPathComponent > rhs.0.lastPathComponent
    }
}

