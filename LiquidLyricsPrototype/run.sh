#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
cmake -S Vendor/mediaremote-adapter -B .build/mediaremote -DCMAKE_BUILD_TYPE=Release
cmake --build .build/mediaremote -j 4
swift build -c release
APP="$PWD/.build/Liquid Lyrics.app"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources/MediaRemote" "$APP/Contents/Resources/ThirdPartyLicenses"
cp -R .build/mediaremote/MediaRemoteAdapter.framework "$APP/Contents/Resources/MediaRemote/"
cp Vendor/mediaremote-adapter/bin/mediaremote-adapter.pl "$APP/Contents/Resources/MediaRemote/"
cp ThirdPartyLicenses/*.txt "$APP/Contents/Resources/ThirdPartyLicenses/"
cp .build/release/LiquidLyrics "$APP/Contents/MacOS/LiquidLyrics"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>LiquidLyrics</string>
<key>CFBundleIdentifier</key><string>local.prototype.LiquidLyrics</string>
<key>CFBundleName</key><string>Liquid Lyrics</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
if [[ "${LIQUID_LYRICS_NO_OPEN:-0}" != "1" ]]; then open "$APP"; fi
