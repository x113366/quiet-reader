// Compact per-line indices. Text is sent only once per book; reflows reuse it.
let paragraphs=[],pending;
self.onmessage=({data})=>{
  if(data.paragraphs) paragraphs=data.paragraphs;
  clearTimeout(pending);pending=setTimeout(()=>compute(data),25);
};
function compute(data){
  try {
    const {fontSize,lineHeight,padding,width,request}=data;
    const ctx=new OffscreenCanvas(1,1).getContext('2d');
    ctx.font=`${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const cache=new Map(), pIndices=[], starts=[], ends=[], tops=[];
    const inset=Math.min(padding,Math.max(16,(width-fontSize*5)/2));
    const usable=width-2*inset, lh=fontSize*lineHeight;
    let y=32;
    const measure=ch=>{if(!cache.has(ch)) cache.set(ch,ctx.measureText(ch).width);return cache.get(ch);};
    for(let p=0;p<paragraphs.length;p++) {
      const text=paragraphs[p].text;
      let start=0,offset=0,x=fontSize*2;
      for(const ch of text) {
        const w=measure(ch);
        if(x+w>usable && offset>start) {
          pIndices.push(p);starts.push(start);ends.push(offset);tops.push(y);
          y+=lh;start=offset;x=0;
        }
        x+=w;offset+=ch.length;
      }
      pIndices.push(p);starts.push(start);ends.push(offset);tops.push(y);
      y+=lh*(1+paragraphs[p].gap);
    }
    const result={request,inset,lh,total:y+32,p:Uint32Array.from(pIndices),start:Uint32Array.from(starts),end:Uint32Array.from(ends),top:Float64Array.from(tops),widths:[...cache]};
    self.postMessage(result,[result.p.buffer,result.start.buffer,result.end.buffer,result.top.buffer]);
  } catch(e) {self.postMessage({request:data.request,error:e.message});}
}
