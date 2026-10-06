const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const iconv=require('iconv-lite');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
let app,page;
const results=[];
const record=(name,details)=>{results.push({name,details});console.log('PASS',name,JSON.stringify(details));};
async function stable(){await page.waitForFunction(()=>window.readerDiagnostics?.().id&&!window.readerDiagnostics().working&&!window.readerDiagnostics().opening);await page.waitForTimeout(300);if(await page.evaluate(()=>window.readerDiagnostics().view.pure)) {await page.keyboard.press('Escape');await page.waitForTimeout(150);}}
const state=()=>page.evaluate(()=>window.readerDiagnostics());
async function launch(data){const env={...process.env,QUIET_READER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>console.error('PAGE ERROR',e));await page.waitForSelector('#import-button');}
async function chooser(file){const expected=require('../src/core.cjs').identity(await fs.readFile(file));const event=page.waitForEvent('filechooser');await page.click('#import-button');await(await event).setFiles(file);await page.click('#import-confirm');await page.waitForFunction(id=>window.readerDiagnostics().id===id,expected);await stable();}
async function book(id){await page.click('#library-button');await page.click(`[data-id="${id}"]`);await page.waitForFunction(id=>window.readerDiagnostics().id===id,id);await stable();}
async function scroll(y){await page.evaluate(y=>{document.getElementById('viewport').scrollTop=y;},y);await page.waitForTimeout(650);return state();}
async function size(width,height){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});await page.waitForTimeout(400);await stable();}
async function setting(id,value){await page.click('#settings-button');await page.locator('#'+id).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.waitForTimeout(200);await page.click('[data-close="settings"]');await stable();}
function exact(a,b){assert.equal(a.paragraph,b.paragraph);assert.equal(a.offset,b.offset);assert.ok(Math.abs(a.dy-b.dy)<=1,`dy ${a.dy} vs ${b.dy}`);}
async function close(){const exited=new Promise(resolve=>app.process().once('exit',resolve));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());if(app.process().exitCode===null)await exited;}
(async()=>{
  await fs.mkdir(out,{recursive:true});const data=await fs.mkdtemp(path.join(out,'profile-'));
  const fixture=path.join(out,'fixtures');await fs.mkdir(fixture,{recursive:true});
  const text=Array.from({length:2400},(_,i)=>`第${i+1}段　夜色渐深，远处的灯光落在山间。她翻开旧日的书页，听见窗外的雨声。${'沿着小路慢慢前行，风带来了树林的气息。'.repeat(5)}\r\n${i%4===0?'\r\n\r\n':''}`).join('');
  const first=path.join(fixture,'山间来信.txt'),second=path.join(fixture,'雨夜长街.txt');
  await fs.writeFile(first,'\uFEFF'+text);await fs.writeFile(second,iconv.encode(text.replaceAll('夜色渐深','雨落长街'),'gb18030'));
  await launch(data);await page.screenshot({path:path.join(out,'welcome.png')});
  await chooser(first);let a=await state();assert.match(a.visible,/夜色渐深/);const idA=a.id;record('UTF-8 BOM + file chooser',{id:idA});
  // Real disk-backed File objects from the chooser are passed through the DOM drop path.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='drop-fixture';document.body.append(input);});
  await page.locator('#drop-fixture').setInputFiles(second);
  await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(document.getElementById('drop-fixture').files[0]);window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));document.getElementById('drop-fixture').remove();});
  await page.click('#import-confirm');await page.waitForFunction(id=>window.readerDiagnostics().id!==id,idA);await stable();const idB=(await state()).id;assert.match((await state()).visible,/雨落长街/);record('GB18030 + DOM file drop',{id:idB});
  await page.click('#settings-button');await page.selectOption('#encoding','utf-8');await page.waitForFunction(()=>window.readerDiagnostics().encoding==='utf-8');await stable();assert.ok(!(await state()).visible.includes('雨落长街'));
  await page.click('#settings-button');await page.selectOption('#encoding','gb18030');await page.waitForFunction(()=>window.readerDiagnostics().encoding==='gb18030');await stable();assert.match((await state()).visible,/雨落长街/);record('manual encoding recovery',{});
  await book(idA);await size(960,780);await setting('padding',72);a=await scroll(17063);const anchorA=a.anchor;const geometryA=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize());
  await book(idB);await size(740,610);await setting('padding',36);const b=await scroll(22649);const anchorB=b.anchor;const geometryB=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize());
  await book(idA);a=await state();exact(anchorA,a.anchor);assert.equal(a.settings.padding,72);assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize()),geometryA);
  await book(idB);exact(anchorB,(await state()).anchor);assert.equal((await state()).settings.padding,36);assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize()),geometryB);record('independent book geometry + anchors',{anchorA,anchorB,geometryA,geometryB});
  await book(idA);const original=(await state()).anchor;
  for(const [id,value] of [['fontSize',29],['padding',120]]){await setting(id,value);const changed=(await state()).anchor;assert.equal(changed.paragraph,original.paragraph);assert.ok(Math.abs(changed.offset-original.offset)<60);}
  await size(840,720);const reflowed=(await state()).anchor;assert.equal(reflowed.paragraph,original.paragraph);
  await setting('fontSize',22);await setting('padding',72);await size(960,780);exact(original,(await state()).anchor);record('reflow and return to original exact layout',{original,reflowed,restored:(await state()).anchor});
  const before=(await state()).anchor;await close();await launch(data);await page.waitForSelector(`[data-id="${idA}"]`);assert.equal(await page.locator('.book').count(),2);await page.click(`[data-id="${idA}"]`);await stable();exact(before,(await state()).anchor);record('restart library + sub-line pixel restoration',{before,after:(await state()).anchor});
  const y=(await state()).logicalY;await scroll(y+7);assert.ok(Math.abs((await state()).logicalY-y-7)<1);record('arbitrary 7px scroll without snapping',{actualDelta:(await state()).logicalY-y});
  await page.screenshot({path:path.join(out,'reading.png')});
  await page.click('#search-button');await page.fill('#query','第701段');await page.click('#search-submit');await page.waitForSelector('.match');assert.equal(await page.locator('.match').count(),1);await page.click('.match');await page.waitForTimeout(250);assert.equal((await state()).highlight.paragraph,700);assert.match((await state()).visible,/第701段/);
  await page.click('#search-button');await page.fill('#query','夜色暂深');await page.selectOption('#search-mode','fuzzy');await page.click('#search-submit');await page.waitForFunction(()=>document.querySelectorAll('.match').length===200);await page.click('.match >> nth=0');await page.waitForTimeout(250);assert.ok((await state()).highlight);record('exact and one-character fuzzy search with highlighted jump',{});
  const long=path.join(fixture,'百万字长篇.txt');const longText=text.repeat(10)+'\n'+ '超长段落也应保持顺畅。'.repeat(9000);await fs.writeFile(long,longText);
  const start=performance.now();await chooser(long);const openMs=Math.round(performance.now()-start);const longState=await state();
  const performanceResult=await page.evaluate(async()=>{const gaps=[];let last=performance.now();for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();gaps.push(now-last);last=now;document.getElementById('viewport').scrollTop+=31;}gaps.sort((a,b)=>a-b);return {p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1)};});
  await page.waitForTimeout(650);const longAnchor=(await state()).anchor;await book(idA);const resumeStart=performance.now();await book(longState.id);exact(longAnchor,(await state()).anchor);
  record('long novel layout, scroll and resume',{bytes:Buffer.byteLength(longText),characters:longText.length,lines:longState.lines,openMs,resumeMs:Math.round(performance.now()-resumeStart),frame:performanceResult});
  await close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({platform:process.platform,date:new Date().toISOString(),results},null,2));
})().catch(async error=>{console.error(error);await fs.writeFile(path.join(out,'failure.txt'),String(error.stack));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});if(app)await app.close().catch(()=>{});process.exitCode=1;});
