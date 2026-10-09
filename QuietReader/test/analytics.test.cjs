const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/reading-analytics.js');
const bookId='a'.repeat(64);
test('midnight split, cumulative checkpoints and session restart do not double-count',()=>{
 const tracker=new A.Tracker(),end=new Date(2026,9,10,0,0,2).getTime();
 const record=tracker.add({bookId,read:50,total:1000,ms:5000,now:end,platform:'desktop'});
 assert.equal(record.days['2026-10-09'],3000);assert.equal(record.days['2026-10-10'],2000);
 const days=A.checkpoint({},null,record);assert.deepEqual(A.checkpoint(days,record,record),days);
 tracker.pause();const next=tracker.add({bookId,read:10,total:1000,ms:1000,now:end+20000});assert.notEqual(record.id,next.id);
 assert.equal(tracker.add({bookId,read:99,total:1000,ms:20000,now:end+40000}),null);
});
test('ETA uses deduplicated active samples, excludes explicit jumps and marks fallback',()=>{
 const tracker=new A.Tracker();let live;for(let i=0;i<13;i++)live=tracker.add({bookId,read:i*30,total:10000,ms:5000,now:100000+i*5000});
 assert.ok(live.paceChars>=250);assert.equal(A.estimate(1000,[live],live).personal,true);
 const pace=live.paceChars;tracker.jump(9000);live=tracker.add({bookId,read:9000,total:10000,ms:5000,now:170000});assert.equal(live.paceChars,pace);
 assert.equal(A.estimate(1000,[]).personal,false);assert.equal(A.estimate(0,[]).text,'已到书末');
 assert.throws(()=>A.validateSession({...live,days:{bad:5000}}),/阅读日期/);
});
