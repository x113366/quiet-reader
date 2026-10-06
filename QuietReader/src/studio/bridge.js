const tellParent=message=>window.parent.postMessage(message,'*');
$('download').onclick=()=>tellParent({type:'export-png',data:canvas.toDataURL('image/png')});
$('studio-back').onclick=()=>tellParent({type:'back'});
$('studio-style').onclick=()=>tellParent({type:'switch-style'});
document.querySelectorAll('[data-window]').forEach(button=>button.onclick=()=>tellParent({type:'window-control',action:button.dataset.window}));
$('analyze-book').onclick=()=>{
  $('analyze-book').disabled=true;$('book-analysis-status').textContent='正在本机分析全文…完成后自动载入加权词表。';tellParent({type:'analyze-book'});
};
window.addEventListener('message',event=>{
  if(event.source!==window.parent)return;const message=event.data;
  if(message.type==='export-result')$('status').textContent=message.text;
  if(message.type==='platform')document.body.classList.toggle('mac',message.platform==='darwin');
  if(message.type==='ui-style'){document.body.dataset.ui=message.style;$('studio-style').textContent=message.style==='dark'?'浅色 UI':'深色 UI';}
  if(message.type==='book'){$('analyze-book').disabled=!message.title;$('analyze-book').textContent=message.title?'分析《'+message.title+'》':'先打开书籍，或导入 TXT';}
  if(message.type==='analysis-error'){$('analyze-book').disabled=false;$('book-analysis-status').textContent=message.error;}
  if(message.type==='analysis-result'){
    $('analyze-book').disabled=false;const result=message.result;
    $('source').value=result.keywords.map(row=>`${row.word}, ${row.final_score}`).join('\n');
    document.querySelector('[data-mode="weights"]').click();
    $('book-analysis-status').textContent=`《${message.title}》 · ${result.keywords.length} 个关键词 · ${result.cache_hit?'已读取缓存':'全文分析完成'}`;
    $('analysis-details').hidden=false;$('analysis-report').textContent=result.report;
    if(running){canvas.addEventListener('wordcloudstop',()=>generate(),{once:true});}else generate();
  }
});
tellParent({type:'studio-ready'});
const draftFields=['source','minfreq','minlength','exclude','font','weight','bg','size','gap','rotation','limit','width','height'];
let restoringDraft=false,draftTimer;
function saveDraft(){if(restoringDraft)return;const state={mode,shape,palette,fields:{},autofilter:$('autofilter').checked,transparent:$('transparent').checked};for(const id of draftFields)state.fields[id]=$(id).value;tellParent({type:'studio-draft',state});}
document.addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,500);});
document.addEventListener('click',e=>{if(e.target.closest('[data-shape],[data-preset],#palettes,[data-mode],#generate,#demo')){clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,500);}});
window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.type!=='restore-draft')return;const state=event.data.state;if(!state?.fields)return;restoringDraft=true;
 for(const id of draftFields)if(typeof state.fields[id]==='string')$(id).value=state.fields[id];
 mode=state.mode==='weights'?'weights':'text';shape=['circle','cardioid','star','diamond','triangle','square'].includes(state.shape)?state.shape:'circle';palette=Math.max(0,Math.min(3,Number(state.palette)||0));$('autofilter').checked=!!state.autofilter;$('transparent').checked=!!state.transparent;
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.querySelectorAll('[data-shape]').forEach(b=>b.classList.toggle('active',b.dataset.shape===shape));document.querySelectorAll('#palettes button').forEach((b,i)=>b.classList.toggle('active',i===palette));for(const id of ['size','gap'])$(id+'-out').value=$(id).value;
 restoringDraft=false;if(running)canvas.addEventListener('wordcloudstop',()=>generate(),{once:true});else generate();
});

window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.type!=='reset-studio')return;clearTimeout(draftTimer);WordCloud.stop();$('source').value='';$('analysis-report').textContent='';$('analysis-details').hidden=true;$('book-analysis-status').textContent='也可以独立导入文本创作词云。';$('analyze-book').disabled=true;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);$('status').textContent='请选择素材';});
