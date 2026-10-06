const fs=require('node:fs');
const path=require('node:path');
function pythonRuntime({projectDir,packaged=false,platform=process.platform,env=process.env}){
  if(env.QUIET_READER_PYTHON)return {command:env.QUIET_READER_PYTHON,args:[]};
  if(!packaged){
    const local=path.join(projectDir,'.venv',platform==='win32'?'Scripts/python.exe':'bin/python');
    if(fs.existsSync(local))return {command:local,args:[]};
  }
  return {command:platform==='win32'?'py':'python3',args:platform==='win32'?['-3']:[]};
}
module.exports={pythonRuntime};
