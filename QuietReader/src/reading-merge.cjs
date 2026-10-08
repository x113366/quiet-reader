// Reading versions are ordered by edit time, never by chapter or percentage.
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));
 return value??null;
}
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const position=v=>v?.progress?.anchor?{paragraph:v.progress.anchor.paragraph,offset:v.progress.anchor.offset}:null;
const time=v=>Number.isFinite(v?.progress?.updatedAt)?v.progress.updatedAt:0;
function mergeReading(base,local={},remote={}){
 // Legacy records without a timestamp prefer the cloud. A new actual read gets a timestamp.
 const source=time(local)>time(remote)?local:time(local)<time(remote)?remote:
   (String(local.progress?.deviceId||'')>String(remote.progress?.deviceId||'')?local:remote);
 const devices={...remote.devices};
 for(const [id,record]of Object.entries(local.devices||{})){
  const old=devices[id];
  if(!old||(record.syncedAt||0)>(old.syncedAt||0))devices[id]=record;
 }
 const result={...local,...remote,progress:source.progress??null,counts:source.counts,devices};
 // Preserve independent local style edits while progress is resolved by time.
 if(base&&equal(remote.settings,base.settings))result.settings=local.settings;
 if(local.window!==undefined)result.window=local.window;
 if(local.view!==undefined)result.view=local.view;
 return result;
}
async function syncReading({key,local,base,device,call,digest}){
 let value=structuredClone(local||{});
 for(let attempt=0;attempt<3;attempt++){
  const remote=await call('reader_get',{p_key:key});
  const merged=remote?mergeReading(base,value,remote.payload):value;
  // Retain each device's last reading snapshot even when another device wins.
  merged.devices={...merged.devices};
  if(local?.progress){
   const previous=merged.devices[device];
   if(!previous||!equal(previous.progress,local.progress)||!equal(previous.counts,local.counts))
    merged.devices[device]=structuredClone({progress:local.progress,counts:local.counts,syncedAt:Date.now()});
  }
  const hash=await digest(merged);
  if(remote?.hash===hash)return {...remote,payload:merged,uploaded:false};
  const result=await call('reader_put',{p_key:key,p_version:remote?.version||0,p_payload:merged,p_hash:hash});
  if(result.ok)return {payload:merged,version:result.version,hash,uploaded:true};
  value=merged;
 }
 throw new Error('阅读进度正在更新，稍后将在后台重试');
}
module.exports={mergeReading,syncReading,position,equal};
