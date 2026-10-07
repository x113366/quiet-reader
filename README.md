# Quiet Reader · 静读

macOS / Windows TXT 阅读器，包含纯净阅读、书架、书评、广告清洗、词云工作室与 Supabase 云同步。

## iPhone PWA

移动版位于 [`mobile/`](mobile/README.md)，通过 Safari 添加到主屏幕，提供离线 HTML 阅读、统一账号同步、书评、主题与阅读统计。

访问：**https://quiet-reader-405.pages.dev/**

```sh
cd mobile
npm ci
npm run build
npm run dev
```

移动版已部署到 Cloudflare Pages；GitHub Pages 保留为自动构建镜像。桌面功能和词云保留。详见 [移动版说明](mobile/README.md) 与 [验证记录](mobile/VALIDATION.md)。

## 桌面版

源码位于 [`QuietReader/`](QuietReader/)。

```sh
cd QuietReader
npm ci
npm run setup:analysis
npm start
```

- [功能与操作说明](QuietReader/CHANGES.md)
- [账号、云同步与 macOS 保活](QuietReader/CLOUD.md)
- [测试记录](QuietReader/VALIDATION.md)

```sh
npm test
npm run test:features
npm run test:books
npm run test:styles
npm run test:interaction
npm run test:e2e
npm run pack -- --mac --arm64
```

GitHub Release 安装包内置词云分析器、Python 运行环境和 jieba，首次打开自动建立分词缓存与初始化标记，后续直接复用。无需安装 Python、运行命令或联网下载依赖。

源码运行仍需 Python 3.10+，使用 `npm run setup:analysis` 初始化。制作安装包前，安装 `jieba==0.42.1` 和 `pyinstaller==6.19.0`，运行 `python scripts/build_analyzer.py`，然后为当前机器的系统和架构打包。GitHub Actions 会分别构建 macOS Apple Silicon、macOS Intel 和 Windows x64。

macOS 版本目前未经过 Apple 公证；首次打开若被系统拦截，请在“系统设置 → 隐私与安全性”中允许打开。

## Liquid Lyrics · 网易云桌面伴侣

原生 macOS 26 Swift/SwiftUI 应用位于 [LiquidLyricsPrototype](LiquidLyricsPrototype/README.md)，提供真实网易云播放同步、歌词与原生 Liquid Glass 悬浮窗口。
