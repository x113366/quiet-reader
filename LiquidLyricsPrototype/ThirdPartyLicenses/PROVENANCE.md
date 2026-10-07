# Third-party provenance

- `Vendor/mediaremote-adapter`: https://github.com/ungive/mediaremote-adapter commit 29718252613a5b0e210bdc64de0bd944ab379706. BSD-3-Clause, unmodified source. LICENSE also retained in Vendor and packaged under Resources/ThirdPartyLicenses.
- `Sources/LiquidLyrics/NetEaseLocalState.swift`: adapted subset of CloudLyrics NetEaseLocalPlaybackBridge.swift at 6ef1beff400aa6b2ffb9113fb67551c74924f8c5. MIT, copyright 2026 hellomyonly55. Kept decoding, local log reader, progression estimator; removed its application adapters/scanner/control code; reader visibility adjusted.
- `Sources/LiquidLyrics/AudioPlaybackActivity.swift`: CloudLyrics at the same commit, MIT, unchanged implementation with provenance header.
- Lyrimuse (GPL-3.0), LyricsX (MPL-2.0), NotchPlayer (no license found at reviewed revision): research references only. No code/assets copied.

App-owned lyrics parser, provider routing, caching, SwiftUI UI and window/settings code are independently implemented.
