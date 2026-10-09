(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReadingAnalytics=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const duration=ms=>ms<60000?'不足 1 分钟':ms<3600000?`${Math.floor(ms/60000)} 分钟`:`${Math.floor(ms/3600000)} 小时 ${Math.floor(ms/60000)%60} 分`;
 const sum=v=>Object.values(v||{}).reduce((a,b)=>a+(Number.isFinite(b)&&b>0?b:0),0);
 function splitDays(end,ms){const result={};let start=end-ms;while(start<end){const d=new Date(start),next=new Date(d);next.setHours(24,0,0,0);const stop=Math.min(end,next.getTime());result[dayKey(d)]=(result[dayKey(d)]||0)+stop-start;start=stop;}return result;}
 class Tracker{
  constructor(){this.current=null;this.lastRead=0;this.sinceMove=0;}
  add({bookId,read,total,ms,now=Date.now(),platform}){
   if(!Number.isFinite(ms)||ms<=0||ms>10000)return null;
   if(!this.current||this.current.bookId!==bookId||now-this.current.lastAt>10000){this.current={id:crypto.randomUUID(),bookId,platform,startedAt:now-ms,lastAt:now,durationMs:0,days:{},startRead:read,endRead:read,total,paceChars:0,paceMs:0};this.lastRead=read;this.sinceMove=0;}
   const s=this.current;s.durationMs+=ms;s.lastAt=now;s.endRead=read;s.total=total;
   for(const [day,value]of Object.entries(splitDays(now,ms)))s.days[day]=(s.days[day]||0)+value;
   this.sinceMove+=ms;
   const chars=read-this.lastRead;
   if(chars!==0){const rate=chars*60000/this.sinceMove;if(chars>0&&chars<=2000&&this.sinceMove>=1500&&rate>=60&&rate<=2000){s.paceChars+=chars;s.paceMs+=this.sinceMove;}this.lastRead=read;this.sinceMove=0;}
   return structuredClone(s);
  }
  jump(read){this.lastRead=read;this.sinceMove=0;}
  pause(){this.current=null;this.sinceMove=0;}
 }
 function validateSession(record){
  if(!record||!/^[-a-f0-9]{36}$/.test(record.id)||!/^([a-f0-9]{64})$/.test(record.bookId)||!Number.isFinite(record.durationMs)||record.durationMs<0||record.durationMs>86400000||!Number.isFinite(record.startedAt)||!Number.isFinite(record.lastAt)||record.lastAt<record.startedAt||!Number.isFinite(record.total)||record.total<0||!Number.isFinite(record.startRead)||!Number.isFinite(record.endRead))throw Error('无效阅读历程');
  if(Object.keys(record.days||{}).length>3||Object.entries(record.days||{}).some(([k,v])=>!/^\d{4}-\d{2}-\d{2}$/.test(k)||!Number.isFinite(v)||v<0)||Math.abs(sum(record.days)-record.durationMs)>2)throw Error('无效阅读日期');
  return record;
 }
 function checkpoint(days,previous,record){
  validateSession(record);const next=structuredClone(days||{});
  if(previous&&record.durationMs<previous.durationMs)return next;
  for(const [day,value]of Object.entries(record.days)){const delta=value-(previous?.days?.[day]||0);if(delta<=0)continue;next[day]||={};next[day][record.bookId]=(next[day][record.bookId]||0)+delta;}
  return next;
 }
 function estimate(remaining,sessions,live){
  const unique=new Map((sessions||[]).map(s=>[s.id,s]));if(live)unique.set(live.id,live);
  const samples=[...unique.values()].sort((a,b)=>b.lastAt-a.lastAt).slice(0,30);
  let chars=0,ms=0;for(const s of samples){if(Number.isFinite(s.paceChars)&&s.paceChars>0&&Number.isFinite(s.paceMs)&&s.paceMs>0){chars+=s.paceChars;ms+=s.paceMs;}}
  const personal=ms>=60000&&chars>=250,rate=personal?Math.max(60,Math.min(2000,chars*60000/ms)):350;
  const minutes=Math.ceil(Math.max(0,remaining)/rate);
  return {personal,rate,minutes,text:remaining<=0?'已到书末':minutes<1?'约 1 分钟读完':minutes<60?`约 ${minutes} 分钟读完`:`约 ${Math.floor(minutes/60)} 小时${minutes%60?` ${minutes%60} 分`:''}读完`,description:personal?'根据有效阅读时段中的正常滚动估算，跳转不计入速度。':'暂按 350 字/分钟估算；积累有效阅读后改用个人速度。'};
 }
 const sessionBucket=(device,record)=>device+'_'+new Date(record.startedAt).toISOString().slice(0,7).replace('-','');
 function sessions(counters){const records=new Map();for(const bucket of Object.values(counters||{}))for(const record of Object.values(bucket._sessions||{})){try{validateSession(record);const previous=records.get(record.id);if(!previous||previous.durationMs<record.durationMs)records.set(record.id,record);}catch{}}return [...records.values()];}
 return {dayKey,duration,sum,splitDays,Tracker,validateSession,checkpoint,estimate,sessionBucket,sessions};
});
