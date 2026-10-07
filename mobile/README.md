# 静读 · iPhone PWA

通过 Safari 打开 **https://quiet-reader-405.pages.dev/**，选择「分享 → 添加到主屏幕」，再从图标进入独立窗口。首次联网打开并等资源安装完成，已下载书籍即可离线重开。建议 iOS 16 或更新版本。

## 开发与部署

```sh
cd mobile
npm ci
npm run build
npm run dev
# http://127.0.0.1:4173
```

纯静态产物位于 `mobile/dist/`，可部署到任意 HTTPS 静态站点或子路径。没有 Electron、Python、词云分析器或词云运行库；仅构建阶段需要 Node.js 24。直接复用桌面 `cleaning.cjs`、`search-engine.js` 和公开 `cloud-config.json`。

主站托管于 Cloudflare Pages，项目名为 `quiet-reader`，固定网址为 **https://quiet-reader-405.pages.dev/**。首次部署已完成。已登录 Wrangler 后，在 `mobile/` 运行：

```sh
npm run build
npx wrangler pages deploy dist --project-name quiet-reader --branch main
```

`wrangler.toml` 保存公开的项目名与构建目录，不包含凭据。Cloudflare 当前采用手动部署，推送 GitHub 不会自动更新 Cloudflare；重新发布时执行上面的命令。

`.github/workflows/mobile-pages.yml` 在 main 更新相关文件后构建并发布 GitHub Pages 镜像（https://x113366.github.io/quiet-reader/）。两个域名的本机缓存独立，通过同一账号同步；主屏幕安装请使用 Cloudflare 主站。其他托管平台应将 `dist/` 作为站点根目录；不要将整个仓库上传。Service Worker 按构建内容生成版本，更新下载完成后显示「新版本已就绪 · 更新」，点击保存进度并切换。应用只缓存同源静态资源，不缓存登录或 RPC 响应。

## 使用

- 独立书架显示排版封面、进度和已读/总字数；书封由书名生成。
- 点击书封直接进入纯净 HTML 正文。短点屏幕中央区域切换菜单；长按、拖动选区使用 Safari 原生选择与复制。菜单下方滑块跳转，书库按钮返回首页。
- 全文查找支持精确与模糊搜索，每次最多 200 条。点结果跳转，点「结束查找」清除高亮；关闭查找面板或按 Esc 也会清除。
- TXT 从「文件」导入，支持 UTF-8 与 GB18030。清洗每次默认关闭；手动启用、选择规则并预览后保存。精确/模糊规则删除匹配的整行，复用桌面规则与限制；原始字节另存，可从「导出 / 分享」取回。
- 书评支持 0–5 星、最多 20 个标签、10000 字评价。深浅风格覆盖所有页面；排版中的取色器、字号与行距可保存为主题，并同步到桌面。
- 阅读足迹独立显示累计时间与近十四天图表。只计前台阅读，面板打开、后台和锁屏暂停，90 秒无操作暂停；每 5 秒保存，突然终止最多损失末尾一个计时间隔。iOS 不需要持续后台运行。

## 账号与数据兼容

沿用现有 Supabase 项目 `pwrfvixjcswlxpqchhvd` 的 quiz-app 自定义账号：`reader_login` 调用 `quiz_login_user`，签发 reader 会话。**不是 Supabase Auth**。使用现有用户名/密码登录，不创建新账号体系。前端只打包公开 publishable key；不保存密码，会话 token 保存在本源 IndexedDB（浏览器不具备 Electron safeStorage）。请在私人设备使用，退出会移除本机 token，并尝试撤销云端会话。

沿用桌面迁移 `QuietReader/supabase/migrations/202610060001_reader_cloud.sql`，此次不改数据库。`book/<id>/base|reading|review`、`asset/books/…`、`theme/…`、`prefs/uiStyle|cleaning`、`time/<device>` 均使用原协议。SHA-256 标识与 JSON 稳定摘要一致，分片大小 393216 字节，下载验证大小与摘要。进度使用相同段落/字符锚点，排版变化后按段内比例定位，可能有行级偏差。

远端对象（包括移动端不用的桌面分析、工作室和未来字段）保留原始 JSON，仅改动实际编辑字段；不删除云端对象。移动端不下载或执行词云资产，只保存其远端清单，因而不会清除桌面数据。默认排版存于兼容的命名主题，避免新建桌面不认识的偏好键。

每个账号和未登录书架具有独立 IndexedDB 命名空间。使用浏览器 Web Locks 保证同一站点同时只有一个窗口写入，其他窗口提示关闭旧窗口再重开，避免多个 Safari/PWA 窗口覆盖进度。退出隐藏该账号书籍、保留其未上传修改；重新登录同一账号后继续。未登录书架不自动合并，请先登录再导入准备同步的书。

同步先拉取清单，再按已知版本进行比较并写入。两端同时修改同一个资源时保留双方，显示冲突供选择，不按最大百分比或本机时间静默覆盖。选择前持久保存冲突记录，可导出。每个资源完成后保存检查点，断网后重试；前台、联网及书架每分钟触发。阅读中延后到回书架同步，以免远端进度移动正在阅读的页面。

## 离线、备份与限制

云端书籍在书架显示「云端」，打开后下载正文并校验；「已下载」表示当前正文缓存有效。缓存管理可下载原文/正文，只允许移除已同步且无冲突的文件。移除本机缓存不删除云端数据。原文和正文均上传后才算完整备份。

Safari 存储可能被系统回收，持久存储请求也可能不被批准。缓存丢失后重新登录、同步、下载即可恢复已备份内容；尚未上传的数据无法从云端恢复。空间不足会明确报错，不把失败标记为已保存。建议定期同步及导出重要原文。单本上限 64 MB；超大 TXT 使用完整 HTML 排版，性能取决于手机内存。iPhone 系统分享与长按菜单需实机验证，自动化浏览器不能等价验证 iOS 系统界面。

## 关键验证

```sh
# 验证与桌面的数据协议一致性
npm test
# 浏览器验证（另一个终端先 npm run dev）
npx playwright install chromium webkit
npm run test:e2e
```

协议测试使用隔离内存服务，浏览器有效登录使用模拟 RPC，不需要真实账号密码；真实云端另验证健康、错误密码、无效会话拒绝与 CORS。实际个人账号登录及双端真实数据同步仍需使用者登录验收。测试数据不写入真实账号。完整记录见 `VALIDATION.md`。
