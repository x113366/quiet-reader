const fs = require('node:fs/promises');
const path = require('node:path');
class Store {
  constructor(root) { this.root = root; this.queue = Promise.resolve(); }
  async init() { await fs.mkdir(path.join(this.root, 'books'), {recursive:true}); }
  file(id, ext) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效书籍标识'); return path.join(this.root, 'books', `${id}.${ext}`); }
  async read(id) {
    try { return JSON.parse(await fs.readFile(this.file(id, 'json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      try { return JSON.parse(await fs.readFile(this.file(id, 'json.bak'), 'utf8')); }
      catch { throw new Error('书籍状态损坏，原始 TXT 仍保存在数据目录中。'); }
    }
  }
  async list() {
    const files = await fs.readdir(path.join(this.root, 'books'));
    const rows = await Promise.all(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>this.read(f.slice(0,64))));
    return rows.filter(Boolean).sort((a,b)=>(b.updated || 0)-(a.updated || 0));
  }
  async preferences() {
    try { return JSON.parse(await fs.readFile(path.join(this.root,'preferences.json'),'utf8')); }
    catch(e) { if(e.code==='ENOENT') return {themes:[],days:{}}; throw e; }
  }
  updatePreferences(update) {
    const operation=this.queue.then(async()=>{
      const value=await this.preferences(); update(value);
      const target=path.join(this.root,'preferences.json');
      const handle=await fs.open(target+'.tmp','w');
      try {await handle.writeFile(JSON.stringify(value));await handle.sync();} finally {await handle.close();}
      await fs.rename(target+'.tmp',target); return value;
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  async writeNow(book) {
      const target = this.file(book.id, 'json');
      const handle = await fs.open(target + '.tmp', 'w');
      try { await handle.writeFile(JSON.stringify(book)); await handle.sync(); } finally { await handle.close(); }
      try { await fs.copyFile(target, target + '.bak'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      await fs.rename(target + '.tmp', target);
  }
  updateBook(id,update){
    const operation=this.queue.then(async()=>{const book=await this.read(id);if(!book)throw new Error('书籍不存在');update(book);await this.writeNow(book);return book;});
    this.queue=operation.catch(()=>{});return operation;
  }
  write(book) {
    const operation = this.queue.then(()=>this.writeNow(book));
    this.queue = operation.catch(()=>{});
    return operation;
  }
}
module.exports = { Store };
