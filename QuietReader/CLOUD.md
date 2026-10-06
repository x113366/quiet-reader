# 云端账号与同步

本项目复用 quiz-app 的 `quiz_users` 账号。点击「账号」，输入已有用户名与密码；也可注册新账号。初次登录可勾选合并本机未登录书库。账号之间使用独立本地目录，退出后返回未登录书库。

## 同步范围与操作

- TXT 阅读副本、清洗前原文备份。
- 阅读位置、排版、窗口设置、字数统计、评分、标签与评价。
- 命名主题、深浅 UI、清洗规则。
- 阅读时长按设备贡献累计，同一设备的重复同步不会重复相加。
- 各书词云分析结果、词表、报告、词云编辑草稿，以及最近一次导出的词云 PNG。

登录后立即同步；书架页每分钟自动同步，联网后也会重试。阅读期间可以从「账号 → 立即同步」手动执行。同步下载数据后返回书架，重新打开书籍即可读取最新进度。退出账号前建议先同步；未上传的本地内容保留在该账号缓存中，下次登录继续上传。

进度、书评、主题等使用独立版本。两端同时修改同一份数据时显示冲突：可查看本机/云端版本后选择。被替换的冲突版本保存在本机账号目录 `conflicts/`，不会静默覆盖。离线失败保留待同步内容。当前应用没有删除书籍/主题的功能，因此不实现云端删除传播。

应用导出的其他外部文件不作为任意文件夹同步；云端存储的是应用管理的内容。其他旧应用的本地书库不会自动导入，共用的是账号身份。

## 实现与权限

`src/cloud-config.json` 仅含项目 URL 与可公开的 publishable/anon key，不含管理权限密钥。

阅读器通过 `reader_login` 验证现有账号并签发 30 天的随机会话令牌。数据库仅保存令牌摘要；客户端通过 Electron safeStorage 加密持久化令牌，不保存密码。每次云端操作在服务端校验会话并确定用户身份。数据表启用 RLS、禁止匿名/普通角色直接读写，仅开放经会话验证的专用 RPC。接口与现有 quiz-app 登录保持兼容。

文件以 SHA-256 校验的分片同步，更新采用版本比较，失败请求不会将未完成工作标记为已同步。所有网络请求在 Electron 主进程通过系统网络栈发送。

数据库迁移：`supabase/migrations/202610060001_reader_cloud.sql`。已部署到现有统一账号项目。迁移不会修改题库、其他应用的数据或原登录函数。

## macOS 登录启动保活

本机已安装 LaunchAgent：`~/Library/LaunchAgents/local.quietreader.supabase-keepalive.plist`。

- 用户登录时执行一次，之后每 12 小时请求 `reader_health`。
- 脚本和公开配置：`~/Library/Application Support/QuietReaderKeepalive/`。
- `keepalive.log` 记录成功/失败，超过 1 MB 自动轮换。
- 不使用账号密码、会话令牌或管理密钥。
- 电脑关机或离线时无法发出请求；保活不保证 Supabase 永不暂停。

在其他 Mac 安装：

```sh
python3 scripts/install_keepalive.py
```

卸载后台任务：

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.quietreader.supabase-keepalive.plist"
```

## 验证

`npm test` 运行离线核心及同步测试。`npm run test:cloud-live` 是手动运行的真实云端集成测试：创建两个临时账号，验证权限、分片、冲突和桌面登录，并生成 `test-results/cloud-cleanup.sql`，运行后须以管理权限执行该文件清理临时账号。
