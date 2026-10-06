importScripts('search-engine.js');
let paragraphs=[];
self.onmessage=({data})=>{
  if(data.paragraphs){paragraphs=data.paragraphs;return;}
  try{self.postMessage({request:data.request,results:self.searchText(paragraphs,data.query,data.mode)});}
  catch(error){self.postMessage({request:data.request,error:error.message});}
};
