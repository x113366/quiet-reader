// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "LiquidLyrics", platforms: [.macOS(.v26)], products: [.executable(name: "LiquidLyrics", targets: ["LiquidLyrics"])], targets: [.executableTarget(name: "LiquidLyrics"), .testTarget(name: "LiquidLyricsTests", dependencies: ["LiquidLyrics"])])
