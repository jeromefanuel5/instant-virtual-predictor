
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB = path.join(DATA_DIR, "db.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({
  settings:{siteName:"Instant Virtual Predictor",priceTsh:20000,subscriptionDays:30,paymentInstructions:"Weka namba ya malipo ya admin kwenye Settings."},
  users:[],
  payments:[],
  predictions:[],
  games:[]
}, null, 2));

function readDB(){return JSON.parse(fs.readFileSync(DB,"utf8"))}
function writeDB(x){fs.writeFileSync(DB,JSON.stringify(x,null,2))}
function id(){return crypto.randomBytes(10).toString("hex")}
function hash(p,s=crypto.randomBytes(16).toString("hex")){return s+":"+crypto.pbkdf2Sync(p,s,120000,32,"sha256").toString("hex")}
function verify(p,h){const [s,v]=h.split(":");return crypto.timingSafeEqual(Buffer.from(v,"hex"),crypto.pbkdf2Sync(p,s,120000,32,"sha256"))}
function parseCookies(req){return Object.fromEntries((req.headers.cookie||"").split(";").filter(Boolean).map(x=>{let [k,...v]=x.trim().split("=");return [k,v.join("=")]}))}
function json(res,status,obj){res.writeHead(status,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let d="";req.on("data",c=>{d+=c;if(d.length>1e6)req.destroy()});req.on("end",()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}})})}
function sessionUser(req,db){const c=parseCookies(req); if(!c.sid)return null; return db.users.find(u=>u.session===c.sid)||null}
function cleanUser(u){if(!u)return null; const {passwordHash,session,...x}=u;return x}
function sendFile(res,file,type){fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":type});res.end(d)})}

const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"};

const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204);return res.end()}
  const u=url.parse(req.url,true), p=u.pathname, db=readDB(), me=sessionUser(req,db);

  try{
    if(req.method==="POST" && p==="/api/register"){
      const b=await body(req); if(!b.email||!b.password) return json(res,400,{error:"Email and password required"});
      if(db.users.some(x=>x.email.toLowerCase()===b.email.toLowerCase())) return json(res,409,{error:"Email already registered"});
      const user={id:id(),name:b.name||"User",email:b.email.toLowerCase(),passwordHash:hash(b.password),role:"user",active:false,expiresAt:null,createdAt:new Date().toISOString(),session:null};
      db.users.push(user); writeDB(db); return json(res,200,{ok:true,message:"Account created. Pay TSh 20,000 and submit the transaction reference."});
    }
    if(req.method==="POST" && p==="/api/login"){
      const b=await body(req), user=db.users.find(x=>x.email.toLowerCase()===String(b.email||"").toLowerCase());
      if(!user||!verify(b.password,user.passwordHash)) return json(res,401,{error:"Invalid login"});
      user.session=id(); writeDB(db); res.setHeader("Set-Cookie",`sid=${user.session}; HttpOnly; SameSite=Lax; Path=/`); return json(res,200,{user:cleanUser(user)});
    }
    if(req.method==="POST" && p==="/api/logout"){if(me){me.session=null;writeDB(db)}res.setHeader("Set-Cookie","sid=; Max-Age=0; Path=/");return json(res,200,{ok:true})}
    if(p==="/api/me") return json(res,200,{user:cleanUser(me),settings:db.settings});

    if(req.method==="POST" && p==="/api/payment"){
      if(!me)return json(res,401,{error:"Login required"});
      const b=await body(req);
      if(!b.reference)return json(res,400,{error:"Transaction reference required"});
      db.payments.push({id:id(),userId:me.id,amount:db.settings.priceTsh,reference:b.reference.trim(),status:"pending",createdAt:new Date().toISOString()});
      writeDB(db); return json(res,200,{ok:true,message:"Payment submitted. Admin must verify it before access is activated."});
    }

    if(req.method==="POST" && p==="/api/upload-prediction"){
      if(!me||!me.active)return json(res,403,{error:"Active subscription required"});
      const b=await body(req);
      const game={id:id(),userId:me.id,teamA:b.teamA,teamB:b.teamB,market:b.market||"1X2",createdAt:new Date().toISOString(),source:"screenshot"};
      db.games.push(game);
      // Odds are deliberately ignored. Analysis uses only admin-entered team metrics.
      const a=Number(b.formA)||0,bv=Number(b.formB)||0,ga=Number(b.goalsA)||0,gb=Number(b.goalsB)||0;
      let prediction="Insufficient data", confidence=0;
      const score=(a-b)+(ga-gb)*0.5;
      if([a,bv,ga,gb].some(x=>x>0)){
        if(score>0.7){prediction="1";confidence=Math.min(92,60+Math.round(score*10))}
        else if(score<-0.7){prediction="2";confidence=Math.min(92,60+Math.round(-score*10))}
        else {prediction="X";confidence=58}
      }
      const pr={id:id(),gameId:game.id,userId:me.id,teamA:b.teamA,teamB:b.teamB,prediction,confidence,market:b.market||"1X2",status:"PENDING",actualResult:null,createdAt:new Date().toISOString(),analysis:{formA:a,formB:bv,goalsA:ga,goalsB:gb,oddsIgnored:true}};
      db.predictions.push(pr);writeDB(db);return json(res,200,{prediction:pr});
    }

    if(req.method==="GET" && p==="/api/history"){
      if(!me)return json(res,401,{error:"Login required"});
      return json(res,200,{predictions:db.predictions.filter(x=>x.userId===me.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
    }

    if(req.method==="POST" && p==="/api/admin/action"){
      if(!me||me.role!=="admin")return json(res,403,{error:"Admin only"});
      const b=await body(req);
      if(b.action==="verifyPayment"){
        const pay=db.payments.find(x=>x.id===b.id); if(!pay)return json(res,404,{error:"Payment not found"});
        pay.status="approved"; const usr=db.users.find(x=>x.id===pay.userId);
        if(usr){usr.active=true;usr.expiresAt=new Date(Date.now()+db.settings.subscriptionDays*86400000).toISOString()}
      } else if(b.action==="rejectPayment"){const pay=db.payments.find(x=>x.id===b.id);if(pay)pay.status="rejected"}
      else if(b.action==="result"){
        const pr=db.predictions.find(x=>x.id===b.id);if(!pr)return json(res,404,{error:"Prediction not found"});
        pr.actualResult=b.actualResult;pr.status=String(b.status||"PENDING").toUpperCase();
      } else if(b.action==="settings"){Object.assign(db.settings,b.settings||{})}
      writeDB(db);return json(res,200,{ok:true});
    }

    if(req.method==="GET" && p==="/api/admin"){
      if(!me||me.role!=="admin")return json(res,403,{error:"Admin only"});
      return json(res,200,{users:db.users.map(cleanUser),payments:db.payments,predictions:db.predictions,games:db.games,settings:db.settings});
    }

    if(p==="/") return sendFile(res,path.join(__dirname,"public/index.html"),MIME[".html"]);
    const fp=path.join(__dirname,"public",path.normalize(p.replace(/^\/+/,"")));
    if(fp.startsWith(path.join(__dirname,"public")) && fs.existsSync(fp))return sendFile(res,fp,MIME[path.extname(fp)]||"application/octet-stream");
    res.writeHead(404);res.end("Not found");
  }catch(e){console.error(e);json(res,500,{error:"Server error"})}
});

server.listen(PORT,()=>console.log(`Instant Virtual Predictor running on http://localhost:${PORT}`));
