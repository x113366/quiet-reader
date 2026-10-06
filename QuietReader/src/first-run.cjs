const fs=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
async function initializeRuntime(runtime,userData,version){
  if(!runtime.bundled)return;
  const cache=path.join(userData,'runtime',version);
  const marker=path.join(cache,'ready.json');
  runtime.env={...process.env,QUIET_READER_ANALYSIS_CACHE:cache};
  try{const state=JSON.parse(await fs.readFile(marker,'utf8'));if(state.version===version)return;}catch{}
  await fs.mkdir(cache,{recursive:true});
  await execFile(runtime.command,['--initialize'],{env:runtime.env,timeout:120000,maxBuffer:1024*1024});
  await fs.writeFile(marker,JSON.stringify({version,initializedAt:new Date().toISOString()}));
}
module.exports={initializeRuntime};
