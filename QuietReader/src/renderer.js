const Analytics=window.ReadingAnalytics;
const sessionTracker=new Analytics.Tracker();let paceSessions=[],lastActivity=Date.now();
const $=id=>document.getElementById(id);
const viewport=$('viewport'),canvas=$('page'),ctx=canvas.getContext('2d');
const worker=new Worker('layout-worker.js');
const searchWorker=new Worker('search-worker.js');
let lastReadingAnchor=null,cloudTransfer=false,cloudJob=null;
let searchRequest=0,matches=[],matchIndex=-1,highlight=null;
let book=null,layout=null,widths=new Map(),logicalY=0,signature='',epoch=0,snapshots={};
let request=0,working=false,pendingAnchor=null,saveTimer,resizeTimer,noticeTimer,programmatic=-1,frame=0,saveChain=Promise.resolve();
let readyPromise=Promise.resolve(),readyResolve=null,opening=false;
let lastSaved=Date.now(),charPrefix=[];
const charCount=text=>Array.from(text.replace(/\s/gu,'')).length;
function currentReadCount(){if(screenMode!=='reading')return book?.counts?.read||0;if(!book||!layout)return 0;if(logicalY>0&&logicalY>=Math.max(0,layout.total-viewport.clientHeight)-1)return charPrefix.at(-1)||0;const anchor=capture();return (charPrefix[anchor.paragraph]||0)+charCount(book.paragraphs[anchor.paragraph].text.slice(0,anchor.offset));}
let screenMode='library';
let textSelection=null,selecting=false,selectionPointer=null,selectionScroll=0;
document.body.classList.toggle('mac',window.reader.platform==='darwin');
let view={pure:false,alwaysOnTop:false};
const MAX_SCROLL=8000000;
function notice(message, sticky=false){$('status').textContent=message;$('status').hidden=false;clearTimeout(noticeTimer);if(!sticky)noticeTimer=setTimeout(()=>$('status').hidden=true,3500);}
const report=e=>notice(e.message || String(e),true);
function key(){return [Math.round(viewport.clientWidth),Math.round(viewport.clientHeight),book.settings.fontSize,book.settings.lineHeight,book.settings.padding,devicePixelRatio].join(':');}
function lineAt(y){let lo=0,hi=layout.top.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(layout.top[mid]<=y)lo=mid;else hi=mid-1;}if(layout.top[lo]+layout.lh<=y && lo+1<layout.top.length)lo++;return lo;}
function capture(){if(!layout)return pendingAnchor;const i=lineAt(logicalY);return {paragraph:layout.p[i],offset:layout.start[i],dy:layout.top[i]-logicalY};}
function remember(){if(layout && signature){snapshots[signature]={anchor:capture(),epoch};const keys=Object.keys(snapshots);if(keys.length>20)delete snapshots[keys[0]];}}
function locate(anchor){if(!anchor)return 0;let lo=0,hi=layout.p.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(layout.p[mid]<anchor.paragraph || (layout.p[mid]===anchor.paragraph && layout.start[mid]<=anchor.offset))lo=mid;else hi=mid-1;}return layout.top[lo]-(Number.isFinite(anchor.dy)?anchor.dy:0);}
function scale(){const max=Math.max(0,(layout?.total||0)-viewport.clientHeight);return max>MAX_SCROLL ? max/MAX_SCROLL : 1;}
function position(y){logicalY=Math.max(0,Math.min(y,Math.max(0,layout.total-viewport.clientHeight)));programmatic=logicalY/scale();viewport.scrollTop=programmatic;programmatic=viewport.scrollTop;drawSoon();}
function drawSoon(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
function draw(){
  if(screenMode!=='reading')return;
  const w=viewport.clientWidth,h=viewport.clientHeight,dpr=devicePixelRatio;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=book?.settings.background||'#212121';ctx.fillRect(0,0,w,h);
  if(!book||!layout)return;
  const {fontSize,color}=book.settings;ctx.font=`${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;ctx.textBaseline='alphabetic';ctx.fillStyle=color;
  let i=lineAt(logicalY),visible=[];
  for(;i<layout.p.length && layout.top[i]<logicalY+h;i++){
    const text=book.paragraphs[layout.p[i]].text.slice(layout.start[i],layout.end[i]);
    let x=layout.inset+(layout.start[i]===0?fontSize*2:0);
    const y=layout.top[i]-logicalY+(layout.lh-fontSize)/2+fontSize*.84;
    let offset=layout.start[i];
    for(const ch of text){const width=widths.get(ch)||0;const marked=isSelected(layout.p[i],offset)||highlight&&highlight.paragraph===layout.p[i]&&offset>=highlight.start&&offset<highlight.end;
      if(marked){ctx.fillStyle='#494537';ctx.fillRect(x,layout.top[i]-logicalY,width,layout.lh);ctx.fillStyle='#c9c3ae';}
      ctx.fillText(ch,x,y);ctx.fillStyle=color;x+=width;offset+=ch.length;}
    visible.push(text);
  }
  $('accessible').textContent=visible.join('\n');
  updateProgress();updateReaderHUD();
}
function reflow(anchor=capture(),newBook=false){
  if(!book)return;
  if(!working)remember();
  pendingAnchor=anchor;working=true;request++;
  if(!readyResolve)readyPromise=new Promise(resolve=>{readyResolve=resolve;});
  const sig=key();
  const exact=snapshots[sig];
  if(exact && exact.epoch===epoch)pendingAnchor=exact.anchor;
  worker.postMessage({request,...book.settings,width:viewport.clientWidth,paragraphs:newBook?book.paragraphs:undefined});
}
worker.onmessage=({data})=>{
  if(data.request!==request)return;
  if(data.error){working=false;readyResolve?.();readyResolve=null;report(new Error(data.error));return;}
  layout=data;widths=new Map(data.widths);signature=key();
  $('spacer').style.height=Math.min(data.total,MAX_SCROLL+viewport.clientHeight)+'px';
  position(locate(pendingAnchor));working=false;remember();
  readyResolve?.();readyResolve=null;scheduleSave();
};
worker.onerror=e=>{working=false;readyResolve?.();readyResolve=null;report(new Error('排版失败：'+e.message));};
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(report),Math.max(0,Math.min(500,3000-(Date.now()-lastSaved))));}
async function save(){
  clearTimeout(saveTimer);if(!book)return;if(cloudTransfer)await cloudJob.catch(()=>{});
  await readyPromise;remember();
  const readCount=currentReadCount();
  const currentAnchor=capture(),moved=JSON.stringify(currentAnchor)!==JSON.stringify(lastReadingAnchor);
  const progress=moved?{anchor:currentAnchor,updatedAt:Date.now(),epoch,snapshots:structuredClone(snapshots)}:book.progress;
  const payload={id:book.id,readCount:moved?readCount:book.counts?.read,settings:{...book.settings},view:{...view},progress};
  book.progress=progress;lastReadingAnchor=currentAnchor;book.counts={total:charPrefix.at(-1)||0,read:payload.readCount||0};
  saveChain=saveChain.catch(()=>{}).then(()=>window.reader.save(payload));await saveChain;lastSaved=Date.now();
}
async function openBook(id,encoding){
  if(opening)return;opening=true;
  try{
    if(cloudUser&&screenMode==='library'&&(cloudRun||Date.now()-lastAutoSync>5000))await synchronizeCloud(false);
    await flushReading();await save();notice('正在打开…',true);
    const next=await window.reader.open(id,encoding);
    textSelection=null;book=next;charPrefix=[0];for(const p of book.paragraphs)charPrefix.push(charPrefix.at(-1)+charCount(p.text));if(!next.progress&&uiStyle==='light'){book.settings.background='#fbf8f1';book.settings.color='#243c35';}layout=null;signature='';logicalY=0;snapshots=next.progress?.snapshots||{};epoch=next.progress?.epoch||0;
    screenMode='reading';setScreen();
    view={pure:true,alwaysOnTop:Boolean(next.view?.alwaysOnTop)};document.body.classList.toggle('pure',view.pure);syncWindowButtons();
    $('navigation-button').disabled=false;$('pure-button').disabled=false;$('reading-progress-bar').hidden=false;$('navigation').close();$('chapter-filter').value='';
    searchRequest++;matches=[];matchIndex=-1;highlight=null;$('matches').replaceChildren();$('search-count').textContent='输入关键词开始查找';$('search-button').disabled=false;$('search').close();searchWorker.postMessage({paragraphs:book.paragraphs});
    $('welcome').hidden=true;$('book-title').textContent=book.title;document.title=book.title+' · 静读';$('settings-button').disabled=false;
    $('cloud-button').disabled=false;$('settings').close();syncSettings();reflow(next.progress?.anchor||null,true);
    await readyPromise;paceSessions=Analytics.sessions((await window.reader.preferences()).dayCounters);sessionTracker.pause();lastActivity=Date.now();lastReadingAnchor=capture();updateReaderHUD();$('status').hidden=true;if(next.warning)notice(next.warning,true);viewport.focus();
  }finally{opening=false;}
}
viewport.addEventListener('scroll',()=>{
  if(Math.abs(viewport.scrollTop-programmatic)<1){programmatic=-1;return;}
  if(!layout||working)return;
  logicalY=viewport.scrollTop*scale();epoch++;snapshots={};remember();drawSoon();scheduleSave();
},{passive:true});
viewport.addEventListener('wheel',e=>{
  if(!layout||working)return;
  if(scale()>1){e.preventDefault();const dy=e.deltaY*(e.deltaMode===1?layout.lh:e.deltaMode===2?viewport.clientHeight:1);position(logicalY+dy);epoch++;snapshots={};remember();scheduleSave();}
},{passive:false});
new ResizeObserver(()=>{
  drawSoon();if(!book||opening||screenMode!=='reading')return;clearTimeout(resizeTimer);
  const anchor=working?pendingAnchor:capture();
  // Keep the last completed layout's exact anchor throughout live resize.
  if(!working)remember();
  resizeTimer=setTimeout(()=>reflow(anchor),110);
}).observe(viewport);
async function showLibrary(){await flushReading();await save();screenMode='library';if(typeof cloudUser!=='undefined'&&cloudUser&&!cloudWorking)await synchronizeCloud(false,true);const books=await window.reader.library();$('books').replaceChildren();
  if(!books.length){const p=document.createElement('p');p.className='hint';p.textContent='书库还是空的。选择「导入 TXT」开始。';$('books').append(p);}
  for(const item of books){
    const card=document.createElement('article');card.className='shelf-card';
    const button=document.createElement('button');button.className='book';button.dataset.id=item.id;
    const cover=document.createElement('div');cover.className='book-cover';cover.textContent=item.title;cover.dataset.tone=String(parseInt(item.id.slice(0,2),16)%4);
    const title=document.createElement('strong');title.textContent=item.title;button.title=item.title;
    const total=item.counts?.total||0,read=item.counts?.read||0,percent=total?read/total*100:0;
    const meta=document.createElement('span');meta.className='book-progress';meta.textContent=`${percent.toFixed(1)}% · ${read.toLocaleString()} / ${total.toLocaleString()} 字`;
    const meter=document.createElement('progress');meter.max=total||1;meter.value=read;meter.setAttribute('aria-label','阅读进度');
    button.append(cover,title,meta,meter);button.onclick=()=>openBook(item.id).catch(report);
    const summary=document.createElement('p');summary.className='book-review-summary';summary.textContent=[item.review?.rating?'★'.repeat(item.review.rating):'未评分',...(item.review?.tags||[])].join(' · ');
    const actions=document.createElement('div');actions.className='book-actions';
    for(const [label,action] of [['书评',()=>showReview(item)],['导出 TXT',()=>exportBook(item.id)]]){const control=document.createElement('button');control.textContent=label;control.onclick=action;actions.append(control);}
    card.append(button,summary,actions);$('books').append(card);
  }
  book=null;layout=null;screenMode='library';setScreen();$('book-count').textContent=books.length+' 本';
}
async function imported(results){const errors=results.filter(r=>r.error).map(r=>r.error);const ok=results.filter(r=>r.id);if(ok.length===1)await openBook(ok[0].id);else if(ok.length)await showLibrary();if(errors.length)notice(errors.join('；'),true);}
async function pick(){$('file-input').click();}
$('file-input').onchange=()=>{beginImport([...$('file-input').files]).catch(report);$('file-input').value='';};
$('import-button').onclick=()=>pick().catch(report);$('welcome-import').onclick=()=>pick().catch(report);$('library-button').onclick=()=>showLibrary().catch(report);
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
$('settings-button').onclick=()=>{syncSettings();$('settings').showModal();};
function syncSettings(){for(const id of ['fontSize','lineHeight','padding','color','background'])$(id).value=book.settings[id];$('font-value').value=book.settings.fontSize+' px';$('line-value').value=book.settings.lineHeight.toFixed(1)+' 倍';$('padding-value').value=book.settings.padding+' px';$('encoding').value=book.encoding;syncViewControls();}
function syncViewControls(){$('pure-mode').checked=view.pure;$('always-on-top').checked=view.alwaysOnTop;}
for(const id of ['fontSize','lineHeight','padding','color','background'])$(id).addEventListener('input',()=>{
  const anchor=working?pendingAnchor:capture();if(!working)remember();
  book.settings[id]=['color','background'].includes(id)?$(id).value:Number($(id).value);syncSettings();
  if(['color','background'].includes(id)){drawSoon();scheduleSave();}else reflow(anchor);
});
$('reset').onclick=()=>{const anchor=working?pendingAnchor:capture();remember();book.settings={fontSize:22,lineHeight:1.9,padding:64,color:'#888888',background:'#212121'};syncSettings();reflow(anchor);};
$('encoding').onchange=()=>openBook(book.id,$('encoding').value).catch(report);
let dragDepth=0;
window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('drop-hint').hidden=false;});
window.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
window.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('drop-hint').hidden=true;}});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-hint').hidden=true;beginImport([...e.dataTransfer.files]).catch(report);});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();pick().catch(report);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();showLibrary().catch(report);}});
function showSearch(){if(!book||screenMode!=='reading')return;$('search').showModal();$('query').focus();$('query').select();}
$('search-button').onclick=showSearch;
$('search').addEventListener('close',()=>{highlight=null;drawSoon();});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();showSearch();}if(e.key==='Escape'&&!$('search').open){highlight=null;drawSoon();}});
$('search-form').onsubmit=e=>{e.preventDefault();if(!book)return;$('search-count').textContent='正在查找…';searchWorker.postMessage({request:++searchRequest,query:$('query').value,mode:$('search-mode').value});};
searchWorker.onmessage=({data})=>{if(data.request!==searchRequest)return;if(data.error){report(new Error(data.error));return;}matches=data.results;matchIndex=-1;$('matches').replaceChildren();$('search-count').textContent=matches.length===200?'显示前 200 处，请缩短范围或补充关键词':matches.length?`找到 ${matches.length} 处，点击结果跳转`:'没有找到匹配内容，可尝试模糊匹配';
  matches.forEach((match,index)=>{const button=document.createElement('button');button.className='match';button.textContent=`${index+1} · ${match.excerpt}`;button.onclick=()=>jumpMatch(index,true);$('matches').append(button);});};
function jumpMatch(index,close=false){if(!matches.length||working)return;sessionTracker.pause();matchIndex=(index+matches.length)%matches.length;highlight=matches[matchIndex];position(locate({paragraph:highlight.paragraph,offset:highlight.start,dy:layout.lh*2}));epoch++;snapshots={};remember();scheduleSave();$('matches').querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-current',String(i===matchIndex)));$('search-count').textContent=`第 ${matchIndex+1} / ${matches.length}${matches.length===200?'（前200处）':''} 处`;if(close){$('search').close();viewport.focus();}}
$('previous-match').onclick=()=>jumpMatch(matchIndex-1,true);$('next-match').onclick=()=>jumpMatch(matchIndex+1,true);
window.reader.onClose(async()=>{try{if(resizeTimer){clearTimeout(resizeTimer);if(book&&layout&&signature!==key())reflow(capture());}await flushReading();await save();if(cloudUser)await synchronizeCloud(false);await window.reader.finishClose();}catch(e){report(new Error('保存失败，窗口已保留：'+e.message));}});
window.addEventListener('blur',()=>save().catch(report));
function updateProgress(){if(!layout)return;const maximum=Math.max(0,layout.total-viewport.clientHeight);const value=maximum?logicalY/maximum*10000:0;
  for(const id of ['reading-progress','navigation-progress'])$(id).value=value;
  for(const id of ['reading-percentage','navigation-percentage'])$(id).textContent=(value/100).toFixed(2)+'%';
}
function jumpTo(y){if(!layout||working)return;sessionTracker.pause();highlight=null;position(y);epoch++;snapshots={};remember();scheduleSave();}
for(const id of ['reading-progress','navigation-progress'])$(id).addEventListener('input',()=>jumpTo(Number($(id).value)/10000*Math.max(0,layout.total-viewport.clientHeight)));
function renderChapters(){const filter=$('chapter-filter').value.trim().toLowerCase();const chapters=book.chapters.filter(c=>c.title.toLowerCase().includes(filter));const anchor=capture();let current=-1;for(let i=0;i<book.chapters.length;i++)if(book.chapters[i].paragraph<=(anchor?.paragraph||0))current=book.chapters[i].paragraph;
  $('chapters').replaceChildren();$('chapter-count').textContent=`${chapters.length} 个章节${chapters.length>400?'，显示前 400 个；可输入标题筛选':''}`;
  for(const chapter of chapters.slice(0,400)){const button=document.createElement('button');button.className='chapter';button.textContent=chapter.title;button.dataset.paragraph=chapter.paragraph;button.setAttribute('aria-current',String(chapter.paragraph===current));button.onclick=()=>{jumpTo(locate({paragraph:chapter.paragraph,offset:0,dy:32}));$('navigation').close();viewport.focus();};$('chapters').append(button);}
}
function showNavigation(){if(!book||screenMode!=='reading')return;updateProgress();renderChapters();$('navigation').showModal();}
$('navigation-button').onclick=showNavigation;$('chapter-filter').oninput=renderChapters;
function togglePure(value=!view.pure){if(!book||screenMode!=='reading')return;const anchor=working?pendingAnchor:capture();if(!working)remember();view.pure=value;document.body.classList.toggle('pure',value);syncWindowButtons();syncViewControls();if(value)document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());reflow(anchor);}
async function toggleTop(value=!view.alwaysOnTop){view.alwaysOnTop=await window.reader.alwaysOnTop(value);syncViewControls();scheduleSave();}
$('pure-button').onclick=()=>togglePure();$('pure-mode').onchange=()=>togglePure($('pure-mode').checked);$('always-on-top').onchange=()=>toggleTop($('always-on-top').checked).catch(report);
for(const [id,action] of [['minimize-window','minimize'],['maximize-window','maximize'],['close-window','close']])$(id).onclick=()=>window.reader.windowControl(action).catch(report);
window.addEventListener('contextmenu',e=>{if(!book||e.target.closest('input,textarea'))return;e.preventDefault();window.reader.contextMenu({pure:view.pure,selection:!!selectedText()}).catch(report);});
window.reader.onAction(action=>{
  if(action==='copy-selection')window.reader.copyText(selectedText()).catch(report);else if(action==='toggle-pure')togglePure();else if(action==='toggle-top')toggleTop().catch(report);else if(action==='navigation')showNavigation();else if(action==='search')showSearch();else if(action==='library')showLibrary().catch(report);else if(action==='settings'&&book){syncSettings();$('settings').showModal();}
});
document.addEventListener('keydown',e=>{
  const command=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(command&&key==='j'){e.preventDefault();showNavigation();}
  if(command&&e.shiftKey&&key==='p'){e.preventDefault();togglePure();}
  if(command&&e.shiftKey&&key==='t'){e.preventDefault();toggleTop().catch(report);}
  if(e.key==='Escape'&&screenMode==='reading'&&!document.querySelector('dialog[open]')){e.preventDefault();togglePure();}
});
// Read-only diagnostics, useful for reproducible regression tests.
window.readerDiagnostics=()=>({screenMode,id:book?.id,encoding:book?.encoding,settings:book?.settings,view,chapters:book?.chapters,anchor:capture(),signature,working,opening,lines:layout?.p.length,logicalY,total:layout?.total,paragraphs:book?.paragraphs.length,visible:$('accessible').textContent,epoch,highlight});

function syncWindowButtons(){window.reader.windowButtons(!(screenMode==='reading'&&view.pure)).catch(report);}
function setScreen(){
  syncWindowButtons();$('reading-hud').hidden=screenMode!=='reading';
  $('cloud-button').disabled=false;
  document.body.classList.toggle('library-view',screenMode==='library');
  document.body.classList.toggle('stats-view',screenMode==='stats');
  document.body.classList.toggle('studio-view',screenMode==='studio');$('studio-frame').hidden=screenMode!=='studio';
  document.body.classList.toggle('pure',screenMode==='reading'&&view.pure);
  $('library').hidden=screenMode!=='library';$('statistics').hidden=screenMode!=='stats';
  if(screenMode!=='reading'){
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    $('book-title').textContent='静读 · Quiet Reader';
  }
  for(const id of ['navigation-button','search-button','settings-button','pure-button','review-button','export-button'])$(id).disabled=screenMode!=='reading';
}
let pointerStart=null;
viewport.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY,scroll:logicalY};});
viewport.addEventListener('pointerup',e=>{
  if(!pointerStart||e.button!==0||screenMode!=='reading')return;
  const start=pointerStart;pointerStart=null;const r=viewport.getBoundingClientRect();
  if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>8||Math.abs(logicalY-start.scroll)>3)return;
  if(e.clientX>r.left+r.width*.15&&e.clientX<r.right-r.width*.15&&e.clientY>r.top+r.height*.15&&e.clientY<r.bottom-r.height*.15)togglePure();
});
$('shelf-import').onclick=()=>pick().catch(report);
let savedThemes=[];
async function loadThemes(){
  const preferences=await window.reader.preferences();savedThemes=preferences.themes||[];
  $('theme-select').replaceChildren(new Option('选择主题…',''));
  savedThemes.forEach((theme,i)=>$('theme-select').add(new Option(theme.name,String(i))));
}
$('save-theme').onclick=async()=>{
  try{await window.reader.saveTheme({name:$('theme-name').value,settings:book.settings});await loadThemes();await save();$('theme-status').textContent='主题已保存，重启后可在任意书籍中使用。';}catch(e){$('theme-status').textContent=e.message;}
};
$('theme-select').onchange=()=>{
  const theme=savedThemes[Number($('theme-select').value)];if(!theme||$('theme-select').value==='')return;
  const anchor=capture();book.settings={...theme.settings};$('theme-name').value=theme.name;syncSettings();reflow(anchor);
};
// Session checkpoints use cumulative values, making retries idempotent.
let lastTick=performance.now(),timeChain=Promise.resolve(),wasReading=false;
const pendingSessions=new Map();
function readingActive(){return Boolean(book&&layout&&!working&&!opening&&screenMode==='reading'&&document.hasFocus()&&!document.hidden&&!document.querySelector('dialog[open]')&&Date.now()-lastActivity<90000);}
function tickReading(){const now=performance.now(),delta=now-lastTick;lastTick=now;const active=readingActive();
 if(active&&wasReading&&delta>0&&delta<2500){const record=sessionTracker.add({bookId:book.id,read:currentReadCount(),total:charPrefix.at(-1)||0,ms:delta,platform:'desktop'});if(record)pendingSessions.set(record.id,record);}
 if(!active)sessionTracker.pause();wasReading=active;updateReaderHUD();
}
function flushReading(){tickReading();if(cloudTransfer)return timeChain;
 const pending=[...pendingSessions.values()];pendingSessions.clear();
 for(const record of pending)timeChain=timeChain.then(async()=>{await window.reader.readingTime({id:record.bookId,ms:0,session:record});paceSessions=paceSessions.filter(item=>item.id!==record.id);paceSessions.push(record);}).catch(e=>{if(!pendingSessions.has(record.id)||pendingSessions.get(record.id).durationMs<record.durationMs)pendingSessions.set(record.id,record);report(new Error('阅读记录保存失败：'+e.message));});return timeChain;
}
function updateReaderHUD(){if(!book||!layout||screenMode!=='reading')return;
 const read=currentReadCount(),total=charPrefix.at(-1)||0,estimate=Analytics.estimate(total-read,paceSessions,sessionTracker.current);
 $('hud-clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 $('hud-progress').textContent=`${(total?Math.min(100,read/total*100):0).toFixed(1)}%`;
 $('hud-eta').textContent=estimate.text;$('hud-eta').title=estimate.description;$('hud-eta').setAttribute('aria-label',estimate.text+'，'+estimate.description);
 document.body.style.setProperty('--reading-paper',book.settings.background);
 const hex=book.settings.background.slice(1),brightness=parseInt(hex.slice(0,2),16)*.299+parseInt(hex.slice(2,4),16)*.587+parseInt(hex.slice(4,6),16)*.114;
 $('reading-hud').style.setProperty('--hud-gray',brightness>150?'#737373':'#999999');
}
setInterval(tickReading,1000);setInterval(flushReading,5000);
for(const name of ['pointerdown','wheel','keydown'])document.addEventListener(name,()=>{lastActivity=Date.now();},{passive:true});
window.addEventListener('blur',()=>{tickReading();wasReading=false;flushReading();});
window.addEventListener('focus',()=>{lastActivity=Date.now();lastTick=performance.now();wasReading=readingActive();updateReaderHUD();});
document.addEventListener('visibilitychange',()=>{tickReading();wasReading=false;flushReading();});
const modalObserver=new MutationObserver(()=>{tickReading();wasReading=false;});
document.querySelectorAll('dialog').forEach(d=>modalObserver.observe(d,{attributes:true,attributeFilter:['open']}));
async function showStats(){await flushReading();await save();sessionTracker.pause();screenMode='stats';setScreen();
 const [preferences,books]=await Promise.all([window.reader.preferences(),window.reader.library()]);
 window.ReadingStats.render($('stats-dashboard'),{days:preferences.days||{},books,sessions:Analytics.sessions(preferences.dayCounters)});
}
$('stats-button').onclick=()=>showStats().catch(report);$('stats-back').onclick=()=>showLibrary().catch(report);
let uiStyle='dark',studioReady=false,studioReturn='library',cloudAccountEpoch=0;
const studio=$('studio-frame');
function sendStudio(message){if(studioReady)studio.contentWindow.postMessage(message,'*');}
function applyStyle(style){
  uiStyle=style;document.body.dataset.ui=style;
  $('ui-style-button').textContent=style==='dark'?'浅色 UI':'深色 UI';
  sendStudio({type:'ui-style',style});
}
async function switchStyle(){
  const style=uiStyle==='dark'?'light':'dark';await window.reader.uiStyle(style);applyStyle(style);
  if(book){book.settings.background=style==='light'?'#fbf8f1':'#212121';book.settings.color=style==='light'?'#243c35':'#888888';syncSettings();drawSoon();await save();}
}
$('ui-style-button').onclick=()=>switchStyle().catch(report);
$('cloud-button').onclick=async()=>{
  try{await flushReading();await save();studioReturn=screenMode;screenMode='studio';setScreen();sendStudio({type:'book',title:book?.title||null});}catch(e){report(e);}
};
window.addEventListener('message',async event=>{
  if(event.source!==studio.contentWindow)return;
  const message=event.data;if(!message||typeof message.type!=='string')return;
  if(message.type==='studio-draft')window.reader.studioState(message.state).catch(report);
  if(message.type==='studio-ready'){studioReady=true;window.reader.preferences().then(p=>{if(p.studio)sendStudio({type:'restore-draft',state:p.studio});}).catch(report);sendStudio({type:'platform',platform:window.reader.platform});sendStudio({type:'ui-style',style:uiStyle});sendStudio({type:'book',title:book?.title||null});}
  if(message.type==='export-png'){try{const saved=await window.reader.exportCloud(message.data);sendStudio({type:'export-result',text:saved?'PNG 已保存':'已取消导出'});}catch(e){sendStudio({type:'export-result',text:e.message});}}
  if(message.type==='back'){screenMode=studioReturn;setScreen();if(screenMode==='reading'){drawSoon();viewport.focus();}}
  if(message.type==='switch-style')switchStyle().catch(report);
  if(message.type==='window-control'&&['close','minimize','maximize'].includes(message.action))window.reader.windowControl(message.action).catch(report);
  if(message.type==='analyze-book'){
    if(!book){sendStudio({type:'analysis-error',error:'先从书架打开一本书，或使用左侧导入 TXT。'});return;}
    const id=book.id,title=book.title,accountEpoch=cloudAccountEpoch;
    try{const result=await window.reader.analyze(id);if(accountEpoch!==cloudAccountEpoch)return;sendStudio({type:'analysis-result',title,result});}
    catch(e){if(accountEpoch===cloudAccountEpoch)sendStudio({type:'analysis-error',error:e.message});}
  }
});
window.reader.preferences().then(p=>{applyStyle(p.uiStyle||'dark');return showLibrary();}).catch(report);loadThemes().catch(report);
// Selection uses source offsets, so it survives scrolling and canvas redraws.
function comparePoint(a,b){return a.paragraph-b.paragraph||a.offset-b.offset;}
function selectionRange(){if(!textSelection)return null;return comparePoint(textSelection.start,textSelection.end)<=0?[textSelection.start,textSelection.end]:[textSelection.end,textSelection.start];}
function isSelected(paragraph,offset){const range=selectionRange();return range&&comparePoint({paragraph,offset},range[0])>=0&&comparePoint({paragraph,offset},range[1])<0;}
function selectedText(){const range=selectionRange();if(!range||!book)return '';const [a,b]=range;return book.paragraphs.slice(a.paragraph,b.paragraph+1).map((p,i)=>p.text.slice(i===0?a.offset:0,a.paragraph+i===b.paragraph?b.offset:undefined)).join('\n');}
function pointAt(x,y){const r=viewport.getBoundingClientRect(),i=lineAt(Math.max(0,Math.min(layout.total-1,logicalY+y-r.top)));let left=layout.inset+(layout.start[i]===0?book.settings.fontSize*2:0),offset=layout.start[i];for(const ch of book.paragraphs[layout.p[i]].text.slice(layout.start[i],layout.end[i])){const w=widths.get(ch)||0;if(x-r.left<left+w/2)break;left+=w;offset+=ch.length;}return {paragraph:layout.p[i],offset};}
viewport.addEventListener('pointerdown',e=>{if(e.button!==0||!layout||working)return;selecting=true;selectionPointer={x:e.clientX,y:e.clientY};const point=pointAt(e.clientX,e.clientY);textSelection={start:point,end:point};viewport.setPointerCapture(e.pointerId);drawSoon();});
viewport.addEventListener('pointermove',e=>{if(!selecting)return;selectionPointer={x:e.clientX,y:e.clientY};textSelection.end=pointAt(e.clientX,e.clientY);drawSoon();if(!selectionScroll)selectionScroll=requestAnimationFrame(scrollSelection);});
function scrollSelection(){selectionScroll=0;if(!selecting||!selectionPointer)return;const r=viewport.getBoundingClientRect(),y=selectionPointer.y;const delta=y<r.top+28?-layout.lh/3:y>r.bottom-28?layout.lh/3:0;if(delta){position(logicalY+delta);epoch++;snapshots={};textSelection.end=pointAt(selectionPointer.x,y);scheduleSave();selectionScroll=requestAnimationFrame(scrollSelection);}}
function endSelection(){selecting=false;cancelAnimationFrame(selectionScroll);selectionScroll=0;}
viewport.addEventListener('pointerup',endSelection);viewport.addEventListener('pointercancel',endSelection);
viewport.addEventListener('dblclick',e=>{if(!layout)return;const point=pointAt(e.clientX,e.clientY),text=book.paragraphs[point.paragraph].text;const segment=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(text)].find(s=>s.index<=point.offset&&s.index+s.segment.length>point.offset);if(segment){textSelection={start:{paragraph:point.paragraph,offset:segment.index},end:{paragraph:point.paragraph,offset:segment.index+segment.segment.length}};drawSoon();}});
document.addEventListener('copy',e=>{if(screenMode!=='reading'||document.querySelector('dialog[open]')||!selectedText())return;e.preventDefault();e.clipboardData.setData('text/plain',selectedText());});
document.addEventListener('keydown',e=>{if(screenMode!=='reading'||document.querySelector('dialog[open]')||!book)return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'&&selectedText()){e.preventDefault();window.reader.copyText(selectedText()).catch(report);}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();textSelection={start:{paragraph:0,offset:0},end:{paragraph:book.paragraphs.length-1,offset:book.paragraphs.at(-1).text.length}};drawSoon();}});
let importFilesPending=[],cleaningPreviewKey=null,importBusy=false;
function cleaningConfig(){return {enabled:$('clean-enabled').checked,mode:$('clean-mode').value,rules:$('clean-rules').value,presets:[...document.querySelectorAll('#clean-presets input:checked')].map(i=>i.value)};}
async function beginImport(files){
 if(importBusy)return;importFilesPending=files;if(!files.length)return;cleaningPreviewKey=null;
 const [presets,prefs]=await Promise.all([window.reader.cleaningPresets(),window.reader.preferences()]);
 const saved=prefs.cleaning||{};$('clean-enabled').checked=false;$('clean-mode').value=saved.mode||'exact';$('clean-rules').value=saved.rules||'';$('clean-presets').replaceChildren();
 for(const preset of presets){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.value=preset.id;input.checked=(saved.presets||[]).includes(preset.id);span.textContent=preset.name;label.append(input,span);label.title=preset.rules.join('；');$('clean-presets').append(label);}
 $('import-files-label').textContent=`${files.length} 本：${files.map(f=>f.name).join('、')}`;$('clean-preview-output').textContent='默认原样导入。启用清洗后，请先预览将删除的整行内容。';$('import-options').showModal();
}
$('clean-preview').onclick=async()=>{
 const config=cleaningConfig();cleaningPreviewKey=null;$('clean-preview').disabled=true;$('import-confirm').disabled=true;
 try{const results=await window.reader.cleaningPreview(importFilesPending,config);cleaningPreviewKey=JSON.stringify(config);$('clean-preview-output').textContent=results.map(r=>`${r.name}：命中 ${r.removed} 行${r.removed>100?'（显示前 100 行）':''}\n`+r.matches.map(m=>`第 ${m.line} 行 [${m.rule}]\n${m.text}`).join('\n')).join('\n\n');}
 catch(e){$('clean-preview-output').textContent=e.message;}finally{$('clean-preview').disabled=false;$('import-confirm').disabled=false;}
};
$('import-confirm').onclick=async()=>{
 const config=cleaningConfig();if(config.enabled&&cleaningPreviewKey!==JSON.stringify(config)){$('clean-preview-output').textContent='请先预览当前清洗规则，再确认导入。';return;}
 importBusy=true;$('import-confirm').disabled=true;
 try{await window.reader.saveCleaning(config);const result=await window.reader.importFiles(importFilesPending,config);$('import-options').close();await imported(result);}catch(e){$('clean-preview-output').textContent=e.message;}finally{importBusy=false;$('import-confirm').disabled=false;}
};
let reviewBookId=null;
function showReview(item){reviewBookId=item.id;$('review-title').textContent=item.title;$('review-rating').value=String(item.review?.rating||0);$('review-tags').value=(item.review?.tags||[]).join('，');$('review-text').value=item.review?.text||'';$('review-status').textContent='评分、标签和评价仅保存在本机。';$('book-review').showModal();}
$('review-button').onclick=()=>{if(book)showReview(book);};
$('review-save').onclick=async()=>{const id=reviewBookId;$('review-save').disabled=true;try{const result=await window.reader.saveReview(id,{rating:Number($('review-rating').value),tags:$('review-tags').value.split(/[,，\n]+/).map(t=>t.trim()).filter(Boolean),text:$('review-text').value});if(book?.id===id)book.review=result.review;$('book-review').close();if(screenMode==='library')await showLibrary();notice('书评已保存');}catch(e){$('review-status').textContent=e.message;}finally{$('review-save').disabled=false;}};
async function exportBook(id){try{if(await window.reader.exportTxt(id))notice('TXT 已导出（UTF-8，当前阅读版本）');}catch(e){report(e);}}
$('export-button').onclick=()=>{if(book)exportBook(book.id);};
let cloudWorking=false,cloudUser=null,lastAutoSync=0,cloudRun=null;
async function refreshCloud(){const status=await window.reader.cloudStatus();cloudUser=status.user;$('account-button').textContent=status.user?'云同步':'账号';$('cloud-login-form').hidden=!!status.user;$('cloud-signed-in').hidden=!status.user;$('cloud-account-status').textContent=status.error||(status.user?`已登录：${status.user.username}${status.last?' · 上次同步 '+new Date(status.last.at).toLocaleTimeString():''}`:'使用 quiz-app 的用户名和密码登录。');return status;}
$('account-button').onclick=async()=>{await flushReading();await save();await refreshCloud();$('cloud-account').showModal();};
function resetReaderForCloud(){cloudAccountEpoch++;sendStudio({type:'reset-studio'});book=null;layout=null;charPrefix=[];signature='';snapshots={};logicalY=0;textSelection=null;screenMode='library';view.pure=false;setScreen();searchWorker.postMessage({paragraphs:[]});}
async function refreshCloudData(){resetReaderForCloud();const p=await window.reader.preferences();applyStyle(p.uiStyle||'dark');await loadThemes();if(p.studio)sendStudio({type:'restore-draft',state:p.studio});await showLibrary();}
function synchronizeCloud(manual=false,shelfEntry=false){
 if(cloudRun)return shelfEntry?cloudRun.then(()=>synchronizeCloud(manual,true)):cloudRun;
 cloudRun=performCloudSync(manual,shelfEntry).finally(()=>{cloudRun=null;});return cloudRun;
}
async function performCloudSync(manual=false,shelfEntry=false){if(cloudWorking)return;cloudWorking=true;lastAutoSync=Date.now();const hadDialog=$('cloud-account').open;$('sync-now').disabled=true;try{
 await flushReading();await save();$('cloud-account-status').textContent='正在同步…';cloudTransfer=true;let result;try{result=await (cloudJob=window.reader.cloudSync(screenMode==='reading'));}finally{cloudTransfer=false;cloudJob=null;}
 if(result.downloaded&&screenMode==='library'&&!shelfEntry)await refreshCloudData();await refreshCloud();$('cloud-account-status').textContent=`同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项${result.conflicts.length?'，有 '+result.conflicts.length+' 项冲突':''}`;
 const comparisons=result.conflicts.length?await window.reader.cloudConflicts():[];
 $('cloud-conflicts').replaceChildren();for(const key of result.conflicts){const row=document.createElement('div');row.className='cloud-conflict';const label=document.createElement('p');label.textContent=key;row.append(label);const comparison=comparisons.find(c=>c.key===key);if(comparison){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='查看本机与云端版本';pre.textContent='本机：\n'+JSON.stringify(comparison.local,null,2)+'\n云端：\n'+JSON.stringify(comparison.remote,null,2);details.append(summary,pre);row.append(details);}for(const [text,choice]of [['保留本机','local'],['采用云端','remote']]){const button=document.createElement('button');button.textContent=text;button.onclick=async()=>{button.disabled=true;try{await window.reader.cloudResolve(key,choice);await refreshCloudData();await synchronizeCloud(true);}catch(e){$('cloud-account-status').textContent=e.message;}finally{button.disabled=false;}};row.append(button);}$('cloud-conflicts').append(row);}
 if(manual&&!$('cloud-account').open)$('cloud-account').showModal();
 }catch(e){$('cloud-account-status').textContent=e.message;if(manual)report(e);}finally{cloudWorking=false;$('sync-now').disabled=false;}}
$('cloud-login-form').onsubmit=async e=>{e.preventDefault();$('cloud-login-submit').disabled=true;try{await flushReading();await save();await window.reader.cloudLogin({username:$('cloud-username').value,password:$('cloud-password').value,register:$('cloud-register').checked,importLocal:$('cloud-import-local').checked});$('cloud-password').value='';await refreshCloudData();await refreshCloud();await synchronizeCloud(true);}catch(error){$('cloud-account-status').textContent=error.message;}finally{$('cloud-login-submit').disabled=false;}};
$('sync-now').onclick=()=>synchronizeCloud(true);
$('cloud-logout').onclick=async()=>{try{await flushReading();await save();await window.reader.cloudLogout();await refreshCloudData();await refreshCloud();$('cloud-conflicts').replaceChildren();$('cloud-account').showModal();}catch(e){report(e);}};
setInterval(()=>{if(cloudUser&&!document.querySelector('dialog[open]')&&!opening)synchronizeCloud(false);},300000);
window.addEventListener('online',()=>{if(cloudUser)synchronizeCloud(false);});
window.addEventListener('blur',()=>{if(cloudUser&&!opening&&Date.now()-lastAutoSync>30000)synchronizeCloud(false);});
refreshCloud().then(()=>{if(cloudUser)synchronizeCloud(false);}).catch(report);
