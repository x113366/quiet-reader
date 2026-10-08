const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const config=require('./cloud-config.json');
const {mergeReading,syncReading,position,equal}=require('./reading-merge.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));return value;}
const digest=value=>hash(JSON.stringify(stable(value)));
async function json(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.cloud-tmp',data,{mode:0o600});await fs.rename(file+'.cloud-tmp',file);}
let transport=(...args)=>fetch(...args);
function setTransport(fn){transport=fn;}
async function rpc(name,args){
 let response;try{response=await transport(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});}catch{throw new Error('无法连接云端：请检查网络或 Supabase 项目是否已恢复；本地数据已保留。');}
 const body=await response.text();if(response.ok&&!body)return null;let result;try{result=JSON.parse(body);}catch{throw new Error('云端暂时不可用，请稍后重试。');}
 if(!response.ok)throw new Error(result.code==='PGRST202'?'云端同步服务尚未部署。':result.message||'云端请求失败');return result;
}
function sumDays(counters){const days={};for(const device of Object.values(counters||{}))for(const [day,books]of Object.entries(device))for(const [id,ms]of Object.entries(books)){if(!Number.isFinite(ms)||ms<0)continue;days[day]||={};days[day][id]=(days[day][id]||0)+ms;}return days;}
function assetPath(key){
 const relative=key.slice(6);
 if(relative!=='studio/latest.png'&&!/^books\/[a-f0-9]{64}\.(?:txt|original\.txt)$/.test(relative)&&!/^analysis\/[a-f0-9]{64}\/(?:source\.txt|analysis\.json|analysis_report\.txt|keywords_for_wordcloud\.txt)$/.test(relative))throw new Error('无效云端文件路径');return relative;
}
class CloudSync{
 constructor(store,session,deviceId,request=rpc){this.store=store;this.session=session;this.deviceId=deviceId;this.request=request;this.last=null;}
 call(name,args={}){return this.request(name,{p_token:this.session.token,...args});}
 async entries(){
  const entries=new Map(),books=await this.store.list();
  for(const b of books){const base={id:b.id,title:b.title,encoding:b.encoding,size:b.size,cleaning:b.cleaning};entries.set(`book/${b.id}/base`,base);entries.set(`book/${b.id}/reading`,{settings:b.settings,progress:b.progress,window:b.window,view:b.view,counts:b.counts,devices:b.devices});if(b.review)entries.set(`book/${b.id}/review`,b.review);
   for(const relative of [`books/${b.id}.txt`,`books/${b.id}.original.txt`,...['source.txt','analysis.json','analysis_report.txt','keywords_for_wordcloud.txt'].map(f=>`analysis/${b.id}/${f}`)]){
    let data;try{data=await fs.readFile(path.join(this.store.root,relative));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    entries.set('asset/'+relative,{hash:hash(data),size:data.length,parts:Math.ceil(data.length/393216),_bytes:data});
   }
  }
  try{const data=await fs.readFile(path.join(this.store.root,'studio/latest.png'));entries.set('asset/studio/latest.png',{hash:hash(data),size:data.length,parts:Math.ceil(data.length/393216),_bytes:data});}catch(e){if(e.code!=='ENOENT')throw e;}
  const p=await this.store.preferences();
  if(!p.dayCounters){p.dayCounters={[this.deviceId]:p.days||{}};await atomic(path.join(this.store.root,'preferences.json'),JSON.stringify(p));}
  for(const [id,days]of Object.entries(p.dayCounters))entries.set('time/'+id,days);
  for(const theme of p.themes||[])entries.set('theme/'+hash(theme.name),theme);
  for(const key of ['uiStyle','cleaning','studio'])if(p[key]!==undefined)entries.set('prefs/'+key,p[key]);
  return entries;
 }
 payload(value){if(value?._bytes){const { _bytes,...payload}=value;return payload;}return value;}
 async upload(key,value,version){
  if(value?._bytes){for(let i=0;i<value.parts;i++)await this.call('reader_chunk_put',{p_hash:value.hash,p_part:i,p_data:value._bytes.subarray(i*393216,(i+1)*393216).toString('base64')});}
  const payload=this.payload(value);return this.call('reader_put',{p_key:key,p_version:version,p_payload:payload,p_hash:digest(payload)});
 }
 async apply(key,payload){
  if(key.startsWith('asset/')){
   const relative=assetPath(key);if(!payload||!Number.isInteger(payload.size)||payload.size<0||payload.size>64*1024*1024||!Number.isInteger(payload.parts)||payload.parts!==Math.ceil(payload.size/393216)||!/^[a-f0-9]{64}$/.test(payload.hash))throw new Error('无效云端文件清单');
   const chunks=[];for(let i=0;i<payload.parts;i++){const part=await this.call('reader_chunk_get',{p_hash:payload.hash,p_part:i});if(typeof part!=='string')throw new Error('云端文件分片不完整');chunks.push(Buffer.from(part,'base64'));}
   const data=Buffer.concat(chunks);if(data.length!==payload.size||hash(data)!==payload.hash)throw new Error('云端文件校验失败');await atomic(path.join(this.store.root,relative),data);return;
  }
  const match=key.match(/^book\/([a-f0-9]{64})\/(base|reading|review)$/);
  if(match){const [,id,part]=match;let book=await this.store.read(id);if(!book)book={id,settings:require('./core.cjs').defaults,window:{width:960,height:780},progress:null};
   if(part==='base'){if(payload.id!==id||typeof payload.title!=='string'||!['utf-8','gb18030'].includes(payload.encoding))throw new Error('无效书籍信息');for(const k of ['title','encoding','size','cleaning'])if(payload[k]!==undefined)book[k]=payload[k];}
   else if(part==='review')book.review={...require('./book-info.cjs').review(payload),updated:payload.updated};
   else {for(const k of ['settings','progress','window','view','counts','devices'])if(payload[k]!==undefined)book[k]=payload[k];book.settings=require('./core.cjs').settings(book.settings);}
   book.updated=Date.now();await this.store.writeNow(book);return;
  }
  const p=await this.store.preferences();
  if(/^time\/[a-zA-Z0-9_-]{1,80}$/.test(key)){p.dayCounters||={};p.dayCounters[key.slice(5)]=payload;p.days=sumDays(p.dayCounters);}
  else if(/^theme\/[a-f0-9]{64}$/.test(key)){if(typeof payload.name!=='string'||payload.name.length>40)throw new Error('无效主题');p.themes=(p.themes||[]).filter(t=>t.name!==payload.name);p.themes.push({name:payload.name,settings:require('./core.cjs').settings(payload.settings)});}
  else if(/^prefs\/(uiStyle|cleaning|studio)$/.test(key))p[key.slice(6)]=payload;
  else throw new Error('不支持的云端数据类型');
  await atomic(path.join(this.store.root,'preferences.json'),JSON.stringify(p));
 }
 async run(activeReadingKey=null){
  const stateFile=path.join(this.store.root,'.cloud-state.json'),conflictFile=path.join(this.store.root,'.cloud-conflicts.json');
  const state=await json(stateFile,{}),conflicts={};const local=await this.entries(),remote=new Map();let after='';
  while(true){const rows=await this.call('reader_list',{p_after:after});for(const r of rows)remote.set(r.key,r);if(rows.length<500)break;after=rows.at(-1).key;}
  let uploaded=0,downloaded=0;
  for(const key of [...new Set([...local.keys(),...remote.keys()])].sort()){
   const value=local.get(key),remoteRow=remote.get(key),base=state[key];const localHash=value===undefined?null:digest(this.payload(value));
   if(remoteRow&&localHash===remoteRow.hash&&(!value?.progress||equal(value.devices?.[this.deviceId]?.progress,value.progress))){state[key]={version:remoteRow.version,hash:localHash,payload:this.payload(value)};continue;}
   if(key.endsWith('/reading')&&(value||remoteRow)){
    const result=await syncReading({key,local:value,base:base?.payload,device:this.deviceId,call:(n,a)=>this.call(n,a),digest});
    const applied=key===activeReadingKey&&value?{...result.payload,progress:value.progress,counts:value.counts,settings:value.settings}:result.payload;
    await this.apply(key,applied);state[key]={version:result.version,hash:result.hash,payload:result.payload};
    if(result.uploaded)uploaded++;if(!equal(applied,value))downloaded++;
    await atomic(stateFile,JSON.stringify(state));continue;
   }
   if(remoteRow&&localHash===remoteRow.hash){state[key]={version:remoteRow.version,hash:localHash,payload:this.payload(value)};continue;}
   const localChanged=value!==undefined&&(!base||base.hash!==localHash),remoteChanged=!!remoteRow&&(!base||base.version!==remoteRow.version);
   if(localChanged&&remoteChanged){const other=await this.call('reader_get',{p_key:key});
    const merged=key.endsWith('/reading')&&other?mergeReading(base?.payload,this.payload(value),other.payload):null;
    if(merged&&key===activeReadingKey&&(!equal(position(merged),position(value))||!equal(merged.settings,value.settings)))continue;
    if(merged){const result=await this.upload(key,merged,other.version);if(result.ok){await this.apply(key,merged);state[key]={version:result.version,hash:digest(merged),payload:merged};uploaded++;await atomic(stateFile,JSON.stringify(state));continue;}}
    conflicts[key]={remote:other,localHash};continue;}
   if(localChanged||(!remoteRow&&value!==undefined)){
    const result=await this.upload(key,value,remoteRow?.version||0);
    if(!result.ok){conflicts[key]={remote:await this.call('reader_get',{p_key:key}),localHash};continue;}
    state[key]={version:result.version,hash:localHash,payload:this.payload(value)};uploaded++;
   }else if(remoteRow&&(remoteChanged||value===undefined)){
    if(key===activeReadingKey)continue;
    const other=await this.call('reader_get',{p_key:key});if(!other)throw new Error('云端数据已变化，请重试');await this.apply(key,other.payload);state[key]={version:other.version,hash:other.hash,payload:other.payload};downloaded++;
   }
   // Checkpoint every resource: failed requests never mark later work as synced.
   await atomic(stateFile,JSON.stringify(state));
  }
  await atomic(stateFile,JSON.stringify(state));await atomic(conflictFile,JSON.stringify(conflicts));
  this.last={uploaded,downloaded,conflicts:Object.keys(conflicts),at:Date.now()};return this.last;
 }
 async conflicts(){const conflicts=await json(path.join(this.store.root,'.cloud-conflicts.json'),{}),local=await this.entries();return Object.entries(conflicts).map(([key,value])=>({key,local:this.payload(local.get(key)),remote:value.remote.payload}));}
 async resolve(key,choice){
  const conflicts=await json(path.join(this.store.root,'.cloud-conflicts.json'),{}),entry=conflicts[key];if(!entry||!['local','remote'].includes(choice))throw new Error('冲突已变化，请重新同步');
  const state=await json(path.join(this.store.root,'.cloud-state.json'),{}),local=(await this.entries()).get(key),remote=await this.call('reader_get',{p_key:key});
  if(!remote||remote.version!==entry.remote.version||digest(this.payload(local))!==entry.localHash)throw new Error('数据已变化，请重新同步后选择');
  if(local?._bytes)await atomic(path.join(this.store.root,'conflicts',`${Date.now()}-${hash(key)}.bin`),local._bytes);
  await atomic(path.join(this.store.root,'conflicts',`${Date.now()}-${hash(key)}.json`),JSON.stringify({key,local:this.payload(local),remote,choice}));
  if(choice==='remote'){await this.apply(key,remote.payload);state[key]={version:remote.version,hash:remote.hash,payload:remote.payload};}
  else{const result=await this.upload(key,local,remote.version);if(!result.ok)throw new Error('云端已变化，请重试');state[key]={version:result.version,hash:digest(this.payload(local)),payload:this.payload(local)};}
  delete conflicts[key];await atomic(path.join(this.store.root,'.cloud-state.json'),JSON.stringify(state));await atomic(path.join(this.store.root,'.cloud-conflicts.json'),JSON.stringify(conflicts));
 }
}
module.exports={CloudSync,rpc,setTransport,json,atomic,sumDays,digest};
