const path=require('node:path');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {pythonRuntime}=require('../src/python-runtime.cjs');
const root=path.resolve(__dirname,'..');
const venv=path.join(root,'.venv');
const local=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw new Error(`无法运行 ${command}。请安装 Python 3.10+，或通过 QUIET_READER_PYTHON 指定解释器。`);if(result.status!==0)throw new Error('Python 环境初始化失败，请查看上方错误。');}
try{
 if(!fs.existsSync(local)){const runtime=pythonRuntime({projectDir:root});run(runtime.command,[...runtime.args,'-m','venv',venv]);}
 run(local,['-m','pip','install','-r',path.join(root,'analysis/requirements.txt')]);
 run(local,['-c','import jieba; print("词云分析环境已就绪")']);
}catch(error){console.error(error.message);process.exitCode=1;}
