const fs=require('node:fs');
const path=require('node:path');
module.exports=async context=>{
  const root=context.packager.projectDir;
  const file=path.join(root,'runtime/quiet-analyzer/build-info.json');
  if(!fs.existsSync(file))throw new Error('请先运行 python scripts/build_analyzer.py，生成内置分析器。');
  const info=JSON.parse(fs.readFileSync(file,'utf8'));
  const arch=require('builder-util').Arch[context.arch];
  if(info.platform!==context.electronPlatformName||info.arch!==arch)throw new Error(`分析器为 ${info.platform}/${info.arch}，不能打包为 ${context.electronPlatformName}/${arch}。请在目标平台重新构建分析器。`);
};
