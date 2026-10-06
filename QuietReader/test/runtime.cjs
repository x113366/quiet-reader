// Release smoke: relocation, first-run cache, reuse, and analysis with no system Python.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {initializeRuntime}=require('../src/first-run.cjs');
const {pythonRuntime}=require('../src/python-runtime.cjs');
const exec=require('node:util').promisify(require('node:child_process').execFile);
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'quiet-release-'));
  try{
    await fs.cp(path.join(__dirname,'../runtime'),path.join(root,'runtime'),{recursive:true});
    const runtime=pythonRuntime({projectDir:'',packaged:true,resourcesPath:root,env:{}});
    const originalPath=process.env.PATH;process.env.PATH='';
    try{await initializeRuntime(runtime,path.join(root,'data'),'1.0.1');}finally{process.env.PATH=originalPath;}
    const marker=path.join(root,'data/runtime/1.0.1/ready.json');
    const before=(await fs.stat(marker)).mtimeMs;
    await initializeRuntime(runtime,path.join(root,'data'),'1.0.1');
    if(before!==(await fs.stat(marker)).mtimeMs)throw Error('Initialization repeated');
    const book=path.join(root,'小说.txt');
    await fs.writeFile(book,'星辰照亮森林，林舟来到城堡，森林围绕城堡。'.repeat(30));
    await exec(runtime.command,[book,'--out',path.join(root,'results/analysis.json')],{env:{...runtime.env,PATH:''},timeout:120000});
    const result=JSON.parse(await fs.readFile(path.join(root,'results/analysis.json'),'utf8'));
    if(!result.keywords?.length)throw Error('Missing keywords');
    console.log('Bundled analyzer initialization, cache reuse and offline analysis passed.');
  }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
