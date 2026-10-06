(function(root){
  function normalize(text){const chars=[],map=[];let offset=0;for(const ch of text){const normalized=ch.normalize('NFKC').toLowerCase();for(const c of normalized){if(!/[\s\p{P}]/u.test(c)){chars.push(c);map.push(offset);}}offset+=ch.length;}return {chars,map};}
  function distanceOne(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,errors=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++errors>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return errors+(a.length-i)+(b.length-j)<=1;}
  function search(paragraphs,query,mode='exact',limit=200){
    const results=[];if(!query.trim())return results;
    const needle=normalize(query).chars;
    for(let p=0;p<paragraphs.length;p++){
      const text=paragraphs[p].text;
      const add=(start,end)=>{results.push({paragraph:p,start,end,excerpt:text.slice(Math.max(0,start-20),Math.min(text.length,end+35))});};
      if(mode==='exact'){
        let offset=0;while((offset=text.indexOf(query,offset))!==-1){add(offset,offset+query.length);offset+=Math.max(1,query.length);if(results.length>=limit)return results;}
      }else{
        if(!needle.length)return results;
        const hay=normalize(text),m=needle.length;
        // Two exact seeds cover all matches with at most one insertion/deletion/substitution.
        const candidates=new Set(),parts=m>=3?[[0,needle.slice(0,m>>1)],[m>>1,needle.slice(m>>1)]]:[[0,needle]];
        const joined=hay.chars.join('');const charOffsets=[];let n=0;for(let k=0;k<hay.chars.length;k++){charOffsets[n]=k;n+=hay.chars[k].length;}
        for(const [seedOffset,seed] of parts){let from=0,index;const seedText=seed.join('');while((index=joined.indexOf(seedText,from))!==-1){const pos=charOffsets[index];for(let shift=(m>=3?-1:0);shift<=(m>=3?1:0);shift++){const start=pos-seedOffset+shift;if(start>=0&&start<hay.chars.length)candidates.add(start);}from=index+seedText.length;}}
        let previousEnd=-1;
        for(const start of [...candidates].sort((a,b)=>a-b)){
          if(start<previousEnd)continue;
          // Prefer exact normalized matches at this position, then one-edit variants.
          for(const length of (m>=3?[m,m-1,m+1]:[m])){
            if(start+length>hay.chars.length)continue;
            const chunk=hay.chars.slice(start,start+length);
            if(m<3?chunk.join('')===needle.join(''):distanceOne(needle,chunk)){
              const rawStart=hay.map[start],last=hay.map[start+length-1];
              const rawEnd=last+String.fromCodePoint(text.codePointAt(last)).length;
              add(rawStart,rawEnd);previousEnd=start+length;break;
            }
          }
          if(results.length>=limit)return results;
        }
      }
    }
    return results;
  }
  if(typeof module!=='undefined')module.exports={search,normalize,distanceOne};else root.searchText=search;
})(globalThis);
