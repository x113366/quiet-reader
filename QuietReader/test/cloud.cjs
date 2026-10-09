const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{CloudSync,digest,sumDays}=require('../src/cloud-sync.cjs'),{identity,defaults}=require('../src/core.cjs');
function server(){const objects=new Map(),chunks=new Map();return async(name,p)=>{const scope=p.p_token+'/',key=scope+p.p_key;
 if(name==='reader_list')return [...objects].filter(([k])=>k.startsWith(scope)&&k.slice(scope.length)>p.p_after).map(([k,v])=>({key:k.slice(scope.length),version:v.version,hash:v.hash})).sort((a,b)=>a.key.localeCompare(b.key));
 if(name==='reader_get')return objects.get(key)||null;
 if(name==='reader_chunk_put'){chunks.set(scope+p.p_hash+'/'+p.p_part,p.p_data);return null;}
 if(name==='reader_chunk_get')return chunks.get(scope+p.p_hash+'/'+p.p_part)||null;
 if(name==='reader_put'){const old=objects.get(key);if((old?.version||0)!==p.p_version)return {ok:false};const row={version:p.p_version+1,payload:structuredClone(p.p_payload),hash:p.p_hash};objects.set(key,row);return {ok:true,version:row.version};}
 throw Error(name);
};}
async function profile(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-cloud-'));const store=new Store(dir);await store.init();return store;}
async function seed(store){const bytes=Buffer.from('第一章 星辰\n山海之间。'),id=identity(bytes);await fs.writeFile(store.file(id,'txt'),bytes);await store.write({id,title:'星辰',encoding:'utf-8',size:bytes.length,settings:defaults,window:{width:960,height:780},progress:null,counts:{total:10,read:0},review:{rating:5,tags:['小说'],text:'喜欢',updated:100}});return id;}
test('two devices sync files, review, drafts and additive reading time; no duplicate uploads',async()=>{
 const request=server(),a=await profile(),b=await profile(),id=await seed(a);await a.updatePreferences(p=>{p.dayCounters={deviceA:{'2026-10-06':{[id]:1000}}};p.days=sumDays(p.dayCounters);p.studio={fields:{source:'星辰, 10'}};p.themes=[{name:'纸',settings:defaults}];});
 const A=new CloudSync(a,{token:'owner'},'deviceA',request),B=new CloudSync(b,{token:'owner'},'deviceB',request);await A.run();await B.run();assert.equal((await b.read(id)).review.text,'喜欢');assert.deepEqual(await fs.readFile(b.file(id,'txt')),await fs.readFile(a.file(id,'txt')));assert.equal((await b.preferences()).studio.fields.source,'星辰, 10');
 await b.updatePreferences(p=>{p.dayCounters.deviceB={'2026-10-06':{[id]:2000}};p.days=sumDays(p.dayCounters);});await B.run();await A.run();assert.equal((await a.preferences()).days['2026-10-06'][id],3000);assert.equal((await A.run()).uploaded,0);
 const other=await profile();await new CloudSync(other,{token:'other'},'deviceC',request).run();assert.equal((await other.list()).length,0);
});
test('concurrent edits become explicit conflicts and resolution is backed up',async()=>{
 const request=server(),a=await profile(),b=await profile(),id=await seed(a),A=new CloudSync(a,{token:'owner'},'a',request),B=new CloudSync(b,{token:'owner'},'b',request);await A.run();await B.run();
 await a.updateBook(id,x=>x.review.text='甲');await b.updateBook(id,x=>x.review.text='乙');await A.run();const result=await B.run();const key=`book/${id}/review`;assert.ok(result.conflicts.includes(key));assert.equal((await b.read(id)).review.text,'乙');await B.resolve(key,'remote');assert.equal((await b.read(id)).review.text,'甲');assert.ok((await fs.readdir(path.join(b.root,'conflicts'))).length);assert.equal((await B.run()).conflicts.length,0);
});
test('failed upload retries safely and path traversal is rejected',async()=>{
 const remote=server(),a=await profile();await seed(a);let fail=true;const A=new CloudSync(a,{token:'owner'},'a',async(n,p)=>{if(fail&&n==='reader_put')throw Error('offline');return remote(n,p);});await assert.rejects(A.run(),/offline/);fail=false;assert.ok((await A.run()).uploaded>0);await assert.rejects(A.apply('asset/../../bad',{size:0,parts:0,hash:'0'.repeat(64)}),/路径/);
});
test('monthly reading sessions sync both ways while legacy totals remain additive',async()=>{
 const A=require('../src/reading-analytics.js'),request=server(),a=await profile(),b=await profile(),id=await seed(a),device='deviceA',now=Date.now();
 const record=new A.Tracker().add({bookId:id,read:10,total:100,ms:5000,now,platform:'desktop'});record.deviceId=device;
 const bucket=A.sessionBucket(device,record);await a.updatePreferences(p=>{p.dayCounters={[bucket]:{...A.checkpoint({},null,record),_sessions:{[record.id]:record}}};p.days=sumDays(p.dayCounters);});
 const syncA=new CloudSync(a,{token:'owner'},device,request),syncB=new CloudSync(b,{token:'owner'},'deviceB',request);
 await syncA.run();await syncB.run();assert.equal(A.sessions((await b.preferences()).dayCounters).length,1);
 assert.equal(Object.values((await b.preferences()).days).reduce((n,day)=>n+Object.values(day).reduce((a,b)=>a+b,0),0),5000);
 await syncB.run();await syncA.run();assert.equal(A.sessions((await a.preferences()).dayCounters)[0].durationMs,5000);
});
