const { app, BrowserWindow, ipcMain, dialog, screen, Menu, clipboard, safeStorage, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { Accounts } = require('./cloud-account.cjs');
const {sumDays,setTransport}=require('./cloud-sync.cjs');
setTransport((...args)=>net.fetch(...args));
const { analyzeBook } = require('./analysis.cjs');
const {pythonRuntime}=require('./python-runtime.cjs');
const {initializeRuntime}=require('./first-run.cjs');
let analysisRuntime, runtimeReady;
const { defaults, settings } = require('./core.cjs');
if (process.env.QUIET_READER_DATA) app.setPath('userData', path.resolve(process.env.QUIET_READER_DATA));
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
let win, store, accounts, current, closing = false;
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
function restoreSize(width,height) {
  if(win.isMaximized())win.unmaximize();
  // Windows fractional display scaling can round native frame bounds upward.
  // Compensate against measured bounds instead of accumulating that error.
  let requestedWidth=width,requestedHeight=height;
  for(let i=0;i<4;i++) {
    win.setSize(requestedWidth,requestedHeight);
    const [actualWidth,actualHeight]=win.getSize();
    if(actualWidth===width && actualHeight===height)break;
    requestedWidth+=width-actualWidth;requestedHeight+=height-actualHeight;
  }
}
const read = (file, encoding = 'auto', extra={}) => new Promise((resolve, reject) => {
  const worker = new Worker(path.join(__dirname, 'import-worker.cjs'), {workerData:{path:file, encoding,...extra}});
  worker.once('message', data => data.error ? reject(new Error(data.error)) : resolve(data));
  worker.once('error', reject);
  worker.once('exit', code=>{ if(code) reject(new Error('解码进程异常退出')); });
});
function handler(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('无效请求');
    if(accounts?.busy&&!['cloud-status','window-control','window-buttons','copy-text'].includes(name))throw new Error('正在同步，请稍候再操作');
    return fn(...args);
  });
}
async function importFiles(paths, cleaning) {
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('一次最多导入 100 本');
  const results = [];
  for (const file of paths) {
    try {
      if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.txt') throw new Error('仅支持 TXT 文件');
      const data = await read(file,'auto',{cleaning});
      let book = await store.read(data.id);
      if (!book) {
        if(data.cleanedText!==undefined){await fs.writeFile(store.file(data.id,'txt'),data.cleanedText);await fs.copyFile(file,store.file(data.id,'original.txt'));}else await fs.copyFile(file, store.file(data.id, 'txt'));
        book = {id:data.id, title:path.basename(file, path.extname(file)), encoding:data.encoding, size:data.size, updated:Date.now(), settings:{...defaults}, window:{width:960,height:780}, progress:null,counts:data.counts,cleaning:{removed:data.removed||0}};
        await store.write(book);
      }
      results.push({id:book.id, title:book.title, warning:data.warning});
    } catch(e) { results.push({error:`${path.basename(String(file))}：${e.message}`}); }
  }
  return results;
}
async function createWindow() {
  win = new BrowserWindow({width:960,height:780,minWidth:420,minHeight:360,backgroundColor:'#212121',show:false,
    frame:process.platform==='darwin',titleBarStyle:process.platform==='darwin'?'hidden':undefined,trafficLightPosition:{x:16,y:19},resizable:true,hasShadow:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate', e=>e.preventDefault());
  win.on('close', event=>{ if (!closing) {event.preventDefault(); win.webContents.send('prepare-close');} });
  await win.loadFile(path.join(__dirname,'index.html'));
  win.show();
}
app.whenReady().then(async()=>{
  if(!hasLock)return;
  analysisRuntime=pythonRuntime({projectDir:path.resolve(__dirname,'..'),packaged:app.isPackaged});
  runtimeReady=initializeRuntime(analysisRuntime,app.getPath('userData'),app.getVersion());
  runtimeReady.catch(()=>{}); // Reading remains available if initialization fails; analysis reports the error.
  accounts=new Accounts(app.getPath('userData'),safeStorage);store=await accounts.init();
  handler('cloud-status',()=>accounts.status());
  handler('cloud-login',async payload=>{await store.queue;const result=await accounts.login(payload.username,payload.password,!!payload.register,!!payload.importLocal);store=accounts.store;current=null;return result;});
  handler('cloud-logout',async()=>{await store.queue;const result=await accounts.logout();store=accounts.store;current=null;return result;});
  handler('cloud-sync',active=>accounts.synchronize(active&&current?`book/${current}/reading`:null));
  handler('cloud-conflicts',()=>accounts.sync?accounts.sync.conflicts():[]);
  handler('cloud-resolve',(key,choice)=>accounts.exclusive(()=>accounts.sync.resolve(key,choice)));
  handler('studio-state',value=>{if(!value||JSON.stringify(value).length>8000000)throw new Error('词云草稿过大');return store.updatePreferences(p=>{p.studio=value;});});
  Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'darwin' ? [{label:'Quiet Reader',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'copy'},{role:'paste'},{role:'selectAll'}]}] : []));
  handler('library', async()=>{
    const books=await store.list();
    for(const book of books)if(!book.counts){const data=await read(store.file(book.id,'txt'),book.encoding,{anchor:book.progress?.anchor});book.counts=data.counts;await store.updateBook(book.id,b=>{b.counts=data.counts;});}
    return books;
  });
  handler('book-review',async(id,value)=>{const review=require('./book-info.cjs').review(value);return store.updateBook(id,b=>{b.review=review;});});
  handler('export-txt',async id=>{
    const book=await store.read(id);if(!book)throw new Error('书籍不存在');
    const selection=await dialog.showSaveDialog(win,{title:'导出当前阅读版本 TXT',defaultPath:book.title.replace(/[\\/:*?"<>|]/g,'_')+'.txt',filters:[{name:'TXT 文本',extensions:['txt']}]});
    if(selection.canceled)return false;
    if(path.resolve(selection.filePath)===path.resolve(store.file(id,'txt')))throw new Error('请选择书库数据目录以外的位置');
    const bytes=await fs.readFile(store.file(id,'txt'));const text=require('./core.cjs').decode(bytes,book.encoding).text;
    await fs.writeFile(selection.filePath,text,'utf8');return true;
  });
  handler('window-buttons', visible=>{if(process.platform==='darwin')win.setWindowButtonVisibility(Boolean(visible));});
  handler('copy-text', text=>{if(typeof text!=='string'||text.length>32000000)throw new Error('选区过大');clipboard.writeText(text);});
  handler('cleaning-presets', ()=>require('./cleaning.cjs').presets);
  handler('cleaning-preview',async(paths,cleaning)=>{
    if(!Array.isArray(paths)||paths.length>100)throw new Error('一次最多 100 本');
    const results=[];
    for(const file of paths){if(typeof file!=='string'||path.extname(file).toLowerCase()!=='.txt')throw new Error('仅支持 TXT');results.push({name:path.basename(file),...await read(file,'auto',{cleaning,preview:true})});}
    return results;
  });
  handler('cleaning-save', config=>{const value=require('./cleaning.cjs').options(config);delete value.patterns;return store.updatePreferences(p=>{p.cleaning=value;});});

  handler('preferences', ()=>store.preferences());
  handler('export-cloud', async data=>{
    if(typeof data!=='string'||data.length>40000000||!data.startsWith('data:image/png;base64,'))throw new Error('无效 PNG 图像');
    const selection=await dialog.showSaveDialog(win,{title:'导出词云 PNG',defaultPath:'字有引力-词云.png',filters:[{name:'PNG 图像',extensions:['png']}]});
    if(selection.canceled)return false;
    const bytes=Buffer.from(data.slice('data:image/png;base64,'.length),'base64');await fs.writeFile(selection.filePath,bytes);await require('./cloud-sync.cjs').atomic(path.join(store.root,'studio/latest.png'),bytes);return true;
  });
  handler('ui-style', style=>{if(!['dark','light'].includes(style))throw new Error('无效界面风格');return store.updatePreferences(p=>{p.uiStyle=style;});});
  handler('theme-save', theme=>{
    if(!theme || typeof theme.name!=='string' || !theme.name.trim() || theme.name.length>40) throw new Error('主题名称需为 1–40 个字符');
    return store.updatePreferences(p=>{
      p.themes ||= [];const name=theme.name.trim();const existing=p.themes.find(t=>t.name===name);
      if(!existing && p.themes.length>=50) throw new Error('最多保存 50 个主题');
      const value={name,settings:settings(theme.settings)};
      if(existing) Object.assign(existing,value); else p.themes.push(value);
    });
  });
  handler('reading-time', payload=>{
    if(!payload || payload.id!==current || !Number.isFinite(payload.ms) || payload.ms<0 || payload.ms>15000) throw new Error('无效阅读时长');
    const now=new Date();const day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    return store.updatePreferences(p=>{p.dayCounters||={[accounts.device.id]:p.days||{}};const own=p.dayCounters[accounts.device.id]||={};own[day]||={};own[day][payload.id]=(own[day][payload.id]||0)+payload.ms;p.days=sumDays(p.dayCounters);});
  });
  const analyses=new Map();
  handler('analyze', async id=>{
    if(analyses.has(id)) return analyses.get(id);
    const resources=app.isPackaged?path.join(process.resourcesPath,'analysis'):path.join(__dirname,'../analysis');
    await runtimeReady;
    const job=analyzeBook(store,id,resources,analysisRuntime);analyses.set(id,job);
    try{return await job;}finally{analyses.delete(id);}
  });

  handler('pick', async()=>{
    const selection = await dialog.showOpenDialog(win,{title:'导入 TXT 小说',properties:['openFile','multiSelections'],filters:[{name:'TXT 小说',extensions:['txt']}]});
    return selection.canceled ? [] : importFiles(selection.filePaths);
  });
  handler('import', importFiles);
  handler('open', async(id, encoding)=>{
    const book = await store.read(id); if(!book) throw new Error('书籍不存在');
    const data = await read(store.file(id,'txt'), encoding || book.encoding);
    if(encoding && encoding !== book.encoding) { book.encoding=data.encoding; book.progress=null;book.counts=data.counts; await store.write(book); }
    current=id;
    const area=screen.getDisplayMatching(win.getBounds()).workArea;
    restoreSize(Math.min(area.width,Math.max(420,book.window.width)),Math.min(area.height,Math.max(360,book.window.height)));
    win.setAlwaysOnTop(Boolean(book.view?.alwaysOnTop));
    book.settings=settings(book.settings);
    return {...book, counts:{...data.counts,read:book.counts?.read||0}, paragraphs:data.paragraphs, chapters:data.chapters, warning:data.warning};
  });
  handler('save', async(payload)=>{
    if(!payload || payload.id !== current) throw new Error('当前书籍已切换');
    if(JSON.stringify(payload.progress).length > 100000) throw new Error('进度数据过大');
    const bounds=win.isMinimized()?win.getNormalBounds():win.getBounds();
    await store.updateBook(payload.id,book=>{
    if(Number.isFinite(payload.readCount)&&book.counts)book.counts.read=Math.max(0,Math.min(book.counts.total,Math.floor(payload.readCount)));
    Object.assign(book,{settings:settings(payload.settings),progress:payload.progress,window:{width:bounds.width,height:bounds.height},view:{pure:Boolean(payload.view?.pure),alwaysOnTop:Boolean(payload.view?.alwaysOnTop)},updated:Date.now()});
    });return true;
  });
  handler('finish-close', async()=>{await store.queue; closing=true; win.close();});
  handler('window-control', action=>{
    if(action==='minimize')win.minimize();
    else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();
    else if(action==='close')win.close();
    else throw new Error('无效窗口操作');
  });
  handler('always-on-top', value=>{if(typeof value!=='boolean')throw new Error('无效置顶状态');win.setAlwaysOnTop(value);return win.isAlwaysOnTop();});
  handler('context-menu', options=>{
    const send=action=>()=>win.webContents.send('reader-action',action);
    Menu.buildFromTemplate([
      {label:'复制选中文字',enabled:!!options?.selection,click:send('copy-selection')},
      {label:options?.pure?'退出纯净阅读':'纯净阅读',click:send('toggle-pure')},
      {label:'窗口置顶',type:'checkbox',checked:win.isAlwaysOnTop(),click:send('toggle-top')},
      {type:'separator'},
      {label:'目录 / 进度跳转',click:send('navigation')},{label:'查找定位',click:send('search')},
      {label:'阅读设置',click:send('settings')},{label:'书库',click:send('library')},
      {type:'separator'},{label:'最小化',click:()=>win.minimize()},{label:'关闭窗口',click:()=>win.close()}
    ]).popup({window:win});
  });
  await createWindow();
}).catch(e=>{dialog.showErrorBox('无法启动阅读器',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
