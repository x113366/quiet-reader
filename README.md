# Quiet Reader · 静读

macOS / Windows TXT 阅读器，包含纯净阅读、书架、书评、广告清洗、词云工作室与 Supabase 云同步。

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

词云全文分析需要 Python 3.10+。`npm run setup:analysis` 会在仓库内建立独立环境并安装 jieba；不依赖开发者电脑上的目录。

打包应用从自身 Resources 目录读取分析脚本与停用词，使用系统 Python（Windows 使用 `py -3`），或使用 `QUIET_READER_PYTHON` 指定解释器。应用包不包含 Python 解释器；打包应用的解释器需安装 `jieba==0.42.1`。
