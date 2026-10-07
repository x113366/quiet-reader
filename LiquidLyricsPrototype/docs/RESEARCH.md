# 调研与技术路线 · 2026-10-07

## 代码基线与 License

| 项目 | 已读代码 | License / 本项目处理 |
| --- | --- | --- |
| [Lyrimuse](https://github.com/Yudaotor/lyrimuse/tree/d254390eca59ec38a37339a71c86b6735d1f2c0d) | LyrimuseCore/Lyrics/{YRCParser,LyricsSegmenter,LyricsRomanization,EnrichCacheKeys}，README / THIRD_PARTY_LICENSES | GPL-3.0；只研究，不复制代码和资源 |
| [CloudLyrics](https://github.com/hellomyonly55/CloudLyrics-for-macOS/tree/6ef1beff400aa6b2ffb9113fb67551c74924f8c5) | NetEaseLocalPlaybackBridge、MediaRemoteBridge、PlayerAdapter、AudioPlaybackActivity | MIT；复用本地只读解码/进度估算及 CoreAudio 活动查询，保留许可和来源 |
| [NotchPlayer](https://github.com/Tiger0821/notchPlayer/tree/641e78bd9cbd6010ada595cbbeac389090c7cded) | LyricsCore/{Providers,LyricsService,YRCParser} | 该快照未发现 LICENSE；不复制代码。自行实现解析与匹配 |
| [LyricsX](https://github.com/ddddxxx/LyricsX/tree/c16b6a413dda7bc0b793b897522e0c4ee0ffc716) | ScrollLyricsView、KaraokeLyricsView | MPL-2.0；只研究滚动、时间索引、Seek、Offset 的交互 |
| [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter/tree/29718252613a5b0e210bdc64de0bd944ab379706) | README、Perl 入口、CMake、get/stream/send/seek | BSD-3-Clause；固定源码版本随包构建，带完整许可 |

这是一份工程复用记录。项目自身尚未选择公开发布 License；上述许可证不因此改变。

## 比较结论

Lyrimuse 的价值在于统一逐行/逐字/翻译/罗马音模型、多源候选评分和缓存判决；它使用更庞大的 collector 与本地辅助工具体系。本项目选择较小的 Swift actor 服务，不移植整套系统。YRC 解析需要保留括号内歌词、处理 CRLF，不能简单按左括号切割。

CloudLyrics 直接 dlopen MediaRemote，但同时提供 NetEase lastPlaying 的只读 LevelDB 尾部扫描、播放队列匹配、CoreAudio 活动查询和 AX 菜单控制。它针对 3.1.8；本机是 3.1.13，必须实测。磁盘进度写入有延迟，LevelDB 压缩会暴露旧记录；时间倒退需要确认，暂停不能继续外推。控制不等于音频输出，CoreAudio 活动只作为状态证据。

NotchPlayer 支持多源优先级和逐字优先策略、按时长 ±3 秒过滤。它允许歌手不匹配但时长极近的结果；本项目更保守，搜索结果要求标题和歌手匹配且时长差 ≤3 秒，不用时长替代身份。确切网易云 song ID 可直接请求，避免搜索歧义。YRC 是毫秒绝对词时间，LRC 无逐字时间时不伪造逐字精度。

LyricsX 在时间轴中二分定位当前行，以居中滚动表现进度；浏览期间暂时取消跟随，点击对应时间 Seek。本项目用 ScrollViewReader + 用户滚动状态，提供显式恢复跟随。Offset 是歌词时间偏移，不修改播放器时钟；点击跳转要反向抵消 Offset。

## macOS 15.4+/26 Now Playing

Apple 没有供一般桌面应用读取任意其他应用 Now Playing 的公开、通用接口；MediaPlayer 的 MPNowPlayingInfoCenter 用于发布自己的信息。不要把直接 dlopen MediaRemote 的存在误认为权限或可用性保证。

上游 mediaremote-adapter 说明 15.4 后直接进程调用受限，通过系统 Perl 加载独立 framework 读取并控制，BSD-3-Clause。属于私有接口兼容层，未来系统更新可能失效，不承诺 App Store 分发。选择进程隔离、固定版本、超时退出、明确错误状态；不禁用 SIP，不注入 mediaremoted，不改系统配置。

网易云如果不发布系统 Now Playing，adapter 也不能凭空读到；因此采用本地只读状态作为网易云主路径，系统路径补全封面与可用控制。控制前必须校验 bundle ID 为 com.netease.163music，避免控制正在播放的浏览器或其他应用。AX 只在用户授权后使用，对 UI 结构变化显式报错。

## 架构与阶段

1. 纯模型、PlaybackProvider / LyricsProvider 协议、LRC/YRC 与匹配测试。
2. 网易云本地状态 + MediaRemote helper，带超时和能力检测；控制路由与 Seek。
3. 网易云 YRC → 网易云 LRC → LRCLIB → 本地 LRC，磁盘原子缓存、取消旧请求、翻译/罗马音。
4. 实时歌词 UI、浏览/跳转/Offset、封面与动态取色；保留官方 Liquid Glass。
5. 菜单栏、设置、纯歌词、窗口位置大小记忆、置顶/Space/穿透、打包运行验证。

保留 macOS 26 最低要求。设置持久化。测试覆盖解析边界、Offset、暂停时钟、身份匹配、源顺序；网络与真实网易云操作单独记录结果，不用假数据代替真实集成验证。

## 实测后修订

本机 3.1.13 与 CloudLyrics 的 3.1.8 假设不同：数据位于 `~/Library/Application Support/com.netease.163music`，同时发布有效的系统 Now Playing。纯本地进度估算在暂停测试中偏移数秒。因此改为身份校验成功的系统时间戳优先，本地状态补充 ID 与完整 metadata；系统不发布时才回退。系统 helper 轮询与 UI 的 20Hz 时钟插值分离；后续性能优化可换 stream，目前优先使用更简单、有 4 秒超时的 get 请求。
