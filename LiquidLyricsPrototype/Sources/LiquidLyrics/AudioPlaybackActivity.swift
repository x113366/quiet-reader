// Adapted from CloudLyrics 6ef1beff (MIT), copyright 2026 hellomyonly55.
// See ThirdPartyLicenses/CloudLyrics-MIT.txt. Local read-only state decoding only.
import AppKit
import CoreAudio
import Foundation

@MainActor
protocol AudioPlaybackActivityProviding {
    func isRunningOutput(bundleIdentifier: String) -> Bool?
    func isRunningOutput(bundleIdentifier: String, processIdentifiers: [pid_t]) -> Bool?
}

extension AudioPlaybackActivityProviding {
    func isRunningOutput(bundleIdentifier: String, processIdentifiers: [pid_t]) -> Bool? {
        isRunningOutput(bundleIdentifier: bundleIdentifier)
    }
}

@MainActor
final class CoreAudioPlaybackActivity: AudioPlaybackActivityProviding {
    private struct CachedState {
        var value: Bool?
        var expiresAt: Date
    }

    private var cache: [String: CachedState] = [:]

    func isRunningOutput(bundleIdentifier: String) -> Bool? {
        let applications = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
        return isRunningOutput(bundleIdentifier: bundleIdentifier, processIdentifiers: applications.map(\.processIdentifier))
    }

    func isRunningOutput(bundleIdentifier: String, processIdentifiers: [pid_t]) -> Bool? {
        let now = Date()
        if let cached = cache[bundleIdentifier], cached.expiresAt > now { return cached.value }
        guard !processIdentifiers.isEmpty else {
            cache[bundleIdentifier] = .init(value: false, expiresAt: now.addingTimeInterval(1))
            return false
        }
        var receivedKnownState = false
        for processIdentifier in processIdentifiers {
            guard let isRunning = isRunningOutput(processIdentifier: processIdentifier) else { continue }
            receivedKnownState = true
            if isRunning {
                cache[bundleIdentifier] = .init(value: true, expiresAt: now.addingTimeInterval(0.5))
                return true
            }
        }
        let value: Bool? = receivedKnownState ? false : nil
        cache[bundleIdentifier] = .init(value: value, expiresAt: now.addingTimeInterval(0.5))
        return value
    }

    private func isRunningOutput(processIdentifier: pid_t) -> Bool? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var processIdentifier = processIdentifier
        var processObject: AudioObjectID = 0
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let translationStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<pid_t>.size),
            &processIdentifier,
            &size,
            &processObject
        )
        guard translationStatus == noErr, processObject != 0 else { return nil }

        address.mSelector = kAudioProcessPropertyIsRunningOutput
        var value: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(processObject, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value != 0
    }
}
