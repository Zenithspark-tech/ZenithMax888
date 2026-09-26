const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const shortsRemote = require('./shorts_remote');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const GAME_DIR = path.join(DATA_DIR, 'games');
const DB = path.join(DATA_DIR, 'db.json');
const SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION';
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, 'starter_catalog.json'), 'utf8'));
const SHORTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'shorts_catalog.json'), 'utf8'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(GAME_DIR, { recursive: true });

const REMOTE_CACHE = path.join(DATA_DIR, 'remote_video_cache.json');
const RESUMABLE_DIR = path.join(DATA_DIR, 'resumable');
const RESUMABLE_CHUNK = 4 * 1024 * 1024;
fs.mkdirSync(RESUMABLE_DIR, { recursive: true });
const ALLOWED_LICENSES = ['CC0','Public domain','CC BY','CC BY-SA'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function isAllowedLicense(license){
  const s=String(license||'').replace(/<[^>]+>/g,'').trim().toLowerCase();
  return ALLOWED_LICENSES.some(x=>s.includes(x.toLowerCase()));
}
async function commonsSearch(term, limit=50){
  const qs=new URLSearchParams({
    action:'query',generator:'search',gsrsearch:String(term),gsrnamespace:'6',gsrlimit:String(Math.min(limit,50)),
    prop:'imageinfo',iiprop:'url|mime|extmetadata',format:'json',origin:'*'
  });
  const r=await fetch(`https://commons.wikimedia.org/w/api.php?${qs.toString()}`,{headers:{'User-Agent':'ZenithMax/20 remote starter media'},signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Commons API ${r.status}`);
  const j=await r.json();
  return Object.values(j.query?.pages||{}).map(page=>{
    const ii=page.imageinfo?.[0]||{}, md=ii.extmetadata||{};
    return {
      title:String(page.title||'').replace(/^File:/,''),
      url:ii.url||'', mime:ii.mime||'',
      license:md.LicenseShortName?.value||md.License?.value||'',
      sourcePage:`https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title||''))}`,
      sourceCreator:md.Artist?.value||md.Credit?.value||''
    };
  }).filter(x=>/^video\/(mp4|webm|ogg)$/i.test(x.mime)&&x.url&&isAllowedLicense(x.license));
}
function tokenScore(a,b){
  const stop=new Set(['video','videos','the','and','for','with','of','a','an','on','in']);
  const A=new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x&&!stop.has(x)));
  const B=String(b).toLowerCase();
  let score=0; for(const t of A) if(B.includes(t)) score+=t.length>=6?3:1; return score;
}
async function resolveRemoteCatalog(){
  let cache={}; try{if(fs.existsSync(REMOTE_CACHE))cache=JSON.parse(fs.readFileSync(REMOTE_CACHE,'utf8'));}catch{}
  const used=new Set();
  // Reuse already verified cache entries first.
  for(const item of CATALOG.videos){
    const hit=cache[item.slug];
    if(hit?.url && isAllowedLicense(hit.license)){
      Object.assign(item,{remoteUrl:hit.url,remoteTitle:hit.title,license:hit.license,sourcePage:hit.sourcePage,sourceCreator:hit.sourceCreator,mediaSource:'Wikimedia Commons'});
      used.add(hit.url);
    }
  }
  const cats=[...new Set(CATALOG.videos.map(v=>v.category))];
  for(const cat of cats){
    const pending=CATALOG.videos.filter(v=>v.category===cat && !v.remoteUrl);
    if(!pending.length) continue;
    let pool=[];
    try{ pool=await commonsSearch(`${cat.toLowerCase()} video`,50); }catch(err){ console.warn(`Remote pool lookup failed for ${cat}: ${err.message}`); }
    // Prefer files whose titles overlap the requested topic; then fill any gaps from the category pool.
    const available=pool.filter(x=>!used.has(x.url));
    const chosen=new Set();
    for(const item of pending){
      const ranked=[...available].filter(x=>!chosen.has(x.url)).sort((a,b)=>tokenScore(item.searchTopic,a.title)-tokenScore(item.searchTopic,b.title));
      const hit=ranked.find(x=>tokenScore(item.searchTopic,x.title)>0) || ranked[0];
      if(hit){
        Object.assign(item,{remoteUrl:hit.url,remoteTitle:hit.title,license:hit.license,sourcePage:hit.sourcePage,sourceCreator:hit.sourceCreator,mediaSource:'Wikimedia Commons'});
        used.add(hit.url); chosen.add(hit.url); cache[item.slug]=hit;
      }
    }
  }
  // A final small number of topic searches handles category terms that Commons does not index well.
  const unresolved=CATALOG.videos.filter(v=>!v.remoteUrl);
  for(let i=0;i<unresolved.length;i+=6){
    const batch=unresolved.slice(i,i+6);
    const results=await Promise.all(batch.map(async item=>{
      try{return [item, await commonsSearch(`${item.searchTopic} video`,20)]}catch(err){console.warn(`Topic lookup failed for ${item.searchTopic}: ${err.message}`);return [item,[]]}
    }));
    for(const [item,rs] of results){
      const hit=rs.find(x=>!used.has(x.url));
      if(hit){
        Object.assign(item,{remoteUrl:hit.url,remoteTitle:hit.title,license:hit.license,sourcePage:hit.sourcePage,sourceCreator:hit.sourceCreator,mediaSource:'Wikimedia Commons'});
        used.add(hit.url); cache[item.slug]=hit;
      } else Object.assign(item,{remoteUrl:'',remoteTitle:'Remote source unavailable',mediaSource:'unresolved'});
    }
  }
  try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(REMOTE_CACHE,JSON.stringify(cache,null,2));}catch{}
  CATALOG.remote_video_library=Object.values(cache).filter(x=>x?.url);
  return {unique:[...used].length,unresolved:CATALOG.videos.filter(v=>!v.remoteUrl).length};
}

const COLLECTIONS = ['users','videos','comments','follows','likes','stories','messages','notifications','bookmarks','reports','history','playlists','subscriptions','creatorSubscriptions','tips','adCampaigns','earnings','music','games'];
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const clean = (v, n=500) => String(v || '').trim().slice(0, n);

function save(d){ fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }
function seed(d){
  let changed = false;
  d.users ??= []; d.videos ??= [];
  for (const c of CATALOG.creators){
    if (!d.users.some(u => u.id === c.id)){
      d.users.push({
        id:c.id, name:c.name, email:c.id+'@demo.zenithmax.app',
        password:bcrypt.hashSync('zenithmax-starter-library',8), bio:c.bio,
        followers:350+Math.floor(Math.random()*4200), following:12,
        role:'creator', createdAt:'2026-01-01T00:00:00.000Z', starter:true,
        verified:true, avatar:'', banner:'', notificationsEnabled:true
      });
      changed = true;
    }
  }
  CATALOG.videos.forEach((x,i)=>{
    const vid='starter-'+x.slug;
    const existing=d.videos.find(v=>v.id===vid);
    const c=CATALOG.creators[x.creatorIndex%CATALOG.creators.length];
    if(existing){
      // Migrate older starter records away from bundled /demo_videos files.
      if(existing.starter && x.remoteUrl && (existing.url!==x.remoteUrl || existing.license!==x.license || existing.sourcePage!==x.sourcePage)){
        existing.url=x.remoteUrl;
        existing.remoteTitle=x.remoteTitle||'';
        existing.audio=x.audio!==false;
        existing.mediaSource=x.mediaSource||'remote';
        existing.license=x.license||'';
        existing.sourcePage=x.sourcePage||'';
        existing.sourceCreator=x.sourceCreator||'';
        changed=true;
      }
      return;
    }
    d.videos.push({
      id:vid,userId:c.id,title:x.title,description:x.description,category:x.category,
      tags:x.tags,url:x.remoteUrl||'',remoteTitle:x.remoteTitle||'',audio:x.audio!==false,mediaSource:x.mediaSource||'remote',license:x.license||'',sourcePage:x.sourcePage||'',sourceCreator:x.sourceCreator||'',likes:70+(i*43)%9500,
      views:1200+(i*7919)%980000,createdAt:new Date(Date.now()-i*2100000).toISOString(),
      starter:true,duration:i<24?5:2,status:'published'
    });
    changed=true;
  });
  SHORTS.shorts.forEach((x,i)=>{
    const existing=d.videos.find(v=>v.id===x.id);
    const c=SHORTS.shorts[i];
    const creator=CATALOG.creators[x.creatorIndex%CATALOG.creators.length];
    const remote=`https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(x.sourceFile)}`;
    if(existing){
      const next={url:remote,sourcePage:x.sourcePage,sourceCreator:x.sourceCreator,license:x.license,audio:true,isShort:true,starter:true,shortCategory:x.category};
      let diff=false; for(const [k,val] of Object.entries(next)){ if(existing[k]!==val){ existing[k]=val; diff=true; } }
      if(diff) changed=true;
      return;
    }
    d.videos.push({
      id:x.id,userId:creator.id,title:x.title,description:x.description,category:x.category,tags:x.tags,
      url:remote,remoteTitle:x.title,remoteUrl:remote,audio:true,mediaSource:'Wikimedia Commons',license:x.license,sourcePage:x.sourcePage,sourceCreator:x.sourceCreator,likes:45+(i*71)%1900,
      views:900+(i*1831)%76000,createdAt:new Date(Date.now()-i*930000).toISOString(),starter:true,isShort:true,shortCategory:x.category,duration:x.duration,status:'published'
    });
    changed=true;
  });
  return changed;
}
function load(){
  if(!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(Object.fromEntries(COLLECTIONS.map(k=>[k,[]])),null,2));
  const d=JSON.parse(fs.readFileSync(DB,'utf8'));
  for(const k of COLLECTIONS) if(!Array.isArray(d[k])) d[k]=[];
  if(seed(d)) save(d);
  return d;
}
function auth(req,res,next){
  try{ req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET); next(); }
  catch{ res.status(401).json({error:'Please sign in'}); }
}
function optional(req,res,next){
  try{ req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET); }
  catch{ req.user=null; }
  next();
}
function safeUser(u){ if(!u)return null; const {password,...rest}=u; return rest; }
function notify(d,userId,type,text,link='',actorId=''){
  if(!userId || userId===actorId) return;
  d.notifications.push({id:uid(),userId,type,text,link,actorId,read:false,createdAt:now()});
  if(d.notifications.length>3000) d.notifications=d.notifications.slice(-3000);
}
function pub(d,v,req){
  const u=d.users.find(x=>x.id===v.userId);
  return {...v,streamUrl:v.isShort?`/api/short-video/${encodeURIComponent(v.id)}`:(v.starter?`/api/starter-video/${encodeURIComponent(v.id)}`:v.url),creator:u?.name||'ZenithMax Creator',creatorId:v.userId,verified:!!u?.verified,avatar:u?.avatar||'',
    liked:!!req.user&&d.likes.some(x=>x.videoId===v.id&&x.userId===req.user.id),
    saved:!!req.user&&d.bookmarks.some(x=>x.userId===req.user.id&&x.videoId===v.id),
    following:!!req.user&&d.follows.some(x=>x.userId===req.user.id&&x.targetId===v.userId),
    commentCount:d.comments.filter(c=>c.videoId===v.id).length};
}
function affinity(d,userId){
  const out={};
  if(!userId) return out;
  const hist=d.history.filter(h=>h.userId===userId).slice(-120);
  for(const h of hist){ const v=d.videos.find(x=>x.id===h.videoId); if(v) out[v.category]=(out[v.category]||0)+1+Math.min(1,(h.progress||0)/100); }
  for(const b of d.bookmarks.filter(b=>b.userId===userId)){ const v=d.videos.find(x=>x.id===b.videoId); if(v) out[v.category]=(out[v.category]||0)+2.2; }
  return out;
}
function score(d,v,req,source){
  let s=Math.log10((v.views||0)+10)*26+Math.log10((v.likes||0)+5)*45+(v.starter?4:0);
  if(source&&v.category===source.category) s+=80;
  if(req.user){
    const a=affinity(d,req.user.id); s+=(a[v.category]||0)*18;
    if(d.follows.some(x=>x.userId===req.user.id&&x.targetId===v.userId)) s+=150;
    if(d.bookmarks.some(x=>x.userId===req.user.id&&x.videoId===v.id)) s+=35;
    if(d.history.some(x=>x.userId===req.user.id&&x.videoId===v.id&&x.progress>90)) s-=40;
  }
  const ageHours=Math.max(1,(Date.now()-new Date(v.createdAt))/36e5); s+=Math.max(0,50-Math.log10(ageHours+1)*20);
  return s;
}
function reasons(d,v,req){
  const r=[];
  if(req.user&&d.follows.some(x=>x.userId===req.user.id&&x.targetId===v.userId)) r.push('From a creator you follow');
  if(req.user&&(affinity(d,req.user.id)[v.category]||0)>1) r.push('Because you watch '+v.category.toLowerCase());
  if(v.views>100000) r.push('Popular on ZenithMax');
  if(!r.length) r.push('Recommended for you');
  return r.slice(0,2);
}

const storage=multer.diskStorage({destination:UPLOAD_DIR,filename:(req,f,cb)=>cb(null,uid()+path.extname(f.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:250*1024*1024},fileFilter:(req,f,cb)=>cb(null,/^video\/(mp4|webm|quicktime)$/.test(f.mimetype))});
const mediaUpload=multer({storage,limits:{fileSize:100*1024*1024},fileFilter:(req,f,cb)=>{const ok=/^(video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|ogg|webm)|image\/(jpeg|png|webp|gif))$/.test(f.mimetype);cb(null,ok)}});
const mediaType=m=>m.startsWith('video/')?'video':m.startsWith('audio/')?'audio':m.startsWith('image/')?'image':'file';
const musicUpload=multer({storage,limits:{fileSize:150*1024*1024},fileFilter:(req,f,cb)=>cb(null,/^(audio\/(mpeg|mp4|wav|ogg|webm|aac|flac)|video\/mp4)$/.test(f.mimetype)||/\.(mp3|m4a|wav|ogg|webm|aac|flac)$/i.test(f.originalname))});
const gameUpload=multer({storage,limits:{fileSize:200*1024*1024},fileFilter:(req,f,cb)=>cb(null,/zip|compressed/i.test(f.mimetype)||/\.zip$/i.test(f.originalname))});
const profileUpload=multer({storage,limits:{fileSize:5*1024*1024},fileFilter:(req,f,cb)=>cb(null,/^image\/(jpeg|png|webp|gif)$/i.test(f.mimetype))});
function safeGameEntry(name){
  const n=String(name||'').replaceAll('\\','/');
  if(!n || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return false;
  if(n.split('/').includes('..')) return false;
  if(n.length>240) return false;
  return true;
}
function extractGameZip(zipPath, gameId){
  const zip=new AdmZip(zipPath);
  const entries=zip.getEntries();
  if(entries.length<1 || entries.length>2000) throw new Error('Game package must contain 1–2000 files');
  const root=path.join(GAME_DIR,gameId);
  fs.mkdirSync(root,{recursive:true});
  let total=0, hasIndex=false;
  for(const entry of entries){
    if(entry.isDirectory) continue;
    const name=String(entry.entryName||'').replaceAll('\\','/').replace(/^\.\//,'');
    if(!safeGameEntry(name)) throw new Error('Unsafe file path in game package');
    const ext=path.extname(name).toLowerCase();
    if(['.exe','.dll','.so','.dylib','.bat','.cmd','.ps1','.sh','.bash','.php','.py','.rb','.pl','.cgi'].includes(ext)) throw new Error('Game packages may only contain browser files');
    const data=entry.getData(); total+=data.length;
    if(total>200*1024*1024) throw new Error('Game package expands beyond 200 MB');
    const out=path.join(root,name);
    if(!out.startsWith(root+path.sep) && out!==root) throw new Error('Unsafe extraction path');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,data);
    if(name.toLowerCase()==='index.html' || name.toLowerCase().endsWith('/index.html')) hasIndex=true;
  }
  if(!hasIndex) throw new Error('Game ZIP must include an index.html entry point');
  return {root,total,files:entries.length,index:'index.html'};
}
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/uploads',express.static(UPLOAD_DIR));
app.use('/game-assets',express.static(GAME_DIR,{fallthrough:false}));
app.use(express.static(path.join(ROOT,'client')));

app.get('/api/health',(req,res)=>{const d=load();const sv=d.videos.filter(v=>v.starter&&v.url);const rs=shortsRemote.stats();res.json({ok:true,version:'20.0.0',shortsCatalogCapacity:shortsRemote.SHORTS_CAPACITY,remoteUniqueShorts:rs.total,videos:d.videos.length,starterVideos:d.videos.filter(v=>v.starter&&!v.isShort).length,remoteStarterVideos:sv.filter(v=>!v.isShort).length,uniqueStarterUrls:new Set(sv.filter(v=>!v.isShort).map(v=>v.url)).size,shorts:d.videos.filter(v=>v.isShort).length,uniqueShortUrls:new Set(d.videos.filter(v=>v.isShort).map(v=>v.url)).size,music:d.music.length,games:d.games.length,categories:[...new Set(sv.filter(v=>!v.isShort).map(v=>v.category))].sort()});});
app.get('/api/starter-video/:id',async(req,res)=>{
  try{
    const d=load(),v=d.videos.find(x=>x.id===req.params.id&&x.starter); if(!v)return res.sendStatus(404);
    const catalogItem=CATALOG.videos.find(x=>'starter-'+x.slug===v.id);
    async function pickSource(){
      if(catalogItem?.remoteUrl){v.url=catalogItem.remoteUrl;v.license=catalogItem.license||'';v.sourcePage=catalogItem.sourcePage||'';v.sourceCreator=catalogItem.sourceCreator||'';save(d);return true;}
      if(!catalogItem?.searchTopic)return false;
      const rs=await commonsSearch(`${catalogItem.searchTopic} video`,20); const hit=rs[0];
      if(!hit)return false;
      v.url=hit.url;v.license=hit.license;v.sourcePage=hit.sourcePage;v.sourceCreator=hit.sourceCreator;v.audio=true;save(d);Object.assign(catalogItem,{remoteUrl:hit.url,license:hit.license,sourcePage:hit.sourcePage,sourceCreator:hit.sourceCreator});return true;
    }
    if(!v.url && !(await pickSource()))return res.status(404).json({error:'Starter video source is temporarily unavailable. Please try again.'});
    const headers={'User-Agent':'ZenithMax/17 video proxy'}; if(req.headers.range)headers.Range=req.headers.range;
    let upstream=await fetch(v.url,{headers});
    if(!upstream.ok && upstream.status!==206 && await pickSource()) upstream=await fetch(v.url,{headers});
    if(!upstream.ok && upstream.status!==206) return res.status(upstream.status).json({error:'Remote video source returned '+upstream.status});
    res.status(upstream.status);
    const ct=upstream.headers.get('content-type'); if(ct)res.setHeader('Content-Type',ct);
    for(const h of ['content-length','content-range','accept-ranges','etag','last-modified']){const value=upstream.headers.get(h);if(value)res.setHeader(h,value)}
    if(upstream.body){require('stream').Readable.fromWeb(upstream.body).pipe(res);} else res.end();
  }catch(e){res.status(502).json({error:'Video source could not be reached right now'});}
});

app.post('/api/auth/register',async(req,res)=>{
  const name=clean(req.body.name,60),email=clean(req.body.email,160).toLowerCase(),password=String(req.body.password||'');
  if(!name||!email||password.length<6)return res.status(400).json({error:'Name, email and a 6+ character password are required'});
  const d=load(); if(d.users.some(u=>u.email===email))return res.status(409).json({error:'Email already registered'});
  const humanUsers=d.users.filter(u=>!u.starter);
  const u={id:uid(),name,email,password:await bcrypt.hash(password,10),bio:'New ZenithMax creator',followers:0,following:0,role:humanUsers.length===0?'admin':'user',createdAt:now(),verified:false,notificationsEnabled:true};
  d.users.push(u); save(d);
  res.json({token:jwt.sign({id:u.id,name:u.name},SECRET,{expiresIn:'30d'}),user:safeUser(u)});
});
app.post('/api/auth/login',async(req,res)=>{
  const d=load(),u=d.users.find(x=>x.email===clean(req.body.email,160).toLowerCase());
  if(!u||!(await bcrypt.compare(req.body.password||'',u.password)))return res.status(401).json({error:'Invalid email or password'});
  res.json({token:jwt.sign({id:u.id,name:u.name},SECRET,{expiresIn:'30d'}),user:safeUser(u)});
});
app.post('/api/auth/refresh',auth,(req,res)=>{
  const d=load(),u=d.users.find(x=>x.id===req.user.id); if(!u)return res.sendStatus(404);
  res.json({token:jwt.sign({id:u.id,name:u.name},SECRET,{expiresIn:'30d'}),user:safeUser(u)});
});
app.get('/api/me',auth,(req,res)=>res.json({user:safeUser(load().users.find(x=>x.id===req.user.id))}));
app.patch('/api/me',auth,(req,res)=>{
  const d=load(),u=d.users.find(x=>x.id===req.user.id); if(!u)return res.sendStatus(404);
  if(req.body.name)u.name=clean(req.body.name,60); if(req.body.bio!==undefined)u.bio=clean(req.body.bio,300);
  save(d); res.json({user:safeUser(u)});
});
app.post('/api/me/avatar',auth,profileUpload.single('avatar'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose a JPG, PNG, WEBP or GIF image'});
  const d=load(),u=d.users.find(x=>x.id===req.user.id); if(!u)return res.sendStatus(404);
  if(u.avatar && u.avatar.startsWith('/uploads/')) fs.rmSync(path.join(UPLOAD_DIR,path.basename(u.avatar)),{force:true});
  u.avatar='/uploads/'+req.file.filename; save(d); res.json({user:safeUser(u)});
});

app.get('/api/shorts',optional,async(req,res)=>{
  try{
    const d=load();
    const page=Math.max(1,Number(req.query.page||1));
    const limit=Math.min(24,Math.max(1,Number(req.query.limit||12)));
    const category=clean(req.query.category,40).toUpperCase()||'ALL';
    const seeded=d.videos.filter(v=>v.isShort && (category==='ALL'||v.category===category)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const localUrls=new Set(seeded.map(v=>v.url).filter(Boolean));
    const remote=await shortsRemote.getPage({page,limit,category});
    const mappedRemote=remote.items.filter(x=>!localUrls.has(x.remoteUrl||x.url)).map(x=>({
      id:x.id,title:x.title,description:x.description,category:x.category,tags:x.tags,duration:x.duration,
      url:x.remoteUrl,remoteUrl:x.remoteUrl,remoteTitle:x.title,audio:true,mediaSource:x.mediaSource,
      license:x.license,sourcePage:x.sourcePage,sourceCreator:x.sourceCreator,createdAt:x.createdAt,
      views:0,likes:0,creator:'ZenithMax Remote Creator',creatorId:d.users.find(u=>u.id==='creator-zenith')?.id||d.users[0]?.id,
      verified:false,avatar:'',isShort:true,starter:true,shortCategory:x.category,streamUrl:`/api/short-video-remote?key=${encodeURIComponent(x.remoteKey||Buffer.from(x.remoteUrl).toString('base64url'))}`
    }));
    let items;
    if(page===1){
      const seedLimit=Math.min(seeded.length,limit);
      items=[...seeded.slice(0,seedLimit).map(v=>pub(d,v,req)),...mappedRemote.slice(0,Math.max(0,limit-seedLimit))];
    } else items=mappedRemote;
    const categories=[...new Set([...d.videos.filter(v=>v.isShort).map(v=>v.category),...shortsRemote.TOPIC_SEEDS.map(x=>x[0])])].sort();
    const remoteStats=shortsRemote.stats();
    res.json({videos:items,page,limit,hasMore:remote.hasMore||page*limit<shortsRemote.SHORTS_CAPACITY,categories,catalogCapacity:shortsRemote.SHORTS_CAPACITY,discoveredRemoteShorts:remoteStats.total,remoteCategories:remoteStats.categories});
  }catch(e){res.status(503).json({error:'Shorts discovery is temporarily unavailable. Please try again.'});}
});

app.get('/api/shorts/catalog-stats',auth,(req,res)=>{
  const d=load(),u=d.users.find(x=>x.id===req.user.id);
  if(u?.role!=='admin')return res.status(403).json({error:'Admin access required'});
  res.json(shortsRemote.stats());
});

app.post('/api/shorts/admin/grow',auth,async(req,res)=>{
  try{
    const d=load(),u=d.users.find(x=>x.id===req.user.id);
    if(u?.role!=='admin')return res.status(403).json({error:'Admin access required'});
    const count=Math.min(500,Math.max(1,Number(req.body.count||100)));
    const category=clean(req.body.category,40).toUpperCase()||'ALL';
    const result=await shortsRemote.grow({count,category,maxRequests:160});
    res.json({ok:true,result});
  }catch(e){res.status(502).json({error:'Could not grow the Shorts catalog right now'});}
});

app.get('/api/short-video-remote',async(req,res)=>{
  try{
    const remote=shortsRemote.decodeRemoteKey(req.query.key||'');
    if(!shortsRemote.isAllowedRemoteUrl(remote))return res.status(400).json({error:'Unsupported remote video source'});
    const headers={'User-Agent':'ZenithMax/20 Shorts media proxy'};
    if(req.headers.range)headers.Range=req.headers.range;
    let upstream=await fetch(remote,{headers,redirect:'follow',signal:AbortSignal.timeout(20000)});
    if(!upstream.ok && upstream.status!==206)return res.status(upstream.status).json({error:'Remote Short source returned '+upstream.status});
    res.status(upstream.status);
    const ct=upstream.headers.get('content-type');if(ct)res.setHeader('Content-Type',ct);
    for(const h of ['content-length','content-range','accept-ranges','etag','last-modified']){const value=upstream.headers.get(h);if(value)res.setHeader(h,value)}
    if(upstream.body){require('stream').Readable.fromWeb(upstream.body).pipe(res);}else res.end();
  }catch(e){res.status(502).json({error:'Short video source could not be reached right now'});}
});
app.get('/api/short-video/:id',async(req,res)=>{
  try{
    const d=load(),v=d.videos.find(x=>x.id===req.params.id&&x.isShort);
    if(!v)return res.sendStatus(404);
    const headers={'User-Agent':'ZenithMax/20 Shorts media proxy'};
    if(req.headers.range)headers.Range=req.headers.range;
    const remote=v.url;
    let upstream=await fetch(remote,{headers,redirect:'follow',signal:AbortSignal.timeout(20000)});
    if(!upstream.ok && upstream.status!==206)return res.status(upstream.status).json({error:'Remote Short source returned '+upstream.status});
    res.status(upstream.status);
    const ct=upstream.headers.get('content-type');if(ct)res.setHeader('Content-Type',ct);
    for(const h of ['content-length','content-range','accept-ranges','etag','last-modified']){const value=upstream.headers.get(h);if(value)res.setHeader(h,value)}
    if(upstream.body){require('stream').Readable.fromWeb(upstream.body).pipe(res);}else res.end();
  }catch(e){res.status(502).json({error:'Short video source could not be reached right now'});}
});
app.get('/api/videos',optional,(req,res)=>{
  const d=load(),q=clean(req.query.q,120).toLowerCase(),cat=clean(req.query.category,50),sort=req.query.sort||'latest',page=Math.max(1,Number(req.query.page||1)),limit=Math.min(40,Math.max(1,Number(req.query.limit||18)));
  let vs=d.videos.filter(v=>v.status!=='removed'&&(!cat||cat==='ALL'||v.category===cat)&&(!q||v.title.toLowerCase().includes(q)||(v.description||'').toLowerCase().includes(q)||(v.tags||[]).join(' ').toLowerCase().includes(q)));
  if(sort==='trending'||sort==='recommended')vs.sort((a,b)=>score(d,b,req)-score(d,a,req)); else vs.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const total=vs.length; vs=vs.slice((page-1)*limit,page*limit).map(v=>({...pub(d,v,req),reason:reasons(d,v,req)[0]}));
  res.json({videos:vs,page,limit,total,hasMore:page*limit<total});
});
app.get('/api/search/suggestions',(req,res)=>{
  const d=load(),q=clean(req.query.q,80).toLowerCase(); if(!q)return res.json({suggestions:[]});
  const suggestions=[...new Set(d.videos.flatMap(v=>[v.title,...(v.tags||[])]).filter(x=>String(x).toLowerCase().includes(q)))].slice(0,8);
  res.json({suggestions});
});
app.get('/api/discover',optional,(req,res)=>{
  const d=load(); const videos=d.videos.filter(v=>v.status!=='removed').map(v=>({...pub(d,v,req),score:score(d,v,req),reasons:reasons(d,v,req)})).sort((a,b)=>b.score-a.score).slice(0,120);
  const categories=[...new Set(d.videos.map(v=>v.category))].sort();
  res.json({videos,categories});
});
app.get('/api/trending',optional,(req,res)=>{
  const d=load(); const videos=[...d.videos].filter(v=>v.status!=='removed').sort((a,b)=>(b.views||0)+(b.likes||0)*18-((a.views||0)+(a.likes||0)*18)).slice(0,40).map(v=>pub(d,v,req));
  res.json({videos});
});
app.get('/api/recommendations',optional,(req,res)=>{
  const d=load(),source=d.videos.find(v=>v.id===clean(req.query.videoId,100));
  const videos=d.videos.filter(v=>v.status!=='removed'&&v.id!==source?.id).map(v=>({...pub(d,v,req),score:score(d,v,req,source),reasons:reasons(d,v,req)})).sort((a,b)=>b.score-a.score).slice(0,80);
  res.json({videos});
});
app.get('/api/creators',optional,(req,res)=>{
  const d=load(); const creators=d.users.filter(u=>u.role==='creator'||u.starter||d.videos.some(v=>v.userId===u.id)).map(u=>({id:u.id,name:u.name,bio:u.bio,followers:u.followers,videoCount:d.videos.filter(v=>v.userId===u.id&&v.status!=='removed').length,verified:!!u.verified,following:!!req.user&&d.follows.some(f=>f.userId===req.user.id&&f.targetId===u.id)})).sort((a,b)=>b.followers-a.followers);
  res.json({creators});
});
app.get('/api/users/:id',optional,(req,res)=>{
  const d=load(),u=d.users.find(x=>x.id===req.params.id);if(!u)return res.sendStatus(404);
  res.json({user:safeUser(u),videos:d.videos.filter(v=>v.userId===u.id&&v.status!=='removed').map(v=>pub(d,v,req)),following:!!req.user&&d.follows.some(f=>f.userId===req.user.id&&f.targetId===u.id)});
});

function resumablePath(id){return path.join(RESUMABLE_DIR,id)}
function readResume(id){const p=resumablePath(id)+'.json';if(!fs.existsSync(p))return null;return JSON.parse(fs.readFileSync(p,'utf8'))}
function writeResume(s){s.updatedAt=now();fs.writeFileSync(resumablePath(s.id)+'.json',JSON.stringify(s,null,2))}
function resumeLimit(type){return type==='video'?500*1024*1024:type==='music'?250*1024*1024:200*1024*1024}
app.post('/api/resumable/start',auth,(req,res)=>{
  const type=String(req.body.type||''); if(!['video','music','game'].includes(type))return res.status(400).json({error:'Unsupported upload type'});
  const name=clean(req.body.name,180),size=Number(req.body.size||0),mime=clean(req.body.mime,120),meta=req.body.meta||{};
  if(!name||!Number.isFinite(size)||size<1||size>resumeLimit(type))return res.status(400).json({error:`File is missing or larger than the ${Math.round(resumeLimit(type)/1024/1024)} MB limit`});
  const id=uid(); const s={id,userId:req.user.id,type,name,size,mime,meta,chunkSize:RESUMABLE_CHUNK,totalChunks:Math.ceil(size/RESUMABLE_CHUNK),nextChunk:0,receivedBytes:0,tempPath:resumablePath(id)+'.part',createdAt:now(),updatedAt:now()};
  fs.writeFileSync(s.tempPath,''); writeResume(s); res.json({uploadId:id,chunkSize:s.chunkSize,totalChunks:s.totalChunks,nextChunk:0});
});
app.get('/api/resumable/:id/status',auth,(req,res)=>{const s=readResume(req.params.id);if(!s||s.userId!==req.user.id)return res.sendStatus(404);res.json({uploadId:s.id,chunkSize:s.chunkSize,totalChunks:s.totalChunks,nextChunk:s.nextChunk,receivedBytes:s.receivedBytes,size:s.size,type:s.type,name:s.name})});
app.put('/api/resumable/:id/chunks/:chunk',auth,express.raw({type:'application/octet-stream',limit:'5mb'}),(req,res)=>{
  const s=readResume(req.params.id); if(!s||s.userId!==req.user.id)return res.sendStatus(404); const n=Number(req.params.chunk); if(!Number.isInteger(n)||n<0||n>=s.totalChunks)return res.status(400).json({error:'Invalid chunk'});
  if(n<s.nextChunk)return res.json({ok:true,nextChunk:s.nextChunk,receivedBytes:s.receivedBytes});
  if(n!==s.nextChunk)return res.status(409).json({error:'Chunk out of order',nextChunk:s.nextChunk});
  const buf=Buffer.isBuffer(req.body)?req.body:Buffer.from([]); const expected=Math.min(s.chunkSize,s.size-n*s.chunkSize); if(buf.length!==expected)return res.status(400).json({error:`Expected ${expected} bytes for chunk ${n}, received ${buf.length}`});
  fs.appendFileSync(s.tempPath,buf); s.receivedBytes+=buf.length; s.nextChunk++; writeResume(s); res.json({ok:true,nextChunk:s.nextChunk,receivedBytes:s.receivedBytes});
});
app.post('/api/resumable/:id/complete',auth,(req,res)=>{
  const s=readResume(req.params.id); if(!s||s.userId!==req.user.id)return res.sendStatus(404); if(s.receivedBytes!==s.size||s.nextChunk!==s.totalChunks)return res.status(409).json({error:'Upload is incomplete',nextChunk:s.nextChunk,receivedBytes:s.receivedBytes});
  try{
    const ext=path.extname(s.name).toLowerCase()||({video:'.mp4',music:'.mp3',game:'.zip'}[s.type]); const finalName=uid()+ext; const finalPath=path.join(UPLOAD_DIR,finalName); fs.renameSync(s.tempPath,finalPath); let out;
    const d=load();
    if(s.type==='video'){
      const m=s.meta||{}; out={id:uid(),userId:req.user.id,title:clean(m.title,120)||path.parse(s.name).name.slice(0,120),description:clean(m.description,2000),category:clean(m.category,40).toUpperCase()||'GENERAL',tags:clean(m.tags,240).split(',').map(x=>x.trim()).filter(Boolean).slice(0,8),url:'/uploads/'+finalName,likes:0,views:0,createdAt:now(),status:'published'}; d.videos.push(out);
    } else if(s.type==='music'){
      const m=s.meta||{}; out={id:uid(),userId:req.user.id,title:clean(m.title,120)||path.parse(s.name).name.slice(0,120),artist:clean(m.artist,80)||req.user.name,album:clean(m.album,120),genre:clean(m.genre,60)||'GENERAL',description:clean(m.description,1000),url:'/uploads/'+finalName,mime:s.mime,fileName:s.name.slice(0,160),likes:0,plays:0,createdAt:now(),status:'published'}; d.music.push(out);
    } else {
      const gameId=uid(); const info=extractGameZip(finalPath,gameId); fs.rmSync(finalPath,{force:true}); const m=s.meta||{}; out={id:gameId,userId:req.user.id,title:clean(m.title,120)||path.parse(s.name).name.slice(0,120),description:clean(m.description,1200),genre:clean(m.genre,60)||'ARCADE',version:clean(m.version,30)||'1.0.0',url:'/game-assets/'+gameId+'/index.html',playUrl:'/api/games/'+gameId+'/play',files:info.files,bytes:info.total,plays:0,createdAt:now(),status:'published'}; d.games.push(out);
    }
    save(d); fs.rmSync(resumablePath(s.id)+'.json',{force:true}); fs.rmSync(s.tempPath,{force:true}); res.json({ok:true,type:s.type,video:s.type==='video'?out:undefined,music:s.type==='music'?out:undefined,game:s.type==='game'?out:undefined});
  }catch(e){return res.status(400).json({error:e.message||'Could not finalize upload'});}
});

app.get('/api/music',(req,res)=>{
  const d=load();
  const tracks=d.music.filter(m=>m.status!=='removed').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,200).map(m=>({...m,artist:d.users.find(u=>u.id===m.userId)?.name||'ZenithMax Creator'}));
  res.json({music:tracks});
});
app.post('/api/music',auth,musicUpload.single('audio'),(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Choose an MP3, M4A, WAV, OGG, WEBM, AAC or FLAC audio file'});
  const d=load();
  const track={id:uid(),userId:req.user.id,title:clean(req.body.title,120)||path.parse(req.file.originalname).name.slice(0,120),artist:clean(req.body.artist,80)||req.user.name,album:clean(req.body.album,120),genre:clean(req.body.genre,60)||'GENERAL',description:clean(req.body.description,1000),url:'/uploads/'+req.file.filename,mime:req.file.mimetype,fileName:req.file.originalname.slice(0,160),likes:0,plays:0,createdAt:now(),status:'published'};
  d.music.push(track); save(d); res.json({music:track});
});
app.post('/api/music/:id/play',optional,(req,res)=>{
  const d=load(),m=d.music.find(x=>x.id===req.params.id); if(!m) return res.sendStatus(404); m.plays=(m.plays||0)+1; save(d); res.json({ok:true,plays:m.plays});
});
app.get('/api/games',(req,res)=>{
  const d=load();
  const games=d.games.filter(g=>g.status!=='removed').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,200).map(g=>({...g,creator:d.users.find(u=>u.id===g.userId)?.name||'ZenithMax Creator'}));
  res.json({games});
});
app.post('/api/games',auth,gameUpload.single('game'),(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Choose an HTML5 game ZIP package'});
  const gameId=uid();
  try{
    const info=extractGameZip(path.join(UPLOAD_DIR,req.file.filename),gameId);
    const d=load();
    const game={id:gameId,userId:req.user.id,title:clean(req.body.title,120)||path.parse(req.file.originalname).name.slice(0,120),description:clean(req.body.description,1200),genre:clean(req.body.genre,60)||'ARCADE',version:clean(req.body.version,30)||'1.0.0',url:'/game-assets/'+gameId+'/index.html',playUrl:'/api/games/'+gameId+'/play',files:info.files,bytes:info.total,plays:0,createdAt:now(),status:'published'};
    d.games.push(game); save(d); fs.rmSync(path.join(UPLOAD_DIR,req.file.filename),{force:true}); res.json({game});
  }catch(e){ fs.rmSync(path.join(GAME_DIR,gameId),{recursive:true,force:true}); fs.rmSync(path.join(UPLOAD_DIR,req.file.filename),{force:true}); return res.status(400).json({error:e.message||'Invalid game package'}); }
});
app.get('/api/games/:id/play',(req,res)=>{
  const d=load(),g=d.games.find(x=>x.id===req.params.id); if(!g) return res.sendStatus(404); g.plays=(g.plays||0)+1; save(d); res.redirect(g.url);
});

app.post('/api/videos',auth,upload.single('video'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose an MP4/WebM/MOV video'});
  const d=load();const v={id:uid(),userId:req.user.id,title:clean(req.body.title,120)||'Untitled video',description:clean(req.body.description,2000),category:clean(req.body.category,40).toUpperCase()||'GENERAL',tags:clean(req.body.tags,240).split(',').map(x=>x.trim()).filter(Boolean).slice(0,8),url:'/uploads/'+req.file.filename,likes:0,views:0,createdAt:now(),status:'published'};
  d.videos.push(v); save(d); res.json({video:v});
});
app.post('/api/videos/:id/view',optional,(req,res)=>{
  const d=load(),v=d.videos.find(x=>x.id===req.params.id);if(!v)return res.sendStatus(404);v.views=(v.views||0)+1;
  if(req.user){let h=d.history.find(x=>x.userId===req.user.id&&x.videoId===v.id);if(h)h.watchedAt=now();else d.history.push({id:uid(),userId:req.user.id,videoId:v.id,watchedAt:now(),progress:0});}
  save(d);res.json({ok:true,views:v.views});
});
app.post('/api/videos/:id/progress',auth,(req,res)=>{
  const d=load();let h=d.history.find(x=>x.userId===req.user.id&&x.videoId===req.params.id);const progress=Math.max(0,Math.min(100,Number(req.body.progress||0)));
  if(h){h.progress=progress;h.watchedAt=now();}else d.history.push({id:uid(),userId:req.user.id,videoId:req.params.id,watchedAt:now(),progress});save(d);res.json({ok:true});
});
app.get('/api/history',auth,(req,res)=>{
  const d=load();res.json({videos:d.history.filter(h=>h.userId===req.user.id).sort((a,b)=>new Date(b.watchedAt)-new Date(a.watchedAt)).map(h=>{const v=d.videos.find(x=>x.id===h.videoId);return v?{...pub(d,v,req),progress:h.progress,watchedAt:h.watchedAt}:null}).filter(Boolean).slice(0,100)});
});
app.post('/api/videos/:id/like',auth,(req,res)=>{
  const d=load(),v=d.videos.find(x=>x.id===req.params.id);if(!v)return res.sendStatus(404);const i=d.likes.findIndex(x=>x.videoId===v.id&&x.userId===req.user.id);
  if(i>=0){d.likes.splice(i,1);v.likes=Math.max(0,(v.likes||0)-1);}else{d.likes.push({videoId:v.id,userId:req.user.id,createdAt:now()});v.likes=(v.likes||0)+1;notify(d,v.userId,'like',`${req.user.name} liked your video`,v.id,req.user.id);}
  save(d);res.json({liked:i<0,likes:v.likes});
});
app.post('/api/videos/:id/bookmark',auth,(req,res)=>{const d=load(),i=d.bookmarks.findIndex(b=>b.userId===req.user.id&&b.videoId===req.params.id);if(i>=0)d.bookmarks.splice(i,1);else d.bookmarks.push({userId:req.user.id,videoId:req.params.id,createdAt:now()});save(d);res.json({saved:i<0});});
app.get('/api/bookmarks',auth,(req,res)=>{const d=load();res.json({videos:d.videos.filter(v=>d.bookmarks.some(b=>b.userId===req.user.id&&b.videoId===v.id)).map(v=>pub(d,v,req))});});

app.get('/api/videos/:id/comments',(req,res)=>{
  const d=load();const comments=d.comments.filter(c=>c.videoId===req.params.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map(c=>({...c,user:d.users.find(u=>u.id===c.userId)?.name||'User',verified:!!d.users.find(u=>u.id===c.userId)?.verified}));res.json({comments});
});
app.post('/api/videos/:id/comments',auth,(req,res)=>{
  const d=load(),text=clean(req.body.text,500),v=d.videos.find(x=>x.id===req.params.id);if(!text)return res.status(400).json({error:'Comment must be 1–500 characters'});if(!v)return res.sendStatus(404);
  const c={id:uid(),videoId:req.params.id,userId:req.user.id,text,createdAt:now()};d.comments.push(c);notify(d,v.userId,'comment',`${req.user.name} commented on your video`,v.id,req.user.id);save(d);res.json({comment:c});
});
app.delete('/api/comments/:id',auth,(req,res)=>{const d=load(),i=d.comments.findIndex(c=>c.id===req.params.id&&(c.userId===req.user.id||d.users.find(u=>u.id===req.user.id)?.role==='admin'));if(i<0)return res.sendStatus(404);d.comments.splice(i,1);save(d);res.json({ok:true});});

app.post('/api/users/:id/follow',auth,(req,res)=>{
  const d=load();if(req.params.id===req.user.id)return res.status(400).json({error:'You cannot follow yourself'});const i=d.follows.findIndex(f=>f.userId===req.user.id&&f.targetId===req.params.id);
  if(i>=0)d.follows.splice(i,1);else{d.follows.push({userId:req.user.id,targetId:req.params.id,createdAt:now()});notify(d,req.params.id,'follow',`${req.user.name} followed you`,'',req.user.id);}
  for(const u of d.users){u.followers=d.follows.filter(f=>f.targetId===u.id).length;u.following=d.follows.filter(f=>f.userId===u.id).length;}save(d);res.json({following:i<0});
});
app.get('/api/following',auth,optional,(req,res)=>{const d=load(),ids=d.follows.filter(f=>f.userId===req.user.id).map(f=>f.targetId);res.json({videos:d.videos.filter(v=>ids.includes(v.userId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(v=>pub(d,v,req))});});

app.post('/api/playlists',auth,(req,res)=>{const d=load(),name=clean(req.body.name,80);if(!name)return res.status(400).json({error:'Playlist name required'});const p={id:uid(),userId:req.user.id,name,description:clean(req.body.description,200),videoIds:[],createdAt:now()};d.playlists.push(p);save(d);res.json({playlist:p});});
app.get('/api/playlists',auth,(req,res)=>{const d=load();res.json({playlists:d.playlists.filter(p=>p.userId===req.user.id).map(p=>({...p,count:p.videoIds.length,cover:d.videos.find(v=>v.id===p.videoIds[0])?.url||''}))});});
app.get('/api/playlists/:id',auth,(req,res)=>{const d=load(),p=d.playlists.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.sendStatus(404);res.json({playlist:p,videos:p.videoIds.map(id=>d.videos.find(v=>v.id===id)).filter(Boolean).map(v=>pub(d,v,req))});});
app.post('/api/playlists/:id/videos/:videoId',auth,(req,res)=>{const d=load(),p=d.playlists.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.sendStatus(404);const i=p.videoIds.indexOf(req.params.videoId);if(i>=0)p.videoIds.splice(i,1);else p.videoIds.push(req.params.videoId);save(d);res.json({playlist:p,added:i<0});});
app.delete('/api/playlists/:id',auth,(req,res)=>{const d=load(),i=d.playlists.findIndex(p=>p.id===req.params.id&&p.userId===req.user.id);if(i<0)return res.sendStatus(404);d.playlists.splice(i,1);save(d);res.json({ok:true});});

app.get('/api/notifications',auth,(req,res)=>{const d=load();res.json({notifications:d.notifications.filter(n=>n.userId===req.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,100)});});
app.post('/api/notifications/read',auth,(req,res)=>{const d=load();for(const n of d.notifications)if(n.userId===req.user.id)n.read=true;save(d);res.json({ok:true});});
app.get('/api/messages/conversations',auth,(req,res)=>{
  const d=load(),msgs=d.messages.filter(m=>m.fromId===req.user.id||m.toId===req.user.id);const map=new Map();
  for(const m of msgs.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))){const other=m.fromId===req.user.id?m.toId:m.fromId;if(!map.has(other))map.set(other,{user:safeUser(d.users.find(u=>u.id===other)),last:m});}
  res.json({conversations:[...map.values()].filter(x=>x.user)});
});
app.get('/api/messages/:userId',auth,(req,res)=>{const d=load();res.json({messages:d.messages.filter(m=>(m.fromId===req.user.id&&m.toId===req.params.userId)||(m.fromId===req.params.userId&&m.toId===req.user.id)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)),user:safeUser(d.users.find(u=>u.id===req.params.userId))});});
app.post('/api/messages/:userId',auth,(req,res)=>{const d=load(),text=clean(req.body.text,1000);if(!text)return res.status(400).json({error:'Message cannot be empty'});if(!d.users.some(u=>u.id===req.params.userId))return res.sendStatus(404);const m={id:uid(),fromId:req.user.id,toId:req.params.userId,text,kind:'text',createdAt:now()};d.messages.push(m);notify(d,req.params.userId,'message',`${req.user.name} sent you a message`,'messages',req.user.id);save(d);res.json({message:m});});
app.post('/api/messages/:userId/media',auth,mediaUpload.single('media'),(req,res)=>{const d=load(),target=d.users.find(u=>u.id===req.params.userId);if(!target)return res.sendStatus(404);if(!req.file)return res.status(400).json({error:'Choose an image, video, or audio file'});const m={id:uid(),fromId:req.user.id,toId:target.id,text:clean(req.body.caption,300),kind:'media',mediaType:mediaType(req.file.mimetype),mime:req.file.mimetype,fileName:req.file.originalname.slice(0,160),url:'/uploads/'+req.file.filename,createdAt:now()};d.messages.push(m);notify(d,target.id,'message',`${req.user.name} sent you ${m.mediaType==='audio'?'music/audio':m.mediaType}`,'messages',req.user.id);save(d);res.json({message:m});});

app.post('/api/videos/:id/report',auth,(req,res)=>{const d=load();if(d.reports.some(r=>r.videoId===req.params.id&&r.userId===req.user.id))return res.status(409).json({error:'You already reported this video'});d.reports.push({id:uid(),videoId:req.params.id,userId:req.user.id,reason:clean(req.body.reason,200)||'Other',status:'open',createdAt:now()});save(d);res.json({ok:true});});
app.get('/api/admin/overview',auth,(req,res)=>{const d=load(),u=d.users.find(x=>x.id===req.user.id);if(u?.role!=='admin')return res.status(403).json({error:'Admin only'});res.json({users:d.users.filter(x=>!x.starter).length,videos:d.videos.length,reports:d.reports.filter(r=>r.status==='open').length,comments:d.comments.length,recentReports:d.reports.slice(-30).reverse().map(r=>({...r,title:d.videos.find(v=>v.id===r.videoId)?.title||'Unknown'}))});});
app.post('/api/admin/reports/:id/resolve',auth,(req,res)=>{const d=load(),u=d.users.find(x=>x.id===req.user.id);if(u?.role!=='admin')return res.status(403).json({error:'Admin only'});const r=d.reports.find(x=>x.id===req.params.id);if(!r)return res.sendStatus(404);r.status='resolved';r.resolvedAt=now();save(d);res.json({ok:true});});

app.post('/api/creator/apply',auth,(req,res)=>{const d=load(),u=d.users.find(x=>x.id===req.user.id);if(!u)return res.sendStatus(404);u.role='creator';u.creatorSince=u.creatorSince||now();u.bio=u.bio||'ZenithMax creator';notify(d,u.id,'creator','Welcome to Creator Mode! Start publishing original content.','studio');save(d);res.json({ok:true,user:safeUser(u)});});
app.get('/api/stats',auth,(req,res)=>{
  const d=load(),vs=d.videos.filter(v=>v.userId===req.user.id),totalViews=vs.reduce((n,v)=>n+(v.views||0),0),totalLikes=vs.reduce((n,v)=>n+(v.likes||0),0);
  const top=[...vs].sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,5).map(v=>({id:v.id,title:v.title,views:v.views,likes:v.likes}));
  const cats={};for(const v of vs)cats[v.category]=(cats[v.category]||0)+v.views;
  res.json({videos:vs.length,views:totalViews,likes:totalLikes,followers:d.users.find(u=>u.id===req.user.id)?.followers||0,comments:d.comments.filter(c=>vs.some(v=>v.id===c.videoId)).length,topVideos:top,categories:cats});
});
app.get('/api/live/status',(req,res)=>res.json({enabled:false,version:'14',message:'Live architecture placeholder is ready for a future WebRTC/RTMP service.'}));

// V14 monetization architecture. This is a safe demo ledger: it does NOT process real money.
function monetizationSummary(d,userId){
  const rows=d.earnings.filter(e=>e.creatorId===userId);
  const tips=rows.filter(e=>e.type==='tip').reduce((n,e)=>n+e.amount,0);
  const subs=rows.filter(e=>e.type==='subscription').reduce((n,e)=>n+e.amount,0);
  const ads=rows.filter(e=>e.type==='ad').reduce((n,e)=>n+e.amount,0);
  const sponsorships=rows.filter(e=>e.type==='sponsorship').reduce((n,e)=>n+e.amount,0);
  return {tips,subscriptions:subs,ads,sponsorships,total:tips+subs+ads+sponsorships};
}
app.get('/api/monetization/dashboard',auth,(req,res)=>{
  const d=load(), u=d.users.find(x=>x.id===req.user.id); if(!u)return res.sendStatus(404);
  const summary=monetizationSummary(d,u.id);
  const creatorSubs=d.creatorSubscriptions.filter(x=>x.creatorId===u.id&&x.status==='active').length;
  const campaigns=d.adCampaigns.filter(x=>x.creatorId===u.id);
  res.json({mode:'demo',summary,creatorSubscribers:creatorSubs,campaigns,history:d.earnings.filter(e=>e.creatorId===u.id).slice(-50).reverse(),eligible:(u.followers||0)>=100});
});
app.post('/api/monetization/tip',auth,(req,res)=>{
  const d=load(), creator=d.users.find(x=>x.id===clean(req.body.creatorId,100));
  const amount=Math.min(100,Math.max(1,Number(req.body.amount||1)));
  if(!creator)return res.sendStatus(404); if(creator.id===req.user.id)return res.status(400).json({error:'You cannot tip yourself'});
  // Demo credits only; no card/payment is touched.
  const platform=Math.round(amount*0.10*100)/100, net=Math.round((amount-platform)*100)/100;
  d.tips.push({id:uid(),fromId:req.user.id,creatorId:creator.id,amount,platformFee:platform,net,createdAt:now(),mode:'demo'});
  d.earnings.push({id:uid(),creatorId:creator.id,sourceUserId:req.user.id,type:'tip',amount:net,gross:amount,createdAt:now(),mode:'demo'});
  notify(d,creator.id,'tip',`${req.user.name} sent you a demo tip of ${amount} credits`,'monetization',req.user.id); save(d);
  res.json({ok:true,mode:'demo',gross:amount,platformFee:platform,creatorEarned:net});
});
app.post('/api/monetization/subscribe',auth,(req,res)=>{
  const d=load(), creator=d.users.find(x=>x.id===clean(req.body.creatorId,100)); if(!creator)return res.sendStatus(404);
  if(creator.id===req.user.id)return res.status(400).json({error:'You cannot subscribe to yourself'});
  const existing=d.creatorSubscriptions.find(x=>x.creatorId===creator.id&&x.userId===req.user.id);
  if(existing){existing.status=existing.status==='active'?'cancelled':'active'; existing.updatedAt=now(); save(d); return res.json({active:existing.status==='active',mode:'demo'});}
  const price=5, fee=.5, sub={id:uid(),creatorId:creator.id,userId:req.user.id,price,platformFee:fee,status:'active',createdAt:now()};
  d.creatorSubscriptions.push(sub); d.earnings.push({id:uid(),creatorId:creator.id,sourceUserId:req.user.id,type:'subscription',amount:price-fee,gross:price,createdAt:now(),mode:'demo'});
  creator.followers=(creator.followers||0)+1; notify(d,creator.id,'subscription',`${req.user.name} subscribed to your creator channel`,'monetization',req.user.id); save(d);
  res.json({active:true,mode:'demo',price});
});
app.post('/api/monetization/campaigns',auth,(req,res)=>{
  const d=load(), title=clean(req.body.title,100), budget=Math.min(10000,Math.max(10,Number(req.body.budget||10)));
  if(!title)return res.status(400).json({error:'Campaign title required'});
  const c={id:uid(),creatorId:req.user.id,title,budget,status:'draft',createdAt:now(),impressions:0,clicks:0}; d.adCampaigns.push(c); save(d); res.json({campaign:c,mode:'demo'});
});
app.post('/api/monetization/campaigns/:id/activate',auth,(req,res)=>{
  const d=load(),c=d.adCampaigns.find(x=>x.id===req.params.id&&x.creatorId===req.user.id); if(!c)return res.sendStatus(404); c.status=c.status==='active'?'paused':'active'; save(d); res.json({campaign:c,mode:'demo'});
});
app.post('/api/monetization/ads/impression',optional,(req,res)=>{
  const d=load(), id=clean(req.body.campaignId,100), c=d.adCampaigns.find(x=>x.id===id&&x.status==='active');
  if(!c)return res.status(404).json({error:'Campaign not active'});
  c.impressions=(c.impressions||0)+1; if(c.impressions%100===0){const amount=.20; d.earnings.push({id:uid(),creatorId:c.creatorId,type:'ad',amount,gross:amount,createdAt:now(),mode:'demo'});} save(d); res.json({ok:true});
});
app.get('/api/monetization/eligibility',auth,(req,res)=>{const d=load(),u=d.users.find(x=>x.id===req.user.id);res.json({followers:u?.followers||0,verified:!!u?.verified,eligible:(u?.followers||0)>=100,requirements:['Build a real audience','Publish original or licensed content','Follow applicable platform/payment rules','Complete adult-assisted business/payment setup when required'],mode:'demo'});});

app.use((req,res)=>res.sendFile(path.join(ROOT,'client/index.html')));

// Start listening immediately so Render health checks are not blocked by remote media APIs.
app.listen(PORT,'0.0.0.0',()=>console.log(`ZenithMax V20 running on port ${PORT}`));

// Remote catalog hydration is best-effort and happens after the service is live.
(async()=>{
  try {
    const media=await resolveRemoteCatalog();
    shortsRemote.markSeen(load().videos.filter(v=>v.isShort&&v.starter).map(v=>({...v,remoteUrl:v.url})));
    console.log(`Remote starter media: ${media.unique} unique, ${media.unresolved} unresolved`);
    console.log(`Remote Shorts catalog: ${shortsRemote.stats().total} unique entries indexed`);
  } catch (err) {
    console.warn('Remote catalog hydration skipped:', err?.message || err);
  }
})();
