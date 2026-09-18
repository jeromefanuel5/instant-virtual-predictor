const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");

const PORT=process.env.PORT||3000,
ROOT=__dirname,
PUB=path.join(ROOT,"public"),
DATA=path.join(ROOT,"data");

if(!fs.existsSync(DATA))fs.mkdirSync(DATA);

const DB=path.join(DATA,"db.json");

const initial={
settings:{
siteName:process.env.SITE_NAME||"Instant Virtual Predictor",
priceTsh:Number(process.env.PRICE_TSH||20000),
subscriptionDays:Number(process.env.SUBSCRIPTION_DAYS||30),
paymentMethod:process.env.PAYMENT_METHOD||"Mobile Money",
paymentNumber:process.env.PAYMENT_NUMBER||"",
paymentName:process.env.PAYMENT_NAME||"",
paymentInstructions:"Lipa TSh 20,000 kwenye namba iliyoonyeshwa, kisha weka transaction reference. Access itafunguliwa baada ya verification."
},
users:[],
payments:[],
predictions:[],
results:[],
history:[]
};

if(!fs.existsSync(DB))
fs.writeFileSync(DB,JSON.stringify(initial,null,2));

function db(){
return JSON.parse(fs.readFileSync(DB,"utf8"));
}

function save(x){
fs.writeFileSync(DB,JSON.stringify(x,null,2));
}

function rid(){
return crypto.randomBytes(12).toString("hex");
}

function pwHash(p,s=crypto.randomBytes(16).toString("hex")){
return s+":"+crypto.pbkdf2Sync(p,s,150000,32,"sha256").toString("hex");
}

function pwOK(p,h){
let [s,v]=h.split(":");
return crypto.timingSafeEqual(
Buffer.from(v,"hex"),
crypto.pbkdf2Sync(p,s,150000,32,"sha256")
);
}

function cookies(req){
return Object.fromEntries(
(req.headers.cookie||"")
.split(";")
.filter(Boolean)
.map(x=>{
let a=x.trim().split("=");
return [a.shift(),a.join("=")];
})
);
}

function user(req,D){
let c=cookies(req);
return D.users.find(u=>u.session===c.sid)||null;
}

function pubUser(u){
if(!u)return null;
let {passwordHash,session,...x}=u;
return x;
}

function send(res,code,obj,extra={}){
res.writeHead(code,{
"Content-Type":"application/json; charset=utf-8",
"Cache-Control":"no-store",
...extra
});
res.end(JSON.stringify(obj));
}

function body(req){
return new Promise((ok,no)=>{
let s="";

req.on("data",c=>{
s+=c;

if(s.length>20e6)
no(Error("Payload too large"));
});

req.on("end",()=>{
try{
ok(s?JSON.parse(s):{});
}catch(e){
no(e);
}
});
});
}

function html(res){
fs.readFile(path.join(PUB,"index.html"),(e,d)=>{
if(e){
res.writeHead(500);
return res.end("Missing app");
}

res.writeHead(200,{
"Content-Type":"text/html; charset=utf-8"
});

res.end(d);
});
}

function seedAdmin(D){

if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD)
return;

let e=process.env.ADMIN_EMAIL.toLowerCase();

if(!D.users.some(x=>x.email===e)){

D.users.push({
id:rid(),
name:"Administrator",
email:e,
passwordHash:pwHash(process.env.ADMIN_PASSWORD),
role:"admin",
active:true,
expiresAt:null,
session:null,
createdAt:new Date().toISOString()
});

save(D);
}
}

seedAdmin(db());


/* =========================
   TEAM NORMALIZATION
========================= */

function normalizeTeam(x){

return String(x||"")
.trim()
.toUpperCase()
.replace(/[^A-Z0-9 ]/g,"")
.replace(/\s+/g," ");

}


/* =========================
   FIXTURE PARSER
========================= */

function parseFixtures(text){

let out=[],
seen=new Set(),
lines=String(text||"")
.split(/\n+/)
.map(x=>x.trim())
.filter(Boolean);

const patterns=[
/([A-Z][A-Z0-9]{1,4})\s+(?:VS|V)\s+([A-Z][A-Z0-9]{1,4})/i,
/([A-Z][A-Z0-9]{1,4})\s*[-–—]\s*([A-Z][A-Z0-9]{1,4})/i
];

for(const l of lines){

for(const re of patterns){

let m=l.match(re);

if(m){

let a=normalizeTeam(m[1]),
b=normalizeTeam(m[2]),
k=a+"|"+b;

if(!seen.has(k)){

seen.add(k);

out.push({
teamA:a,
teamB:b,
raw:l
});

}

break;

}

}

}

return out.slice(0,100);

}


/* =========================
   STATISTICS
========================= */

function stats(D,a,b){

const rows=D.results.filter(
r=>r.teamA===a||
r.teamB===a||
r.teamA===b||
r.teamB===b
);

function team(t){

let played=0,
w=0,
d=0,
l=0,
gf=0,
ga=0;

for(const r of rows){

if(r.teamA!==t&&r.teamB!==t)
continue;

let sa=Number(r.scoreA),
sb=Number(r.scoreB);

if(!Number.isFinite(sa)||!Number.isFinite(sb))
continue;

played++;

if(r.teamA===t){

gf+=sa;
ga+=sb;

if(sa>sb)w++;
else if(sa===sb)d++;
else l++;

}else{

gf+=sb;
ga+=sa;

if(sb>sa)w++;
else if(sb===sa)d++;
else l++;

}

}

return{
played,
w,
d,
l,
gf,
ga,
ppg:played?((w*3+d)/played):0,
gd:gf-ga
};

}

return{
a:team(a),
b:team(b)
};

}


/* =========================
   PREDICTION ENGINE
========================= */

function predict(D,a,b){

const s=stats(D,a,b),
A=s.a,
B=s.b;

let base=50,
note=[];

if(A.played+B.played===0){

return{
pick:"INSUFFICIENT DATA",
confidence:0,
reason:"Hakuna historical results zilizohifadhiwa kwa teams hizi."
};

}

let diff=A.ppg-B.ppg;

let gd=
(A.gd-B.gd)/
Math.max(1,A.played+B.played)*3;

let raw=diff*18+gd*8;

let pick=
raw>.7?
"1":
raw<-.7?
"2":
"X";

let conf=Math.max(
52,
Math.min(
91,
Math.round(base+Math.abs(raw)*9)
)
);

if(A.played)
note.push(
`${a}: ${A.w}-${A.d}-${A.l}, ${A.gd>=0?"+":""}${A.gd} GD`
);

if(B.played)
note.push(
`${b}: ${B.w}-${B.d}-${B.l}, ${B.gd>=0?"+":""}${B.gd} GD`
);

return{
pick,
confidence:conf,
reason:note.join(" | "),
stats:s
};

}


/* =========================
   AI VISION
========================= */

async function aiVision(imageData){

if(!process.env.OPENAI_API_KEY)
return null;

const payload={
model:process.env.OPENAI_MODEL||"gpt-5.6-luna",
input:[
{
role:"user",
content:[
{
type:"input_text",
text:"Read this betting/football screenshot. Return ONLY valid JSON with key fixtures, an array of objects {teamA,teamB}. Do not use or infer odds. Preserve abbreviations exactly where readable."
},
{
type:"input_image",
image_url:imageData
}
]
}
]
};

const r=await fetch(
"https://api.openai.com/v1/responses",
{
method:"POST",
headers:{
"Authorization":"Bearer "+process.env.OPENAI_API_KEY,
"Content-Type":"application/json"
},
body:JSON.stringify(payload)
}
);

if(!r.ok)
throw Error("AI vision request failed");

const j=await r.json();

const text=
(j.output||[])
.flatMap(x=>x.content||[])
.map(x=>x.text||"")
.join("");

try{

let cleaned=
text
.replace(/^```json|```$/g,"")
.trim();

return JSON.parse(cleaned);

}catch{

return null;

}

}


/* =========================
   SERVER
========================= */

const server=http.createServer(async(req,res)=>{

try{

const u=new URL(req.url,"http://localhost"),
p=u.pathname,
D=db(),
me=user(req,D);


/* =========================
   HOME
========================= */

if(req.method==="GET"&&p==="/")
return html(res);


/* =========================
   CONFIG
========================= */

if(req.method==="GET"&&p==="/api/config")
return send(res,200,{
settings:D.settings,
user:pubUser(me),
aiEnabled:!!process.env.OPENAI_API_KEY
});


/* =========================
   REGISTER
========================= */

if(req.method==="POST"&&p==="/api/register"){

let b=await body(req),
e=String(b.email||"").toLowerCase();

if(!e||!b.password)
return send(res,400,{
error:"Email and password are required"
});

if(D.users.some(x=>x.email===e))
return send(res,409,{
error:"Email already exists"
});

D.users.push({
id:rid(),
name:b.name||"User",
email:e,
passwordHash:pwHash(b.password),
role:"user",
active:false,
expiresAt:null,
session:null,
createdAt:new Date().toISOString()
});

save(D);

return send(res,201,{
message:"Account created. Pay TSh 20,000 then submit the reference."
});

}


/* =========================
   LOGIN
========================= */

if(req.method==="POST"&&p==="/api/login"){

let b=await body(req);

let u=D.users.find(
x=>x.email===String(b.email||"").toLowerCase()
);

if(!u||!pwOK(b.password||"",u.passwordHash))
return send(res,401,{
error:"Invalid email or password"
});

u.session=rid();

save(D);

return send(
res,
200,
{user:pubUser(u)},
{
"Set-Cookie":
`sid=${u.session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
}
);

}


/* =========================
   LOGOUT
========================= */

if(req.method==="POST"&&p==="/api/logout"){

if(me){

me.session=null;
save(D);

}

return send(
res,
200,
{ok:true},
{
"Set-Cookie":
"sid=; Max-Age=0; Path=/"
}
);

}


/* =========================
   ME
========================= */

if(req.method==="GET"&&p==="/api/me")
return send(res,200,{
user:pubUser(me),
settings:D.settings
});


/* =========================
   PAYMENT
========================= */

if(req.method==="POST"&&p==="/api/payment"){

if(!me)
return send(res,401,{
error:"Login required"
});

let b=await body(req);

if(!b.reference)
return send(res,400,{
error:"Transaction reference required"
});

D.payments.push({
id:rid(),
userId:me.id,
amount:D.settings.priceTsh,
reference:String(b.reference).trim(),
status:"pending",
createdAt:new Date().toISOString()
});

save(D);

return send(res,200,{
message:"Payment submitted. Admin will verify it."
});

}


/* =========================
   OCR
========================= */

if(req.method==="POST"&&p==="/api/ocr"){

if(!me||!me.active)
return send(res,403,{
error:"Active subscription required"
});

let b=await body(req),
fixtures=[];

if(b.imageData&&process.env.OPENAI_API_KEY){

try{

let a=await aiVision(b.imageData);

fixtures=(a?.fixtures||[])
.map(x=>({
teamA:normalizeTeam(x.teamA),
teamB:normalizeTeam(x.teamB)
}))
.filter(x=>x.teamA&&x.teamB);

}catch{}

}

if(!fixtures.length)
fixtures=parseFixtures(b.text||"");

return send(res,200,{
fixtures,
method:
process.env.OPENAI_API_KEY&&b.imageData?
"AI Vision + OCR fallback":
"OCR"
});

}


/* =========================================================
   IMPORT HISTORICAL RESULTS
   ========================================================= */

if(req.method==="POST"&&p==="/api/historical-results"){

if(!me)
return send(res,401,{
error:"Login required"
});

if(!me.active)
return send(res,403,{
error:"Active subscription required"
});

let b=await body(req);

let arr=
Array.isArray(b.results)?
b.results:
[];

if(!arr.length)
return send(res,400,{
error:"No historical results supplied"
});

let added=0,
duplicates=0;

for(const r of arr){

let teamA=normalizeTeam(r.teamA);
let teamB=normalizeTeam(r.teamB);

let scoreA=Number(r.scoreA);
let scoreB=Number(r.scoreB);

if(
!teamA||
!teamB||
!Number.isFinite(scoreA)||
!Number.isFinite(scoreB)
){

continue;

}


/* Prevent duplicate historical results */

let duplicate=D.results.some(x=>
x.teamA===teamA&&
x.teamB===teamB&&
Number(x.scoreA)===scoreA&&
Number(x.scoreB)===scoreB&&
String(x.date||"")===String(r.date||"")
);

if(duplicate){

duplicates++;
continue;

}

D.results.push({

id:rid(),

type:"historical",

date:r.date||null,

teamA,
teamB,

scoreA,
scoreB,

status:"FINAL",

source:"historical_import",

createdAt:new Date().toISOString()

});

added++;

}

save(D);

return send(res,200,{

ok:true,

message:
`${added} historical results imported successfully.`,

added,
duplicates,
totalHistoricalResults:
D.results.filter(x=>x.type==="historical").length

});

}


/* =========================================================
   DELETE HISTORICAL RESULTS
   ========================================================= */

if(req.method==="DELETE"&&p==="/api/historical-results"){

if(!me)
return send(res,401,{
error:"Login required"
});

if(!me.active)
return send(res,403,{
error:"Active subscription required"
});


/*
Only delete records imported as historical.
Prediction verification results are preserved.
*/

let before=D.results.length;

D.results=D.results.filter(
x=>x.type!=="historical"
);

let deleted=before-D.results.length;

save(D);

return send(res,200,{

ok:true,

message:
`${deleted} historical results deleted.`,

deleted

});

}


/* =========================
   PREDICT
========================= */

if(req.method==="POST"&&p==="/api/predict"){

if(!me||!me.active)
return send(res,403,{
error:"Active subscription required"
});

let b=await body(req);

let a=normalizeTeam(b.teamA),
c=normalizeTeam(b.teamB);

if(!a||!c)
return send(res,400,{
error:"Teams required"
});


/*
Prediction engine automatically reads
D.results, including imported historical results.
*/

let pr=predict(D,a,c);

let rec={

id:rid(),

userId:me.id,

teamA:a,

teamB:c,

market:b.market||"1X2",

prediction:pr.pick,

confidence:pr.confidence,

reason:pr.reason,

status:"PENDING",

actualScore:null,

createdAt:new Date().toISOString(),

oddsUsed:false

};

D.predictions.push(rec);

save(D);

return send(res,200,{
prediction:rec
});

}


/* =========================
   HISTORY
========================= */

if(req.method==="GET"&&p==="/api/history"){

if(!me)
return send(res,401,{
error:"Login required"
});

return send(res,200,{

predictions:
D.predictions
.filter(x=>x.userId===me.id)
.sort(
(a,b)=>
b.createdAt.localeCompare(a.createdAt)
)

});

}


/* =========================
   ADMIN GET
========================= */

if(req.method==="GET"&&p==="/api/admin"){

if(!me||me.role!=="admin")
return send(res,403,{
error:"Admin only"
});

return send(res,200,{

users:D.users.map(pubUser),

payments:D.payments,

predictions:D.predictions,

results:D.results,

settings:D.settings

});

}


/* =========================
   ADMIN POST
========================= */

if(req.method==="POST"&&p==="/api/admin"){

if(!me||me.role!=="admin")
return send(res,403,{
error:"Admin only"
});

let b=await body(req);


/* PAYMENT */

if(b.action==="payment"){

let x=D.payments.find(
x=>x.id===b.id
);

if(x){

x.status=b.status;

if(b.status==="approved"){

let u=D.users.find(
u=>u.id===x.userId
);

if(u){

u.active=true;

u.expiresAt=
new Date(
Date.now()+
D.settings.subscriptionDays*
86400000
).toISOString();

}

}

}


/* RESULT */

if(b.action==="result"){

let x=D.predictions.find(
x=>x.id===b.id
);

if(x){

x.actualScore=
b.actualScore||null;

x.status=
String(
b.status||"PENDING"
).toUpperCase();

D.results.push({

id:rid(),

predictionId:x.id,

teamA:x.teamA,

teamB:x.teamB,

scoreA:b.scoreA,

scoreB:b.scoreB,

status:x.status,

createdAt:new Date().toISOString()

});

}

}


/* SETTINGS */

if(b.action==="settings"){

Object.assign(
D.settings,
b.settings||{}
);

}


/* ADMIN IMPORT */

if(b.action==="importResults"){

let arr=
Array.isArray(b.results)?
b.results:
[];

for(const r of arr){

if(r.teamA&&r.teamB){

D.results.push({

id:rid(),

type:"historical",

teamA:normalizeTeam(r.teamA),

teamB:normalizeTeam(r.teamB),

scoreA:Number(r.scoreA),

scoreB:Number(r.scoreB),

status:"FINAL",

source:"admin_import",

createdAt:new Date().toISOString()

});

}

}

}

save(D);

return send(res,200,{
ok:true
});

}


/* =========================
   STATIC FILES
========================= */

if(req.method==="GET"&&p.startsWith("/")){

let f=
path.join(
PUB,
p.replace(/^\/+/,"")
);

if(
f.startsWith(PUB)&&
fs.existsSync(f)
){

let ext=path.extname(f);

let mime={

".js":"text/javascript",
".css":"text/css",
".html":"text/html",
".svg":"image/svg+xml",
".png":"image/png",
".jpg":"image/jpeg"

}[ext]||"application/octet-stream";

fs.readFile(f,(e,d)=>{

res.writeHead(
e?404:200,
{
"Content-Type":mime
}
);

res.end(
e?"Not found":d
);

});

return;

}

}

res.writeHead(404);
res.end("Not found");

}catch(e){

console.error(e);

send(res,500,{
error:"Server error"
});

}

});


server.listen(
PORT,
()=>console.log(
`Instant Virtual Predictor: http://localhost:${PORT}`
)
);
