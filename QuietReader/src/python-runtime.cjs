const fs=require('node:fs');
const path=require('node:path');
function pythonRuntime({projectDir,packaged=false,resourcesPath=process.resourcesPath,platform=process.platform,env=process.env}){
  if(packaged){
    const command=path.join(resourcesPath,'runtime','quiet-analyzer',platform==='win32'?'quiet-analyzer.exe':'quiet-analyzer');
    if(!fs.existsSync(command))throw new Error('安装包缺少词云运行环境，请重新下载完整 Release。');
    return {command,args:[],bundled:true};
  }
  if(env.QUIET_READER_PYTHON)return {command:env.QUIET_READER_PYTHON,args:[]};
  if(!packaged){
    const local=path.join(projectDir,'.venv',platform==='win32'?'Scripts/python.exe':'bin/python');
    if(fs.existsSync(local))return {command:local,args:[]};
  }
  return {command:platform==='win32'?'py':'python3',args:platform==='win32'?['-3']:[]};
}
module.exports={pythonRuntime};
