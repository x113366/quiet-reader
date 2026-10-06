# Quiet Reader · 静读

macOS / Windows TXT 阅读器，包含纯净阅读、书架、书评、广告清洗、词云工作室与 Supabase 云同步。

源码位于 [`QuietReader/`](QuietReader/)。

```sh
cd QuietReader
npm ci
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

词云全文分析需要 Python 3 和 `analysis/requirements.txt` 中的 jieba。应用包随附分析脚本和停用词，不包含 Python 解释器。
