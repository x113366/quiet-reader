const {search,normalize}=require('./search-engine.js');
const presets=[
 {id:'download',name:'下载站引流',rules:['更多免费小说请访问','本书由本站整理','请访问最新网址']},
 {id:'group',name:'群聊与公众号推广',rules:['加群获取更多小说','关注微信公众号获取','扫码加入小说交流群']},
 {id:'promotion',name:'求票与站点提示',rules:['请收藏本站','请记住本站域名','求推荐票求月票']}
];
function options(value={}){
 const mode=value.mode==='fuzzy'?'fuzzy':'exact';
 const selected=Array.isArray(value.presets)?value.presets:[];
 const custom=typeof value.rules==='string'?value.rules.split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[];
 const rules=[...new Set([...presets.filter(p=>selected.includes(p.id)).flatMap(p=>p.rules),...custom])];
 if(rules.length>50||rules.some(s=>s.length>160))throw new Error('最多 50 条规则，每条最多 160 字');
 if(value.enabled&&rules.some(s=>normalize(s).chars.length<4))throw new Error('规则至少包含 4 个有效字符，避免误删正文');
 return {enabled:!!value.enabled,mode,presets:selected.filter(id=>presets.some(p=>p.id===id)),rules:custom.join('\n'),patterns:rules};
}
function clean(text,input){
 const config=options(input);if(!config.enabled)return {text,removed:0,matches:[]};
 if(!config.patterns.length)throw new Error('请勾选清洗方案或输入自定义广告规则');
 const matches=[];let removed=0;const output=[];
 for(const [index,line] of text.split(/\r?\n/).entries()){
  // Very long prose paragraphs are excluded from whole-line ad removal.
  const rule=line.length<=2000&&config.patterns.find(rule=>config.mode==='exact'?line.includes(rule):search([{text:line}],rule,'fuzzy',1).length>0);
  if(rule){removed++;if(matches.length<100)matches.push({line:index+1,text:line.slice(0,500),rule});}else output.push(line);
 }
 return {text:output.join('\n'),removed,matches};
}
module.exports={presets,options,clean};
