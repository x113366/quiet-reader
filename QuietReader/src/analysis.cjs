const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {decode} = require('./core.cjs');
// Never invoke a shell: book names and paths are passed as individual arguments.
async function analyzeBook(store, id, resourceDir, runtime) {
  const book = await store.read(id);
  if (!book) throw new Error('书籍不存在');
  const dir = path.join(store.root, 'analysis', id);
  await fs.mkdir(dir, {recursive:true});
  const source = path.join(dir, 'source.txt');
  const text = decode(await fs.readFile(store.file(id, 'txt')), book.encoding).text;
  let previous; try { previous = await fs.readFile(source, 'utf8'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  if(previous !== text) await fs.writeFile(source, text);
  await new Promise((resolve,reject)=>execFile(runtime.command, [...runtime.args,path.join(resourceDir,'analyze_novel.py'),source,'--out',path.join(dir,'analysis.json')],
    {timeout:600000,maxBuffer:1024*1024}, (error,_stdout,stderr)=>{
      if(error) reject(new Error(error.code==='ENOENT' ? '未找到 Python。请安装 Python 3 并设置 QUIET_READER_PYTHON。' : stderr.includes('No module named') ? '词云缺少 jieba：源码运行请执行 npm run setup:analysis；应用包请为 Python 安装 jieba==0.42.1。' : '词云分析失败或超时：'+stderr.slice(-500)));
      else resolve();
    }));
  return {...JSON.parse(await fs.readFile(path.join(dir,'analysis.json'),'utf8')),report:await fs.readFile(path.join(dir,'analysis_report.txt'),'utf8')};
}
module.exports={analyzeBook};
