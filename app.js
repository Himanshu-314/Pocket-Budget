/* FITTRACK 12 - core app (storage, migration, workout set tracking, analytics, settings, backup) */
"use strict";

/* ====================================================================================
   PLAN  - [exercise name, prescription, equipment type]
   (names and order are unchanged from the original six-day routine)
   types: barbell | dumbbell | machine | cable | bodyweight | time
   ==================================================================================== */
const PLAN=[
 {name:"Shoulders + Biceps",focus:"Shoulders / Arms",items:[["Seated Dumbbell Shoulder Press","3 × 8-10","dumbbell"],["Dumbbell Lateral Raises","3 × 12-15","dumbbell"],["Reverse Pec Deck","2 × 12-15","machine"],["EZ Bar Curl","3 × 10-12","barbell"],["Hammer Curl","2 × 12","dumbbell"]],cardio:"10 min easy incline walk"},
 {name:"Chest + Triceps",focus:"Push",items:[["Barbell Bench Press","3 × 8-10","barbell"],["Incline Dumbbell Press","3 × 10-12","dumbbell"],["Pec Deck Fly","2 × 12-15","machine"],["Rope Triceps Pushdown","3 × 10-12","cable"],["Overhead Cable Extension","2 × 12","cable"]],cardio:"10 min incline treadmill"},
 {name:"Legs + Abs",focus:"Legs",items:[["Squats","3 × 8-10","barbell"],["Leg Press","3 × 10-12","machine"],["Leg Extension","2 × 12","machine"],["Leg Curl","3 × 12","machine"],["Standing Calf Raises","3 × 15","machine"],["Hanging Knee Raises","3 × 12","bodyweight"],["Plank","2 × 30-45 sec","time"]],cardio:"5-10 min easy walk"},
 {name:"Back + Biceps",focus:"Pull",items:[["Lat Pulldown","3 × 10-12","machine"],["Chest Supported Row","3 × 10","machine"],["Seated Cable Row","2 × 12","cable"],["Incline Dumbbell Curl","2 × 12","dumbbell"],["Cable Biceps Curl","2 × 12","cable"]],cardio:"10 min cycling"},
 {name:"Chest + Shoulders",focus:"Upper",items:[["Incline Chest Press Machine","3 × 10","machine"],["Flat Dumbbell Press","3 × 10","dumbbell"],["Cable Chest Fly","2 × 12-15","cable"],["Dumbbell Lateral Raises","3 × 12-15","dumbbell"],["Reverse Pec Deck","2 × 12-15","machine"]],cardio:"12 min incline treadmill"},
 {name:"Legs + Core",focus:"Legs",items:[["Romanian Deadlift","3 × 10","barbell"],["Bulgarian Split Squat","2 × 10 each leg","dumbbell"],["Lying Leg Curl","3 × 12","machine"],["Hip Thrust","2 × 12","barbell"],["Calf Raises","3 × 15","bodyweight"],["Cable Crunch","3 × 15","cable"],["Reverse Crunch","2 × 12","bodyweight"]],cardio:"10 min easy cycling"},
 {name:"Rest & Recovery",focus:"Recovery",items:[],cardio:"Optional gentle walk"}
];
const DAY_NAMES=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TYPE_LABEL={barbell:"Barbell",dumbbell:"Dumbbell",machine:"Machine",cable:"Cable",bodyweight:"Bodyweight",time:"Timed hold"};
const WEIGHT_LABEL={barbell:"Total kg",dumbbell:"kg / hand",machine:"Stack kg",cable:"Stack kg",bodyweight:"+kg extra"};
const INCREMENT={barbell:2.5,dumbbell:2,machine:2.5,cable:2.5,bodyweight:2.5};

/* ====================================================================================
   STORAGE KEYS  (unchanged from the original app so existing data is found)
   ==================================================================================== */
const KEY="fittrack12_v1", DB="fittrack12_backup", STORE="snapshots";
const PRE_KEY="fittrack12_v1_pre_sets_backup";   /* one-time copy of your data taken before migration */
const SCHEMA=2;

/* ---------- small helpers ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmtN=(n,d=0)=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0});
function localISO(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
const today=()=>localISO(new Date());   /* local calendar date (the old UTC version could show yesterday after midnight in India) */
function addDays(ds,n){const d=new Date(ds+"T12:00:00");d.setDate(d.getDate()+n);return localISO(d)}
function weekStart(ds){const d=new Date(ds+"T12:00:00");d.setDate(d.getDate()-((d.getDay()+6)%7));return localISO(d)}
const fmtDate=ds=>new Date(ds+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"});
function toast(msg){const t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600)}

/* ====================================================================================
   DATA MODEL + MIGRATION
   ==================================================================================== */
function defaultSettings(){return {startWeight:77,proteinTarget:125,startDate:today(),weeks:12,
 calorieTarget:2200,carbTarget:250,fatTarget:70,fibreTarget:30,calciumTarget:1000,ironTarget:19,potassiumTarget:3500,sodiumLimit:2000,magnesiumTarget:420,vitCTarget:80,aiEndpoint:""}}
const blank=()=>({schema:SCHEMA,settings:defaultSettings(),logs:{},measurements:[],foods:{}});

/* Parse a prescription such as "3 × 8-10", "2 × 12", "2 × 10 each leg", "2 × 30-45 sec" */
function parseRx(rx){
 const m=String(rx).match(/(\d+)\s*[×x]\s*(\d+)(?:\s*-\s*(\d+))?/);
 const time=/sec/i.test(rx);
 if(!m)return {sets:3,lo:8,hi:12,time};
 const lo=+m[2],hi=m[3]?+m[3]:+m[2];
 return {sets:+m[1],lo,hi,time};
}
function exDef(dayIdx,i){const p=PLAN[dayIdx];return p&&p.items[i]?p.items[i]:null}

/* Old format:  lifts[i] = {weight, reps, note}      (one weight + one rep field per exercise)
   New format:  lifts[i] = {name, type, sets:[{w,r,done}], note}   (old weight/reps kept untouched as a safety copy) */
function migrateLogs(logs){
 for(const key of Object.keys(logs)){
  const log=logs[key];if(!log||typeof log!=="object"){delete logs[key];continue}
  log.checks=log.checks&&typeof log.checks==="object"?log.checks:{};
  log.lifts=log.lifts&&typeof log.lifts==="object"?log.lifts:{};
  const di=Number(String(key).split("_")[1]);
  for(const i of Object.keys(log.lifts)){
   const l=log.lifts[i];if(!l||typeof l!=="object"){delete log.lifts[i];continue}
   const def=exDef(di,Number(i));
   if(!l.name&&def)l.name=def[0];
   if(!l.type)l.type=(def&&def[2])||"machine";
   if(!Array.isArray(l.sets)){
    l.sets=[];
    const hasW=l.weight!==undefined&&l.weight!==null&&String(l.weight)!=="";
    const hasR=l.reps!==undefined&&l.reps!==null&&String(l.reps)!=="";
    if(hasW||hasR){
     l.sets.push(l.type==="time"?{w:"",r:hasR?String(l.reps):String(l.weight),done:!!log.checks[i]}:{w:hasW?String(l.weight):"",r:hasR?String(l.reps):"",done:!!log.checks[i]});
    }
   }
   l.sets=l.sets.filter(s=>s&&typeof s==="object").map(s=>({w:s.w==null?"":String(s.w),r:s.r==null?"":String(s.r),done:!!s.done}));
  }
 }
}
function migrateFoods(foods){
 for(const d of Object.keys(foods)){
  if(!Array.isArray(foods[d])){delete foods[d];continue}
  foods[d]=foods[d].filter(e=>e&&typeof e==="object");
  foods[d].forEach(e=>{if(!e.id)e.id=uid();e.protein=num(e.protein);e.calories=num(e.calories)});
 }
}
function normalize(o){
 o=o&&typeof o==="object"?o:{};
 const b=blank();
 const d={...o};
 d.settings={...b.settings,...(o.settings&&typeof o.settings==="object"?o.settings:{})};
 d.logs=o.logs&&typeof o.logs==="object"?o.logs:{};
 d.measurements=Array.isArray(o.measurements)?o.measurements:[];
 d.foods=o.foods&&typeof o.foods==="object"?o.foods:{};
 migrateLogs(d.logs);migrateFoods(d.foods);
 d.schema=SCHEMA;
 return d;
}
function load(){
 let raw=null;
 try{raw=localStorage.getItem(KEY)}catch(e){}
 let parsed={};
 if(raw){
  try{parsed=JSON.parse(raw)}
  catch(e){ /* corrupt JSON: keep the raw text so nothing is silently lost */
   try{localStorage.setItem(KEY+"_corrupt_"+Date.now(),raw)}catch(_){}
   parsed={};
  }
  if(parsed&&(parsed.schema||1)<SCHEMA){ /* take a one-time safety copy before upgrading */
   try{if(!localStorage.getItem(PRE_KEY))localStorage.setItem(PRE_KEY,raw)}catch(e){}
  }
 }
 return normalize(parsed);
}
let data=load();

/* ====================================================================================
   PERSISTENCE (auto-save + automatic IndexedDB snapshot)
   ==================================================================================== */
let saveTimer=null;
function persist(){
 clearTimeout(saveTimer);saveTimer=null;
 const s=$("saveStatus");
 try{localStorage.setItem(KEY,JSON.stringify(data));if(s){s.textContent="● Saved on device";s.classList.remove("warn")}}
 catch(e){if(s){s.textContent="⚠ Not saved (storage full?)";s.classList.add("warn")}}
 backupAuto();
}
function persistSoon(){const s=$("saveStatus");if(s){s.textContent="● Saving…";s.classList.remove("warn")}clearTimeout(saveTimer);saveTimer=setTimeout(persist,350)}
function flushSave(){if(saveTimer)persist()}
window.addEventListener("pagehide",flushSave);
document.addEventListener("visibilitychange",()=>{if(document.hidden)flushSave()});

function openDB(){return new Promise((res,rej)=>{let r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function backupAuto(){try{let db=await openDB();let tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({id:"latest",savedAt:new Date().toISOString(),data});tx.oncomplete=()=>{const b=$("backupStatus");if(b)b.textContent="Automatic local backup: updated "+new Date().toLocaleTimeString()}}catch(e){const b=$("backupStatus");if(b)b.textContent="Local backup unavailable. Please export a manual backup."}}
/* If the browser wiped localStorage but the automatic snapshot survived, offer to bring it back. */
async function offerSnapshotRestore(){
 try{
  if(localStorage.getItem(KEY))return;
  const db=await openDB();
  const rec=await new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get("latest");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  if(rec&&rec.data&&rec.data.logs&&confirm("Found an automatic backup from "+new Date(rec.savedAt).toLocaleString()+". Restore it?")){
   data=normalize(rec.data);persist();show("home");toast("Backup restored");
  }
 }catch(e){}
}

/* ====================================================================================
   NAVIGATION
   ==================================================================================== */
function show(id){
 document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));
 document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
 if(id==="home")renderHome();if(id==="workout")renderWorkout();if(id==="progress")renderProgress();if(id==="nutrition")renderNutrition();if(id==="settings")renderSettings();
 window.scrollTo(0,0);
}

/* ====================================================================================
   LOG ACCESS
   ==================================================================================== */
function dayIndex(date=today()){let d=new Date(date+"T12:00:00").getDay();return d===0?6:d-1}
function logKey(date=today(),idx=dayIndex()){return date+"_"+idx}
function getLog(date=today(),idx=dayIndex()){let k=logKey(date,idx);if(!data.logs[k])data.logs[k]={checks:{},lifts:{},cardio:null,finished:false};const l=data.logs[k];l.checks=l.checks||{};l.lifts=l.lifts||{};return l}
function ensureLift(log,dayIdx,i){
 const def=exDef(dayIdx,i);
 let l=log.lifts[i];if(!l||typeof l!=="object")l=log.lifts[i]={};
 if(!Array.isArray(l.sets))l.sets=[];
 if(def){l.name=def[0];if(!l.type)l.type=def[2]}
 if(!l.type)l.type="machine";
 return l;
}
function padSets(l,rx){while(l.sets.length<rx.sets)l.sets.push({w:"",r:"",done:false})}

/* ====================================================================================
   SET MATHS / HISTORY
   ==================================================================================== */
const isDone=s=>s&&s.done&&num(s.r)>0;
function setVolume(type,s){return type==="time"?0:num(s.w)*num(s.r)}
function sessionFrom(date,key,di,i,type,sets){
 const vol=sets.reduce((a,s)=>a+setVolume(type,s),0);
 const top=Math.max(...sets.map(s=>s.w));
 const e1=Math.max(0,...sets.filter(s=>s.w>0&&type!=="time").map(s=>s.w*(1+s.r/30)));
 return {date,key,day:di,i,type,sets,vol,top,reps:sets.reduce((a,s)=>a+s.r,0),e1rm:e1};
}
/* every completed-set session, grouped by exercise name, oldest first */
function allSessions(){
 const map={};
 for(const [key,log] of Object.entries(data.logs)){
  const [date,d]=key.split("_");const di=Number(d);
  for(const [i,l] of Object.entries(log.lifts||{})){
   if(!l||!Array.isArray(l.sets))continue;
   const def=exDef(di,Number(i));
   const name=l.name||(def&&def[0]);if(!name)continue;
   const type=l.type||(def&&def[2])||"machine";
   const sets=l.sets.filter(isDone).map(s=>({w:num(s.w),r:num(s.r)}));
   if(!sets.length)continue;
   (map[name]=map[name]||[]).push(sessionFrom(date,key,di,Number(i),type,sets));
  }
 }
 Object.values(map).forEach(a=>a.sort((x,y)=>x.date.localeCompare(y.date)||x.key.localeCompare(y.key)));
 return map;
}
function lastSessionBefore(name,date,excludeKey){
 const arr=(allSessions()[name]||[]).filter(s=>s.key!==excludeKey&&s.date<=date&&!(s.date===date&&s.key===excludeKey));
 return arr.length?arr[arr.length-1]:null;
}
/* Suggest (never apply) what to do next time */
function suggestProgression(prev,rx,type){
 if(!prev)return {kind:"new",text:"No history yet for this exercise. Start with a weight you can lift for the target reps with 1–2 reps left in reserve."};
 const sets=prev.sets;
 if(type==="time"){
  const best=Math.min(...sets.map(s=>s.r));
  if(best>=rx.hi&&sets.length>=rx.sets)return {kind:"up",text:`You held ${best}+ sec on every set last time. When you're ready, try ${rx.hi+5} sec.`};
  return {kind:"hold",text:`Aim to hold at least ${rx.hi} sec on every set (last time: ${sets.map(s=>s.r+"s").join(", ")}).`};
 }
 const topW=prev.top;
 const atTop=sets.filter(s=>s.w===topW);
 const hitAll=atTop.every(s=>s.r>=rx.hi)&&sets.length>=Math.min(rx.sets,2)&&sets.length>=rx.sets;
 const below=sets.some(s=>s.r<rx.lo);
 const inc=INCREMENT[type]||2.5;
 const wTxt=type==="bodyweight"&&topW===0?"bodyweight":topW+" kg";
 if(hitAll){
  if(type==="bodyweight"&&topW===0)return {kind:"up",text:`You reached ${rx.hi}+ reps on every set. When you're ready, add ${inc} kg of extra load (or slow the tempo) — only if form stays solid.`};
  return {kind:"up",text:`You reached ${rx.hi}+ reps on all sets at ${wTxt}. When you're ready, try ${fmtN(topW+inc,1)} kg${type==="dumbbell"?" per hand":""} — only if form stays solid.`};
 }
 if(below)return {kind:"hold",text:`Some sets fell below ${rx.lo} reps at ${wTxt}. Stay at this load (or drop slightly) and rebuild to ${rx.lo}–${rx.hi} reps.`};
 return {kind:"hold",text:`Stay at ${wTxt} and add a rep per set until every set reaches ${rx.hi} reps, then consider adding load.`};
}
function setStr(type,s){return type==="time"?s.r+"s":(type==="bodyweight"&&!s.w?"BW":fmtN(s.w,1))+"×"+s.r}
const sessionStr=se=>se.sets.map(s=>setStr(se.type,s)).join(" · ");

/* ====================================================================================
   HOME
   ==================================================================================== */
function renderHome(){
 let idx=dayIndex(),p=PLAN[idx],log=getLog();$("todayTitle").textContent=p.name;$("todayDesc").textContent=p.focus+" day · approx. 60 minutes";$("todayLabel").textContent=idx===6?"RECOVERY DAY":"TODAY'S SESSION";
 let done=p.items.filter((x,i)=>log.checks[i]).length,pct=p.items.length?Math.round(done/p.items.length*100):100;$("todayPct").textContent=pct+"%";$("todayBar").style.width=pct+"%";
 let start=new Date(data.settings.startDate+"T12:00:00"),now=new Date(today()+"T12:00:00"),week=Math.max(1,Math.min(data.settings.weeks,Math.floor((now-start)/604800000)+1));$("weekPill").textContent="WEEK "+week+" / "+data.settings.weeks;
 $("weekDays").innerHTML=PLAN.map((d,i)=>`<div class="day ${i===idx?'today':''}"><b>${["M","T","W","T","F","S","S"][i]}</b>${d.focus==="Recovery"?"Rest":d.focus}</div>`).join("");
 let ms=data.measurements.slice().sort((a,b)=>b.date.localeCompare(a.date)),latest=ms[0];$("homeWeight").textContent=latest&&latest.weight?latest.weight+" kg":data.settings.startWeight+" kg";
 const w0=ms.length?Number(ms[0].weight):0,wN=ms.length?Number(ms[ms.length-1].weight):0;
 $("weightChange").textContent=ms.length>1?(w0-wN>0?"+":"")+(w0-wN).toFixed(1)+" kg since first log":"Starting point";
 $("homeWaist").textContent=latest&&latest.waist?latest.waist+" cm":"-- cm";
 const t=dayTotals(today());$("homeProtein").textContent=fmtN(t.protein,1)+" g";$("proteinTargetLabel").textContent="Target: "+data.settings.proteinTarget+" g"+(t.calories?" · "+fmtN(t.calories)+" kcal":"");
 let completed=Object.values(data.logs).filter(l=>l.finished).length;$("homeWorkouts").textContent=completed;
 let total=Math.max(1,data.settings.weeks*6),all=Math.min(100,Math.round(completed/total*100));$("overallPct").textContent=all+"%";$("overallBar").style.width=all+"%";$("journeyText").textContent=completed+" workouts completed · "+Math.max(0,total-completed)+" planned training sessions remaining.";
}

/* ====================================================================================
   WORKOUT SCREEN  (set-by-set tracking)
   ==================================================================================== */
function initWorkout(){let s=$("daySelect");s.innerHTML=PLAN.map((p,i)=>`<option value="${i}">${DAY_NAMES[i]} · ${p.name}</option>`).join("");s.value=dayIndex();
 const c=$("cmpDay");if(c){c.innerHTML=PLAN.slice(0,6).map((p,i)=>`<option value="${i}">${DAY_NAMES[i]} · ${p.name}</option>`).join("");c.value=Math.min(dayIndex(),5)}}
function selectedDay(){return Number($("daySelect").value||0)}

const EX_IMG={"squats":"squats.jpg","leg press":"leg-press.jpg","leg extension":"leg-extension.jpg","leg curl":"leg-curl.jpg","standing calf raises":"standing-calf-raises.jpg","hanging knee raises":"hanging-knee-raises.jpg","plank":"plank.jpg","incline chest press machine":"incline-chest-press-machine.jpg","flat dumbbell press":"flat-dumbbell-press.jpg","cable chest fly":"cable-chest-fly.jpg","romanian deadlift":"romanian-deadlift.jpg","bulgarian split squat":"bulgarian-split-squat.jpg","lying leg curl":"lying-leg-curl.jpg","hip thrust":"hip-thrust.jpg","calf raises":"calf-raises.jpg","cable crunch":"cable-crunch.jpg","reverse crunch":"reverse-crunch.jpg","lat pulldown":"lat-pulldown.jpg","chest supported row":"chest-supported-row.jpg","seated cable row":"seated-cable-row.jpg","incline dumbbell curl":"incline-dumbbell-curl.jpg","cable biceps curl":"cable-biceps-curl.jpg","seated dumbbell shoulder press":"seated-dumbbell-shoulder-press.jpg","dumbbell lateral raises":"dumbbell-lateral-raises.jpg","reverse pec deck":"reverse-pec-deck.jpg","ez bar curl":"ez-bar-curl.jpg","hammer curl":"hammer-curl.jpg","barbell bench press":"barbell-bench-press.jpg","incline dumbbell press":"incline-dumbbell-press.jpg","pec deck fly":"pec-deck-fly.jpg","rope triceps pushdown":"rope-triceps-pushdown.jpg","overhead cable extension":"overhead-cable-extension.jpg"};
function exerciseArt(name){
 const f=EX_IMG[name.toLowerCase()];
 if(!f)return exerciseArtLegacy(name);
 return `<div class="exercise-photo pro"><img src="assets/exercise/${f}" alt="${esc(name)} demonstration" data-n="${esc(name)}" onerror="this.onerror=null;this.parentNode.outerHTML=exerciseArtLegacy(this.dataset.n)"><span>PHOTO GUIDE · ${esc(name.toUpperCase())}</span></div>`;
}
function exerciseArtLegacy(name){
 const n=name.toLowerCase();
 let file="bench-press.jpg";
 if(n.includes("incline")||n.includes("flat dumbbell")||n.includes("chest press")) file="incline-press.jpg";
 else if(n.includes("pec deck")||n.includes("fly")) file="pec-deck.jpg";
 else if(n.includes("pushdown")) file="triceps-pushdown.jpg";
 else if(n.includes("overhead cable")||n.includes("extension")) file="overhead-extension.jpg";
 else if(n.includes("shoulder press")||n.includes("lateral raise")||n.includes("reverse pec")) file="shoulder-press.jpg";
 else if(n.includes("squat")||n.includes("split squat")) file="squat.jpg";
 else if(n.includes("pulldown")) file="lat-pulldown.jpg";
 else if(n.includes("row")||n.includes("curl")) file="row.jpg";
 else if(n.includes("leg")||n.includes("calf")||n.includes("romanian")||n.includes("hip thrust")) file="leg-work.jpg";
 else if(n.includes("plank")||n.includes("crunch")||n.includes("knee raise")) file="recovery.jpg";
 return `<div class="exercise-photo"><img src="assets/${file}" alt="Realistic gym photo guide for ${esc(name)}" loading="lazy"><span>PHOTO GUIDE · ${esc(name.toUpperCase())}</span></div>`;
}

function exerciseInner(idx,i,log){
 const ex=exDef(idx,i),rx=parseRx(ex[1]),l=ensureLift(log,idx,i),type=l.type,time=type==="time";
 const prev=lastSessionBefore(ex[0],today(),logKey(today(),idx));
 const sug=suggestProgression(prev,rx,type);
 const allDone=l.sets.length>0&&l.sets.every(s=>s.done);
 let h=`<label><input type="checkbox" ${allDone||log.checks[i]?"checked":""} onchange="toggleExercise(${idx},${i},this.checked)"><span><b>${esc(ex[0])}</b><br><small>${esc(ex[1])}</small></span></label>`;
 h+=`<div class="rxline"><span>Equipment:</span><select onchange="setType(${idx},${i},this.value)" aria-label="Equipment type">${Object.keys(TYPE_LABEL).map(t=>`<option value="${t}" ${t===type?"selected":""}>${TYPE_LABEL[t]}</option>`).join("")}</select></div>`;
 h+=prev?`<div class="prevline"><b>Last time (${fmtDate(prev.date)}):</b> ${esc(sessionStr(prev))}${prev.vol?` · ${fmtN(prev.vol)} kg volume`:""}</div>`:`<div class="prevline">No previous workout recorded for this exercise yet.</div>`;
 h+=`<div class="suggest ${sug.kind==="up"?"":"hold"}">💡 ${esc(sug.text)}</div>`;
 h+=`<div class="sets"><div class="setrow hd ${time?"time":""}"><span>SET</span><span>PREV</span>${time?`<span>TIME (sec)</span>`:`<span>${esc((WEIGHT_LABEL[type]||"kg").toUpperCase())}</span><span>REPS</span>`}<span>✓</span><span></span></div>`;
 l.sets.forEach((s,k)=>{
  const ps=prev&&prev.sets[k]?setStr(prev.type,prev.sets[k]):"–";
  h+=`<div class="setrow ${time?"time":""} ${s.done?"done":""}"><span class="sn">${k+1}</span><span class="pv">${esc(ps)}</span>`+
   (time?`<input type="number" inputmode="numeric" min="0" placeholder="sec" value="${esc(s.r)}" oninput="onSetField(${idx},${i},${k},'r',this.value)" aria-label="Set ${k+1} seconds">`:
   `<input type="number" inputmode="decimal" min="0" step="0.5" placeholder="${type==="bodyweight"?"0":"kg"}" value="${esc(s.w)}" oninput="onSetField(${idx},${i},${k},'w',this.value)" aria-label="Set ${k+1} weight in kilograms"><input type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="${esc(s.r)}" oninput="onSetField(${idx},${i},${k},'r',this.value)" aria-label="Set ${k+1} repetitions">`)+
   `<input class="setdone" type="checkbox" ${s.done?"checked":""} onchange="toggleSet(${idx},${i},${k},this.checked)" aria-label="Mark set ${k+1} complete"><button class="rm" onclick="removeSet(${idx},${i},${k})" aria-label="Remove set ${k+1}">×</button></div>`;
 });
 h+=`</div><div class="exfoot"><button class="secondary small" onclick="addSet(${idx},${i})">＋ Add set</button>${prev?`<button class="secondary small" onclick="copyPrev(${idx},${i})">Use last session's numbers</button>`:""}<span class="vol" id="exvol-${i}">${exVolText(l)}</span></div>`;
 h+=`<input class="exnote" placeholder="Notes (optional)" value="${esc(l.note||"")}" oninput="onNote(${idx},${i},this.value)" aria-label="Notes for ${esc(ex[0])}">`;
 return h;
}
function exVolText(l){
 const dn=l.sets.filter(s=>s.done);
 if(l.type==="time"){const t=dn.reduce((a,s)=>a+num(s.r),0);return `${dn.length}/${l.sets.length} sets · ${t} sec`}
 const vol=dn.reduce((a,s)=>a+setVolume(l.type,s),0);
 if(l.type==="bodyweight"&&vol===0){return `${dn.length}/${l.sets.length} sets · ${dn.reduce((a,s)=>a+num(s.r),0)} reps`}
 return `${dn.length}/${l.sets.length} sets · ${fmtN(vol,1)} kg`;
}
function workoutTotals(idx,log){
 const p=PLAN[idx];let sets=0,done=0,vol=0;
 p.items.forEach((x,i)=>{const l=log.lifts[i];if(!l)return;sets+=l.sets.length;l.sets.forEach(s=>{if(s.done){done++;vol+=setVolume(l.type,s)}})});
 return {sets,done,vol};
}
function renderTotals(idx,log){
 const t=workoutTotals(idx,log);
 $("workTotals").innerHTML=`<div><b>${fmtN(t.vol)} kg</b><span>TOTAL VOLUME</span></div><div><b>${t.done} / ${t.sets}</b><span>SETS DONE</span></div><div><b>${PLAN[idx].items.filter((x,i)=>log.checks[i]).length} / ${PLAN[idx].items.length}</b><span>EXERCISES DONE</span></div>`;
 $("workTotals").style.display=PLAN[idx].items.length?"grid":"none";
}
function renderCounts(idx,log){
 const p=PLAN[idx],n=p.items.filter((x,i)=>log.checks[i]).length;
 $("workCount").textContent=n+" / "+p.items.length+" done";
 $("workBar").style.width=(p.items.length?Math.round(n/p.items.length*100):100)+"%";
 renderTotals(idx,log);
}
function renderWorkout(){
 const idx=selectedDay(),p=PLAN[idx],date=today(),log=getLog(date,idx);
 $("workTitle").textContent=p.name;$("workFocus").textContent=p.focus+" · approx. 60 min";
 p.items.forEach((x,i)=>{const l=ensureLift(log,idx,i);padSets(l,parseRx(x[1]))});
 renderCounts(idx,log);
 $("exerciseList").innerHTML=p.items.length?p.items.map((x,i)=>`<div class="exercise" id="ex-${i}">${exerciseArt(x[0])}<div class="exdyn" id="exd-${i}">${exerciseInner(idx,i,log)}</div></div>`).join(""):`<div class="empty">Rest day. Recover, hydrate and take an easy walk if you like.</div>`;
 $("cardioSaved").textContent=log.cardio?`Saved: ${log.cardio.type}, ${log.cardio.mins} minutes`:"No cardio logged today.";$("cardioMins").value=log.cardio&&log.cardio.mins||"";$("cardioType").value=log.cardio&&log.cardio.type||"Incline treadmill";
}
function redrawExercise(idx,i){const log=getLog(today(),idx),el=$("exd-"+i);if(el)el.innerHTML=exerciseInner(idx,i,log);renderCounts(idx,log)}
function syncCheck(log,idx,i){const l=log.lifts[i];log.checks[i]=!!(l&&l.sets.length&&l.sets.every(s=>s.done))}

function onSetField(d,i,k,f,v){const log=getLog(today(),d),l=ensureLift(log,d,i);if(!l.sets[k])return;l.sets[k][f]=v;persistSoon();const e=$("exvol-"+i);if(e)e.textContent=exVolText(l);renderTotals(d,log)}
function onNote(d,i,v){const l=ensureLift(getLog(today(),d),d,i);l.note=v;persistSoon()}
function toggleSet(d,i,k,v){const log=getLog(today(),d),l=ensureLift(log,d,i);if(!l.sets[k])return;l.sets[k].done=v;syncCheck(log,d,i);persist();redrawExercise(d,i);renderHome()}
function toggleExercise(d,i,v){const log=getLog(today(),d),l=ensureLift(log,d,i);if(!l.sets.length)padSets(l,parseRx(exDef(d,i)[1]));l.sets.forEach(s=>s.done=v);log.checks[i]=v;persist();redrawExercise(d,i);renderHome()}
function addSet(d,i){const log=getLog(today(),d),l=ensureLift(log,d,i),last=l.sets[l.sets.length-1];l.sets.push({w:last?last.w:"",r:last?last.r:"",done:false});syncCheck(log,d,i);persist();redrawExercise(d,i)}
function removeSet(d,i,k){const log=getLog(today(),d),l=ensureLift(log,d,i);l.sets.splice(k,1);syncCheck(log,d,i);persist();redrawExercise(d,i);renderHome()}
function setType(d,i,t){const log=getLog(today(),d),l=ensureLift(log,d,i);l.type=t;persist();redrawExercise(d,i)}
function copyPrev(d,i){
 const log=getLog(today(),d),l=ensureLift(log,d,i),prev=lastSessionBefore(exDef(d,i)[0],today(),logKey(today(),d));if(!prev)return;
 prev.sets.slice(0,12).forEach((ps,k)=>{if(!l.sets[k])l.sets[k]={w:"",r:"",done:false};if(!l.sets[k].done){l.sets[k].w=l.type==="time"?"":String(ps.w||"");l.sets[k].r=String(ps.r)}});
 persist();redrawExercise(d,i);toast("Last session's numbers copied — adjust as needed");
}
function saveCardio(){let l=getLog(today(),selectedDay());l.cardio={type:$("cardioType").value,mins:Number($("cardioMins").value||0)};persist();renderWorkout()}
function resetDay(){if(!confirm("Reset today's exercise checkmarks, sets and lift notes for this selected day?"))return;let l=getLog(today(),selectedDay());l.checks={};l.lifts={};l.finished=false;persist();renderWorkout();renderHome()}
function finishDay(){const d=selectedDay(),l=getLog(today(),d);l.finished=true;persist();const t=workoutTotals(d,l);toast(`Workout complete! ${fmtN(t.vol)} kg across ${t.done} sets.`);renderWorkout();renderHome()}

/* ====================================================================================
   CHART HELPERS (plain SVG, no libraries, works offline)
   ==================================================================================== */
const SVG_W=320,SVG_H=170,PX0=36,PX1=308,PY0=14,PY1=138;
function chartEmpty(svg,msg){svg.innerHTML=`<text x="160" y="90" fill="#9aafa1" text-anchor="middle" font-size="11">${esc(msg)}</text>`}
function xLabels(labels,n){
 if(!labels.length)return "";const idxs=new Set([0,labels.length-1]);if(labels.length>4)idxs.add(Math.floor((labels.length-1)/2));
 return [...idxs].map(i=>{const x=labels.length===1?(PX0+PX1)/2:PX0+(PX1-PX0)*i/(labels.length-1);const anc=i===0?"start":i===labels.length-1?"end":"middle";return `<text x="${i===0?PX0:i===labels.length-1?PX1:x}" y="158" fill="#9aafa1" font-size="9" text-anchor="${anc}">${esc(labels[i])}</text>`}).join("");
}
function chartLine(svg,labels,vals,o={}){
 if(vals.length<1){chartEmpty(svg,o.empty||"Not enough data yet");return}
 let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=1;max+=1}const pad=(max-min)*0.12;min-=pad;max+=pad;
 const X=i=>vals.length===1?(PX0+PX1)/2:PX0+(PX1-PX0)*i/(vals.length-1),Y=v=>PY1-(v-min)/(max-min)*(PY1-PY0);
 const dec=o.dec==null?1:o.dec;
 let g="";[0,0.5,1].forEach(f=>{const v=min+(max-min)*f,y=Y(v);g+=`<line x1="${PX0}" y1="${y}" x2="${PX1}" y2="${y}" stroke="#2b4034" stroke-width=".6"/><text x="${PX0-4}" y="${y+3}" fill="#9aafa1" font-size="9" text-anchor="end">${fmtN(v,dec)}</text>`});
 const pts=vals.map((v,i)=>[X(i),Y(v)]);
 svg.innerHTML=g+(vals.length>1?`<polyline fill="none" stroke="#a7f36b" stroke-width="2.6" stroke-linejoin="round" points="${pts.map(p=>p.join(",")).join(" ")}"/>`:"")+pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="#d4ffad"/>`).join("")+`<text x="${Math.min(PX1,pts[pts.length-1][0]+2)}" y="${Math.max(10,pts[pts.length-1][1]-8)}" fill="#d4ffad" font-size="10" font-weight="700" text-anchor="end">${fmtN(vals[vals.length-1],dec)}${o.unit?" "+o.unit:""}</text>`+xLabels(labels);
}
function chartBars(svg,labels,vals,o={}){
 if(!vals.length||vals.every(v=>!v)&&!o.target){chartEmpty(svg,o.empty||"Nothing logged yet");return}
 const max=Math.max(...vals,o.target||0,1)*1.12,n=vals.length,slot=(PX1-PX0)/n,bw=Math.max(2,Math.min(26,slot*0.68));
 const Y=v=>PY1-v/max*(PY1-PY0),dec=o.dec||0;
 let g="";[0,0.5,1].forEach(f=>{const v=max*f,y=Y(v);g+=`<line x1="${PX0}" y1="${y}" x2="${PX1}" y2="${y}" stroke="#2b4034" stroke-width=".6"/><text x="${PX0-4}" y="${y+3}" fill="#9aafa1" font-size="9" text-anchor="end">${fmtN(v,dec)}</text>`});
 let b="";vals.forEach((v,i)=>{const x=PX0+slot*i+(slot-bw)/2,y=Y(v);if(v>0)b+=`<rect x="${x}" y="${y}" width="${bw}" height="${PY1-y}" rx="2.5" fill="${o.over&&v>o.over?"#ff8c82":"#a7f36b"}"/>`;if(n<=8&&v>0)b+=`<text x="${x+bw/2}" y="${y-3}" fill="#d4ffad" font-size="8.5" text-anchor="middle">${fmtN(v,dec)}</text>`});
 if(o.target)b+=`<line x1="${PX0}" y1="${Y(o.target)}" x2="${PX1}" y2="${Y(o.target)}" stroke="#ffd37a" stroke-width="1.2" stroke-dasharray="4 3"/><text x="${PX1}" y="${Y(o.target)-3}" fill="#ffd37a" font-size="8.5" text-anchor="end">target ${fmtN(o.target,dec)}</text>`;
 svg.innerHTML=g+b+xLabels(labels);
}

/* ====================================================================================
   PROGRESS SCREEN
   ==================================================================================== */
let progTab="body";
function setProgTab(t){progTab=t;renderProgress()}
function renderProgress(){
 document.querySelectorAll("#progSeg button").forEach(b=>b.classList.toggle("active",b.dataset.t===progTab));
 $("pBody").hidden=progTab!=="body";$("pStrength").hidden=progTab!=="strength";$("pVolume").hidden=progTab!=="volume";
 if(progTab==="body")renderBody();else if(progTab==="strength")renderStrength();else renderVolume();
}
function addMeasurement(){let date=$("measureDate").value||today(),weight=$("measureWeight").value,waist=$("measureWaist").value,chest=$("measureChest").value;if(!weight&&!waist&&!chest){alert("Enter at least one measurement.");return}
 const old=data.measurements.find(m=>m.date===date)||{};
 /* keep earlier values from the same date if only one field is entered */
 data.measurements=data.measurements.filter(m=>m.date!==date);data.measurements.push({date,weight:weight||old.weight||"",waist:waist||old.waist||"",chest:chest||old.chest||""});persist();["measureWeight","measureWaist","measureChest"].forEach(id=>$(id).value="");renderProgress();renderHome();toast("Measurement saved")}
function renderBody(){
 $("measureDate").value=$("measureDate").value||today();
 let ms=data.measurements.slice().sort((a,b)=>a.date.localeCompare(b.date));$("measureCount").textContent=ms.length+" entries";
 $("measureTable").innerHTML=ms.length?`<table><thead><tr><th>Date</th><th>Weight</th><th>Waist</th><th>Chest</th></tr></thead><tbody>${ms.slice().reverse().map(m=>`<tr><td>${esc(m.date)}</td><td>${esc(m.weight||"–")}</td><td>${esc(m.waist||"–")}</td><td>${esc(m.chest||"–")}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">No measurements yet.</div>';
 drawTrend("weightChart","weightChartNote",ms,"weight","kg","Your weight trend will appear here.");
 drawTrend("waistChart","waistChartNote",ms,"waist","cm","Your waist trend will appear here.");
}
function drawTrend(svgId,noteId,ms,field,unit,emptyNote){
 const rows=ms.filter(m=>m[field]!==""&&m[field]!=null&&num(m[field])>0),svg=$(svgId);
 if(rows.length<2){chartEmpty(svg,"Add two or more "+field+" entries");$(noteId).textContent=emptyNote;return}
 chartLine(svg,rows.map(m=>fmtDate(m.date)),rows.map(m=>num(m[field])),{unit,dec:1});
 const f=num(rows[0][field]),l=num(rows[rows.length-1][field]),ch=l-f;
 $(noteId).textContent="Latest: "+l+" "+unit+" · First: "+f+" "+unit+" · Change: "+(ch>0?"+":"")+ch.toFixed(1)+" "+unit;
}

/* ---- Strength tab ---- */
function exerciseNames(){
 const names=[];PLAN.forEach(p=>p.items.forEach(x=>{if(!names.includes(x[0]))names.push(x[0])}));
 Object.keys(allSessions()).forEach(n=>{if(!names.includes(n))names.push(n)});
 return names;
}
function deltaHtml(a,b,unit="",dec=1){const d=b-a;if(Math.abs(d)<0.05)return `<span class="delta flat">±0${unit}</span>`;return `<span class="delta ${d>0?"up":"down"}">${d>0?"▲ +":"▼ "}${fmtN(d,dec)}${unit}</span>`}
function renderStrength(){
 const sess=allSessions(),names=exerciseNames(),sel=$("strEx");
 const cur=sel.value&&names.includes(sel.value)?sel.value:(names.find(n=>sess[n])||names[0]);
 sel.innerHTML=names.map(n=>`<option value="${esc(n)}" ${n===cur?"selected":""}>${esc(n)}${sess[n]?" ("+sess[n].length+")":""}</option>`).join("");
 const arr=sess[cur]||[],metric=$("strMetric").value;
 const pick={top:s=>s.top,e1rm:s=>s.e1rm,vol:s=>s.vol,reps:s=>s.reps}[metric],unit={top:"kg",e1rm:"kg",vol:"kg",reps:""}[metric];
 const vals=arr.map(pick),svg=$("strChart");
 if(arr.length<1){chartEmpty(svg,"Complete some sets to see progress");$("strNote").textContent="Tick sets as completed in the Workout tab and your progression will appear here."}
 else{chartLine(svg,arr.map(s=>fmtDate(s.date)),vals,{unit,dec:metric==="reps"?0:1});$("strNote").textContent=arr.length<2?"Log this exercise again to see a trend line.":`${arr.length} sessions · change since first: ${vals[vals.length-1]-vals[0]>=0?"+":""}${fmtN(vals[vals.length-1]-vals[0],1)} ${unit}`}
 const best=arr.length?Math.max(...arr.map(s=>s.top)):0,bestE=arr.length?Math.max(...arr.map(s=>s.e1rm)):0,bestV=arr.length?Math.max(...arr.map(s=>s.vol)):0;
 $("strStats").innerHTML=`<div><b>${arr.length}</b><span>SESSIONS</span></div><div><b>${fmtN(best,1)}</b><span>BEST kg</span></div><div><b>${fmtN(bestE,1)}</b><span>EST. 1RM</span></div><div><b>${fmtN(bestV)}</b><span>BEST VOL</span></div>`;
 /* previous vs current */
 const c=$("strCompare");
 if(arr.length<2){c.className="empty";c.innerHTML="Log this exercise in at least two workouts to compare."}
 else{
  const A=arr[arr.length-2],B=arr[arr.length-1],n=Math.max(A.sets.length,B.sets.length);let rows="";
  for(let k=0;k<n;k++){const a=A.sets[k],b=B.sets[k];rows+=`<tr><td>${k+1}</td><td>${a?esc(setStr(A.type,a)):"–"}</td><td>${b?esc(setStr(B.type,b)):"–"}</td><td class="r">${a&&b?(B.type==="time"?deltaHtml(a.r,b.r,"s",0):deltaHtml(a.w*a.r,b.w*b.r," kg",0)):""}</td></tr>`}
  c.className="";c.innerHTML=`<table><thead><tr><th>Set</th><th>Previous (${fmtDate(A.date)})</th><th>Current (${fmtDate(B.date)})</th><th class="r">Change</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="3">Total volume</th><th class="r">${fmtN(A.vol)} → ${fmtN(B.vol)} kg ${A.vol?`(${B.vol-A.vol>=0?"+":""}${fmtN((B.vol-A.vol)/A.vol*100,0)}%)`:""}</th></tr></tfoot></table>`;
 }
 $("strCount").textContent=arr.length+" sessions";
 $("strTable").className=arr.length?"":"empty";
 $("strTable").innerHTML=arr.length?`<table><thead><tr><th>Date</th><th>Sets (weight × reps)</th><th class="r">Volume</th></tr></thead><tbody>${arr.slice().reverse().map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${esc(sessionStr(s))}</td><td class="r">${s.vol?fmtN(s.vol):"–"}</td></tr>`).join("")}</tbody></table>`:"No completed sets yet.";
}

/* ---- Volume / consistency tab ---- */
function trainedDates(){
 const out={};
 for(const [key,log] of Object.entries(data.logs)){
  const date=key.split("_")[0];let sets=0,vol=0;
  for(const l of Object.values(log.lifts||{})){if(!l||!Array.isArray(l.sets))continue;l.sets.forEach(s=>{if(s.done){sets++;vol+=setVolume(l.type||"machine",s)}})}
  if(log.finished||sets>0){const o=out[date]=out[date]||{sets:0,vol:0};o.sets+=sets;o.vol+=vol}
 }
 return out;
}
function weeklyStats(n){
 const td=trainedDates(),ws0=weekStart(today()),weeks=[];
 for(let k=n-1;k>=0;k--)weeks.push({start:addDays(ws0,-7*k),sessions:0,sets:0,vol:0});
 const byStart={};weeks.forEach(w=>byStart[w.start]=w);
 for(const [date,o] of Object.entries(td)){const w=byStart[weekStart(date)];if(w){w.sessions++;w.sets+=o.sets;w.vol+=o.vol}}
 return weeks;
}
function renderVolume(){
 const weeks=weeklyStats(12),cur=weeks[weeks.length-1];
 $("weekStats").innerHTML=`<div><b>${cur.sessions}</b><span>WORKOUTS</span></div><div><b>${cur.sets}</b><span>SETS DONE</span></div><div><b>${fmtN(cur.vol)}</b><span>VOLUME kg</span></div><div><b>${fmtN(Object.values(allSessions()).reduce((a,arr)=>a+arr.reduce((b,s)=>b+s.sets.length,0),0))}</b><span>ALL-TIME SETS</span></div>`;
 const prevW=weeks[weeks.length-2];
 $("weekNote").textContent=prevW&&prevW.vol?`Last week: ${fmtN(prevW.vol)} kg → this week ${fmtN(cur.vol)} kg (${cur.vol>=prevW.vol?"+":""}${fmtN((cur.vol-prevW.vol)/prevW.vol*100,0)}%). Weeks run Monday–Sunday.`:"Weeks run Monday–Sunday.";
 chartBars($("volChart"),weeks.map(w=>fmtDate(w.start)),weeks.map(w=>Math.round(w.vol)),{empty:"Complete sets to see weekly volume"});
 /* consistency */
 const td=trainedDates(),start=data.settings.startDate;let planned=0,done=0;
 for(let d=start,n=0;d<=today()&&n<400;d=addDays(d,1),n++){if(dayIndex(d)!==6)planned++;if(td[d])done++}
 const pct=planned?Math.min(100,Math.round(done/planned*100)):0;
 $("consPill").textContent=planned?pct+"% consistent":"–";
 chartBars($("consChart"),weeks.map(w=>fmtDate(w.start)),weeks.map(w=>w.sessions),{target:6,empty:"Finish workouts to see consistency"});
 $("consNote").textContent=planned?`${done} training days logged out of ${planned} planned since ${fmtDate(start)} (six training days per week). A day counts once you finish the workout or complete a set.`:"Your programme starts on "+fmtDate(start)+".";
 /* weekly table */
 const rows=weeks.slice().reverse().filter(w=>w.sessions||w.sets);
 $("weekTable").className=rows.length?"":"empty";
 $("weekTable").innerHTML=rows.length?`<table><thead><tr><th>Week of</th><th class="r">Workouts</th><th class="r">Sets</th><th class="r">Volume (kg)</th></tr></thead><tbody>${rows.map(w=>`<tr><td>${fmtDate(w.start)}</td><td class="r">${w.sessions}</td><td class="r">${w.sets}</td><td class="r">${fmtN(w.vol)}</td></tr>`).join("")}</tbody></table>`:"No completed sets yet.";
 renderWorkoutCompare();
}
function logStats(key,log){
 const di=Number(key.split("_")[1]),per={};let vol=0,sets=0;
 for(const [i,l] of Object.entries(log.lifts||{})){
  if(!l||!Array.isArray(l.sets))continue;const def=exDef(di,Number(i)),name=l.name||(def&&def[0]);if(!name)continue;
  const dn=l.sets.filter(s=>s.done);if(!dn.length)continue;
  const v=dn.reduce((a,s)=>a+setVolume(l.type||"machine",s),0);per[name]={vol:v,sets:dn.length,reps:dn.reduce((a,s)=>a+num(s.r),0)};vol+=v;sets+=dn.length;
 }
 return {vol,sets,per};
}
function renderWorkoutCompare(){
 const di=Number($("cmpDay").value||0),box=$("cmpTable");
 const logs=Object.entries(data.logs).filter(([k])=>Number(k.split("_")[1])===di).map(([k,l])=>({date:k.split("_")[0],key:k,s:logStats(k,l)})).filter(x=>x.s.sets>0).sort((a,b)=>a.date.localeCompare(b.date));
 if(logs.length<2){box.className="empty";box.style.marginTop="8px";box.textContent=logs.length?"Only one session logged for this day so far — complete it again next week to compare.":"Complete this workout at least twice to compare.";return}
 const A=logs[logs.length-2],B=logs[logs.length-1],names=[...new Set([...Object.keys(A.s.per),...Object.keys(B.s.per)])];
 box.className="";
 box.innerHTML=`<table><thead><tr><th>Exercise</th><th class="r">${fmtDate(A.date)}</th><th class="r">${fmtDate(B.date)}</th><th class="r">Change</th></tr></thead><tbody>${names.map(n=>{const a=A.s.per[n],b=B.s.per[n];const av=a?a.vol:0,bv=b?b.vol:0;const useReps=(a&&!a.vol)||(b&&!b.vol);return `<tr><td>${esc(n)}</td><td class="r">${a?(useReps&&!a.vol?a.reps+" reps":fmtN(av)):"–"}</td><td class="r">${b?(useReps&&!b.vol?b.reps+" reps":fmtN(bv)):"–"}</td><td class="r">${useReps&&(!av||!bv)?"":deltaHtml(av,bv,"",0)}</td></tr>`}).join("")}</tbody><tfoot><tr><th>Total volume (kg)</th><th class="r">${fmtN(A.s.vol)}</th><th class="r">${fmtN(B.s.vol)}</th><th class="r">${deltaHtml(A.s.vol,B.s.vol,"",0)}</th></tr><tr><th>Sets completed</th><th class="r">${A.s.sets}</th><th class="r">${B.s.sets}</th><th class="r">${deltaHtml(A.s.sets,B.s.sets,"",0)}</th></tr></tfoot></table>`;
}

/* ====================================================================================
   SETTINGS / BACKUP
   ==================================================================================== */
const SETTING_NUMS=[["startWeight",77,true],["proteinTarget",125],["calorieTarget",2200],["carbTarget",250],["fatTarget",70],["fibreTarget",30],["calciumTarget",1000],["ironTarget",19],["potassiumTarget",3500],["sodiumLimit",2000],["magnesiumTarget",420],["vitCTarget",80]];
function renderSettings(){
 for(let k of ["startWeight","proteinTarget","startDate","weeks","calorieTarget","carbTarget","fatTarget","fibreTarget","calciumTarget","ironTarget","potassiumTarget","sodiumLimit","magnesiumTarget","vitCTarget","aiEndpoint"])$(k).value=data.settings[k]==null?"":data.settings[k];
}
function saveSettings(quiet){
 SETTING_NUMS.forEach(([k,def])=>{const v=Number($(k).value);data.settings[k]=v>0?v:def});
 data.settings.startDate=$("startDate").value||today();
 data.settings.weeks=Math.max(1,Math.min(52,Number($("weeks").value||12)));
 data.settings.aiEndpoint=($("aiEndpoint").value||"").trim();
 persist();renderHome();if(quiet===true)toast("Saved");else alert("Settings saved.");
}
function exportData(){flushSave();let blob=new Blob([JSON.stringify({app:"FITTRACK 12",version:2,exportedAt:new Date().toISOString(),data},null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="fittrack12-backup-"+today()+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function importData(e){
 let f=e.target.files[0];if(!f)return;let r=new FileReader();
 r.onload=()=>{try{let obj=JSON.parse(r.result),incoming=obj.data||obj;if(!incoming.settings||!incoming.logs)throw Error();
   if(!confirm("Restore this backup? Current app data will be replaced."))return;
   try{localStorage.setItem(KEY+"_before_restore",JSON.stringify(data))}catch(_){}
   data=normalize(incoming);persist();show("home");alert("Backup restored. Older backups are upgraded automatically to the new set-based format.")}
  catch(err){alert("This file doesn't look like a valid FITTRACK 12 backup.")}};
 r.readAsText(f);e.target.value="";
}
function clearData(){if(!confirm("Permanently clear all FITTRACK 12 data on this device? Export a backup first if needed."))return;data=blank();try{localStorage.removeItem(PRE_KEY);localStorage.removeItem(KEY+"_before_restore")}catch(e){}persist();show("home")}

/* ---- PWA install button ---- */
let deferredInstall=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;const b=$("installBtn");if(b)b.hidden=false});
window.addEventListener("appinstalled",()=>{deferredInstall=null;const b=$("installBtn");if(b)b.hidden=true;toast("FITTRACK 12 installed")});
async function doInstall(){if(!deferredInstall)return;deferredInstall.prompt();try{await deferredInstall.userChoice}catch(e){}deferredInstall=null;$("installBtn").hidden=true}

/* ====================================================================================
   START
   ==================================================================================== */
function init(){
 initWorkout();
 if(typeof initNutrition==="function")initNutrition();
 renderHome();renderWorkout();$("measureDate").value=today();
 const p=new URLSearchParams(location.search).get("screen");
 if(p&&["home","workout","progress","nutrition","settings"].includes(p))show(p);
 if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
 offerSnapshotRestore();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
