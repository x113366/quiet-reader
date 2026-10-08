// Reading position is independent of layout caches and device window dimensions.
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));
 return value??null;
}
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const position=v=>v?.progress?.anchor?{paragraph:v.progress.anchor.paragraph,offset:v.progress.anchor.offset}:null;
function mergeReading(base,local,remote){
 if(!base)return null;
 const result={...remote};
 const lp=!equal(position(local),position(base)),rp=!equal(position(remote),position(base));
 if(lp&&rp&&!equal(position(local),position(remote)))return null;
 const source=lp?local:rp?remote:local;
 result.progress=source.progress;result.counts=source.counts;
 for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
  if(['progress','counts'].includes(key))continue;
  // Window/view belong to the device and must not block progress synchronization.
  if(['window','view'].includes(key)){if(local[key]!==undefined)result[key]=local[key];continue;}
  const l=!equal(local[key],base[key]),r=!equal(remote[key],base[key]);
  if(l&&r&&!equal(local[key],remote[key]))return null;
  if(l)result[key]=local[key];
 }
 return result;
}
module.exports={mergeReading,position,equal};
