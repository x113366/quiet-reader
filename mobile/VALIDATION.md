# iPhone PWA 验证记录

日期：2026-10-07。Node.js 24.14；Playwright 1.58.2；Chromium 145 与 WebKit 26，iPhone 13 尺寸与触摸模拟。

## 已通过

- 移动版生产构建；产物中未发现 Electron、Python、词云运行库或服务端秘密。
- 3 项协议测试：与桌面一致的摘要/段落格式，双端进度冲突、版本保护及记录，未知字段保留，离线失败重试、账号数据/正文隔离、分片下载校验。
- 桌面原有 11 项核心及同步测试全部通过；桌面源码未修改。
- Chromium 与 WebKit 浏览器：登录、TXT 导入、默认不清洗、原生 DOM 选区、有选区时点按不打开菜单、中心点按、全文搜索及高亮清除、书评保存、拖动进度并重开、深浅主题、退出/切换账号隔离、横屏无横向溢出；无 pageerror。
- Chromium：Service Worker 安装后断网刷新，已下载 TXT 正文正常打开。
- WebKit：独立本地源安装 Service Worker，关闭 HTTP 服务器后刷新及打开正文成功；手动清洗预览、删除广告行、IndexedDB 中原始文本保持完整。
- 真实 Supabase：reader_health 返回 200；错误用户名/密码返回拒绝；无效 token 被拒绝；CORS 允许 GitHub Pages origin。

## 测试边界

成功登录及多账号同步浏览器测试使用隔离的模拟 RPC；没有个人账号密码，未声称已用真实个人账号完成跨设备验收，也没有在生产创建测试账号。真实 RPC 健康与权限拒绝验证只读、无数据污染。

WebKit 的 Playwright 网络路由与 Service Worker 不能可靠混用，因此账号模拟测试禁用 Service Worker，离线测试另用真实 Service Worker 并关闭源站验证。Playwright 的 WebKit setOffline 导航内部错误不当作应用错误或通过结果。

已验证 HTML 选区以及手势保护；iPhone 真机系统复制菜单、剪贴板、分享面板、主屏幕安装和锁屏仍需真机验收。时间累计逻辑按 visibility/pagehide 暂停，90 秒无操作暂停，每 5 秒持久保存；不声称自动化模拟等价于真实锁屏。

源码中的 64 MB 导入上限与全量 HTML 排版不代表大文件已经做过真机性能压测。
