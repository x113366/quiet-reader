const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let app,page;
(async()=>{
const data=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-styles-'));const env={...process.env,QUIET_READER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
async function launch(){app=await _electron.launch({args:[root],env});page=await app.firstWindow();await page.waitForSelector('#shelf-import');}
await launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.click('#ui-style-button');await page.waitForFunction(()=>document.body.dataset.ui==='light');
await page.screenshot({path:path.join(root,'test-results/library-light.png')});await page.click('#cloud-button');const studio=page.frameLocator('#studio-frame');await studio.locator('body[data-ui="light"]').waitFor();assert.equal(await studio.locator('[data-shape]').count(),6);await studio.locator('#download:not([disabled])').waitFor();
await page.screenshot({path:path.join(root,'test-results/studio-light.png')});await studio.locator('[data-preset="night"]').click();await studio.locator('#download:not([disabled])').waitFor();assert.equal(await studio.locator('#bg').inputValue(),'#142d3c');
await studio.locator('#transparent').check();await studio.locator('#generate').click();await studio.locator('#download:not([disabled])').waitFor();
const png=path.join(data,'export.png');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},png);await studio.locator('#download').click();await studio.locator('#status').filter({hasText:'PNG 已保存'}).waitFor();assert.equal((await fs.readFile(png)).subarray(1,4).toString(),'PNG');
await studio.locator('#studio-style').click();await studio.locator('body[data-ui="dark"]').waitFor();await page.screenshot({path:path.join(root,'test-results/studio-dark.png')});await studio.locator('#studio-back').click();assert.equal(await page.locator('body').getAttribute('data-ui'),'dark');await page.click('#ui-style-button');
const exited=new Promise(r=>app.process().once('exit',r));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await exited;await launch();await page.waitForFunction(()=>document.body.dataset.ui==='light');
await page.click('#stats-button');await page.waitForSelector('.stat');await page.screenshot({path:path.join(root,'test-results/statistics-light.png')});
assert.deepEqual(errors,[]);console.log('PASS complete UI switch, persistence, original studio controls, palette, transparent PNG export, return navigation');await app.close();
})().catch(async e=>{console.error(e);await app?.close();process.exitCode=1;});
