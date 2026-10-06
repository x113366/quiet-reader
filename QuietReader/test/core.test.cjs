const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const iconv=require('iconv-lite');
const {decode,paragraphs,identity,settings}=require('../src/core.cjs');
const {Store}=require('../src/store.cjs');
const {search}=require('../src/search-engine.js');
test('exact and fuzzy search preserve original offsets including supplementary Unicode',()=>{
  const p=[{text:'𠀀  夜色，渐深。雨落长街。'}];
  assert.deepEqual(search(p,'夜色，渐深')[0],{paragraph:0,start:4,end:9,excerpt:p[0].text});
  assert.ok(search(p,'夜色暂深','fuzzy').length);
  assert.ok(search(p,'夜色渐渐深','fuzzy').length);
  assert.ok(search(p,'夜渐深','fuzzy').length);
  assert.ok(search(p,'夜 色 渐 深','fuzzy').length);
  assert.equal(search(p,'星河漫天','fuzzy').length,0);
  assert.equal(search(p,'夜色渐深','exact').length,0);
});
test('UTF-8, BOM, GB18030 and explicit override round trip',()=>{
  const text='夜色渐深，风吹过树林。𠀀';
  for(const encoding of ['utf-8','gb18030'])assert.equal(decode(iconv.encode(text,encoding)).text,text);
  assert.equal(decode(Buffer.from('\uFEFF'+text)).text,text);
  assert.equal(decode(iconv.encode(text,'gb18030'),'gb18030').text,text);
  assert.notEqual(decode(iconv.encode(text,'gb18030'),'utf-8').text,text);
});
test('newlines, whitespace, blank lines and very long paragraphs',()=>{
  assert.deepEqual(paragraphs('　 甲\r\n\r\n\r\n乙\r丙\n'),[{text:'甲',gap:2},{text:'乙',gap:1},{text:'丙',gap:1}]);
  assert.equal(paragraphs('长'.repeat(100000))[0].text.length,100000);
});
test('stable content identity and bounded settings',()=>{
  assert.equal(identity(Buffer.from('同一本书')),identity(Buffer.from('同一本书')));
  assert.notEqual(identity(Buffer.from('第一本')),identity(Buffer.from('第二本')));
  assert.equal(settings({fontSize:100}).fontSize,40);
});
test('serialized atomic persistence survives reopen and corrupt primary fallback',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-reader-unit-'));const store=new Store(dir);await store.init();
  const id=identity(Buffer.from('book'));
  await Promise.all(Array.from({length:12},(_,i)=>store.write({id,progress:{paragraph:i,offset:7,dy:-13.25}})));
  assert.equal((await new Store(dir).read(id)).progress.paragraph,11);
  await fs.writeFile(store.file(id,'json'),'broken');
  assert.equal((await store.read(id)).progress.paragraph,10);
  await fs.rm(dir,{recursive:true,force:true});
});
test('theme colors validate and preferences merge concurrent updates',async()=>{
  assert.equal(settings({background:'#f0e5ce'}).background,'#f0e5ce');
  assert.equal(settings({background:'invalid'}).background,'#212121');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-preferences-'));const store=new Store(dir);await store.init();
  await Promise.all([store.updatePreferences(p=>{p.themes=[{name:'纸',settings:settings({background:'#f0e5ce'})}];}),...Array.from({length:10},()=>store.updatePreferences(p=>{p.days.test={book:(p.days.test?.book||0)+1000};}))]);
  const saved=await new Store(dir).preferences();assert.equal(saved.days.test.book,10000);assert.equal(saved.themes[0].settings.background,'#f0e5ce');await fs.rm(dir,{recursive:true,force:true});
});
test('opt-in ad cleaning preserves originals and previews exact/fuzzy whole-line matches',()=>{
 const {clean,options}=require('../src/cleaning.cjs');
 const text='第一章 夜雨\n更多免费小说请访问 example.com\n她沿着小路往前走。\n更多 免废 小说，请访问 example.com\n';
 assert.equal(clean(text,{}).text,text);
 const exact=clean(text,{enabled:true,mode:'exact',presets:['download']});assert.equal(exact.removed,1);assert.match(exact.text,/她沿着/);assert.equal(exact.matches[0].line,2);
 const fuzzy=clean(text,{enabled:true,mode:'fuzzy',presets:['download']});assert.equal(fuzzy.removed,2);assert.doesNotMatch(fuzzy.text,/example/);
 assert.throws(()=>options({enabled:true,rules:'广告'}),/至少/);assert.throws(()=>clean(text,{enabled:true}),/勾选/);
 assert.equal(clean('请收藏本站'+'正文'.repeat(1100),{enabled:true,presets:['promotion']}).removed,0);
});
test('book counts use Unicode characters without whitespace and review validation',()=>{
 const {readingCounts,review}=require('../src/book-info.cjs');const p=[{text:'甲 乙𠀀'},{text:'丙丁'}];assert.deepEqual(readingCounts(p,{paragraph:1,offset:1}),{total:5,read:4});assert.deepEqual(readingCounts(p,null,true),{total:5,read:5});assert.equal(review({rating:5,tags:[' 科幻 ','科幻'],text:'很好'}).tags.length,1);assert.throws(()=>review({rating:6,tags:[],text:''}));
});
