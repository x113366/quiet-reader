const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const {readingCounts}=require('./book-info.cjs');
const {clean}=require('./cleaning.cjs');
const { decode, paragraphs, identity, chapters } = require('./core.cjs');
(async () => {
  const stat = await fs.stat(workerData.path);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的 TXT 文件');
  const bytes = await fs.readFile(workerData.path);
  const decoded = decode(bytes, workerData.encoding);
  const cleaned=clean(decoded.text,workerData.cleaning);
  if(workerData.preview){parentPort.postMessage({removed:cleaned.removed,matches:cleaned.matches});return;}
  const changed=cleaned.removed>0;
  const output=changed?Buffer.from(cleaned.text,'utf8'):bytes;
  const content = paragraphs(cleaned.text);
  if (!content.length) throw new Error('这份 TXT 没有正文');
  parentPort.postMessage({ id: identity(output), cleanedText:changed?cleaned.text:undefined, removed:cleaned.removed, encoding:changed?'utf-8':decoded.encoding, warning: decoded.warning, paragraphs: content, chapters:chapters(content), size: output.length, counts:readingCounts(content,workerData.anchor) });
})().catch(error => parentPort.postMessage({ error: error.message }));
