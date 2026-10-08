const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('./store.cjs');const {CloudSync,rpc,json,atomic}=require('./cloud-sync.cjs');
class Accounts{
 constructor(root,safeStorage){this.root=root;this.safeStorage=safeStorage;this.session=null;this.lastError='';this.busy=false;}
 async init(){
  this.device=await json(path.join(this.root,'device.json'),null);if(!this.device){this.device={id:crypto.randomUUID()};await atomic(path.join(this.root,'device.json'),JSON.stringify(this.device));}
  try{if(this.safeStorage.isEncryptionAvailable()){const bytes=await fs.readFile(path.join(this.root,'cloud-session.bin'));const s=JSON.parse(this.safeStorage.decryptString(bytes));if(/^[a-f0-9-]{36}$/.test(s.id)&&/^[a-f0-9]{64}$/.test(s.token))this.session=s;}}catch(e){if(e.code!=='ENOENT')this.lastError='保存的登录状态无法读取，请重新登录。';}
  await this.select();return this.store;
 }
 async select(){this.store=new Store(this.session?path.join(this.root,'accounts',this.session.id):this.root);await this.store.init();this.sync=this.session?new CloudSync(this.store,this.session,this.device.id):null;}
 status(){return {user:this.session?{id:this.session.id,username:this.session.username}:null,busy:this.busy,last:this.sync?.last,error:this.lastError};}
 async login(username,password,register,importLocal){
  if(typeof username!=='string'||typeof password!=='string'||username.length>32||password.length>200)throw new Error('无效用户名或密码');
  if(register)await rpc('quiz_register_user',{p_username:username,p_password:password});
  const session=await rpc('reader_login',{p_username:username,p_password:password});
  if(!session||!/^[a-f0-9-]{36}$/.test(session.id)||!/^[a-f0-9]{64}$/.test(session.token))throw new Error('云端登录响应无效');
  const previous={session:this.session,store:this.store,sync:this.sync};
  try{
   this.session=session;await this.select();if(importLocal)await this.importGuest();
   if(this.safeStorage.isEncryptionAvailable())await atomic(path.join(this.root,'cloud-session.bin'),this.safeStorage.encryptString(JSON.stringify(session)));
   this.lastError='';return this.status();
  }catch(e){this.session=previous.session;this.store=previous.store;this.sync=previous.sync;throw e;}

 }
 async importGuest(){
  for(const dir of ['books','analysis']){try{await fs.cp(path.join(this.root,dir),path.join(this.store.root,dir),{recursive:true,force:false,errorOnExist:false});}catch(e){if(e.code!=='ENOENT')throw e;}}
  const guest=await json(path.join(this.root,'preferences.json'),{});
  await this.store.updatePreferences(p=>{p.themes||=[];for(const theme of guest.themes||[])if(!p.themes.some(t=>t.name===theme.name))p.themes.push(theme);for(const key of ['uiStyle','cleaning','studio'])if(p[key]===undefined&&guest[key]!==undefined)p[key]=guest[key];p.dayCounters||={};const key='guest_'+this.device.id;if(!p.dayCounters[key])p.dayCounters[key]=guest.days||{};p.days=require('./cloud-sync.cjs').sumDays(p.dayCounters);});
 }
 async logout(){
  let warning='';try{if(this.session)await rpc('reader_logout',{p_token:this.session.token});}catch{warning='已退出本机登录，离线会话将在云端到期后失效。';}
  await fs.rm(path.join(this.root,'cloud-session.bin'),{force:true});this.session=null;await this.select();this.lastError=warning;return this.status();
 }
 async synchronize(activeReadingKey=null){if(!this.sync)throw new Error('请先登录');return this.exclusive(()=>this.sync.run(activeReadingKey));}
 async exclusive(action){if(this.busy)throw new Error('同步正在进行');this.busy=true;const operation=this.store.queue.then(action);this.store.queue=operation.catch(()=>{});try{const result=await operation;this.lastError='';return result;}catch(e){this.lastError=e.message;throw e;}finally{this.busy=false;}}
}
module.exports={Accounts};
