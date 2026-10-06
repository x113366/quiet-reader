const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let app,page;const errors=[];
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-features-')),fixture=path.join(data,'山海之间.txt');
 await fs.writeFile(fixture,Array.from({length:15},(_,i)=>`第${i+1}章 山海\n`+'林间的少年看着远处的山海，星辰照亮森林。少年沿着森林寻找星辰。山海之间留下旅人的故事。\n'.repeat(20)).join(''));
 async function launch(){const env={...process.env,QUIET_READER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#shelf-import');}
 async function stable(){await page.waitForFunction(()=>window.readerDiagnostics?.().id&&!window.readerDiagnostics().working&&!window.readerDiagnostics().opening);}
 await launch();assert.equal(await page.locator('#library').isVisible(),true);
 await page.locator('#file-input').setInputFiles(fixture);await page.click('#import-confirm');await stable();
 assert.equal(await page.locator('header').isVisible(),false);assert.equal(await page.locator('#reading-progress-bar').isVisible(),false);
 const before=await page.evaluate(()=>window.readerDiagnostics().anchor);await page.mouse.click(480,390);await stable();assert.equal(await page.locator('header').isVisible(),true);assert.deepEqual(await page.evaluate(()=>window.readerDiagnostics().anchor),before);
 await page.locator('#reading-progress').evaluate(el=>{el.value=5000;el.dispatchEvent(new Event('input'));});await page.waitForTimeout(600);assert.ok((await page.evaluate(()=>window.readerDiagnostics().logicalY))>0);
 await page.click('#settings-button');for(const [id,color] of [['background','#f0e5ce'],['color','#343a30']])await page.locator('#'+id).evaluate((el,color)=>{el.value=color;el.dispatchEvent(new Event('input'));},color);
 await page.fill('#theme-name','纸与森林');await page.click('#save-theme');await page.waitForFunction(()=>document.getElementById('theme-status').textContent.includes('主题已保存'));await page.click('[data-close="settings"]');
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].focus();});await page.waitForTimeout(6200);
 await page.click('#stats-button');await page.waitForSelector('.stat');const time=await page.evaluate(async()=>Object.values((await window.reader.preferences()).days).reduce((sum,day)=>sum+Object.values(day).reduce((a,b)=>a+b,0),0));assert.ok(time>0,'foreground time recorded');
 await page.waitForTimeout(5200);const after=await page.evaluate(async()=>Object.values((await window.reader.preferences()).days).reduce((sum,day)=>sum+Object.values(day).reduce((a,b)=>a+b,0),0));assert.equal(time,after,'stats page does not count');
 await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/statistics.png')});
 await page.click('#stats-back');await page.click('.book');await stable();assert.equal(await page.locator('header').isVisible(),false);await page.keyboard.press('Escape');await stable();
 await page.click('#cloud-button');const studio=page.frameLocator('#studio-frame');await studio.locator('#analyze-book').click();await studio.locator('#analysis-details').waitFor({state:'visible',timeout:120000});assert.ok(await studio.locator('#analysis-report').textContent());await page.waitForTimeout(2500);await page.screenshot({path:path.join(root,'test-results/wordcloud.png')});await studio.locator('#studio-back').click();
 await page.click('#library-button');await page.waitForFunction(()=>window.readerDiagnostics().screenMode==='library');assert.equal(await page.locator('#viewport').isVisible(),false);await page.screenshot({path:path.join(root,'test-results/bookshelf.png')});
 const exit=new Promise(r=>app.process().once('exit',r));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await exit;
 await launch();await page.click('.book');await stable();assert.equal(await page.locator('header').isVisible(),false);assert.equal(await page.evaluate(()=>window.readerDiagnostics().settings.background),'#f0e5ce');await page.keyboard.press('Escape');await page.click('#settings-button');assert.match(await page.locator('#theme-select').textContent(),/纸与森林/);await page.click('[data-close="settings"]');await page.keyboard.press('Escape');await page.screenshot({path:path.join(root,'test-results/pure-reading.png')});
 assert.deepEqual(errors,[]);console.log('PASS pure mode, center toggle without reflow, progress drag, themes restart, reading time isolation, independent shelf, Python wordcloud');await app.close();
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(root,'test-results/features-failure.png')}).catch(()=>{});if(app)await app.close();process.exitCode=1;});
