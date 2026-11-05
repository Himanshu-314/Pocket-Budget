/* FITTRACK 12 service worker - offline-first app shell.
   Bump CACHE whenever you change any cached file so phones fetch the update. */
const CACHE="fittrack12-cache-v5";
const FILES=["./","./index.html","./app.js","./nutrition.js","./foods.js","./manifest.webmanifest","./icon.svg",
"./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png",
"./assets/bench-press.jpg","./assets/incline-press.jpg","./assets/pec-deck.jpg","./assets/triceps-pushdown.jpg","./assets/overhead-extension.jpg","./assets/shoulder-press.jpg","./assets/squat.jpg","./assets/lat-pulldown.jpg","./assets/row.jpg","./assets/leg-work.jpg","./assets/recovery.jpg",
"./assets/exercise/lat-pulldown.jpg","./assets/exercise/chest-supported-row.jpg","./assets/exercise/seated-cable-row.jpg","./assets/exercise/incline-dumbbell-curl.jpg","./assets/exercise/cable-biceps-curl.jpg","./assets/exercise/seated-dumbbell-shoulder-press.jpg","./assets/exercise/dumbbell-lateral-raises.jpg","./assets/exercise/reverse-pec-deck.jpg","./assets/exercise/ez-bar-curl.jpg","./assets/exercise/hammer-curl.jpg","./assets/exercise/squats.jpg","./assets/exercise/leg-press.jpg","./assets/exercise/leg-extension.jpg","./assets/exercise/leg-curl.jpg","./assets/exercise/standing-calf-raises.jpg","./assets/exercise/hanging-knee-raises.jpg","./assets/exercise/plank.jpg","./assets/exercise/incline-chest-press-machine.jpg","./assets/exercise/flat-dumbbell-press.jpg","./assets/exercise/cable-chest-fly.jpg","./assets/exercise/romanian-deadlift.jpg","./assets/exercise/bulgarian-split-squat.jpg","./assets/exercise/lying-leg-curl.jpg","./assets/exercise/hip-thrust.jpg","./assets/exercise/calf-raises.jpg","./assets/exercise/cable-crunch.jpg","./assets/exercise/reverse-crunch.jpg","./assets/exercise/barbell-bench-press.jpg","./assets/exercise/incline-dumbbell-press.jpg","./assets/exercise/pec-deck-fly.jpg","./assets/exercise/rope-triceps-pushdown.jpg","./assets/exercise/overhead-cable-extension.jpg"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(FILES.map(f=>c.add(f)))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET")return;                       /* AI requests are POST -> never cached */
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;             /* never touch other sites / your AI service */
  /* stale-while-revalidate: instant offline start, silently refreshed in the background */
  e.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(req,{ignoreSearch:true});
    const net=fetch(req).then(resp=>{if(resp&&resp.ok)cache.put(req,resp.clone());return resp}).catch(()=>null);
    if(cached){e.waitUntil(net);return cached}
    const resp=await net;
    return resp||(req.mode==="navigate"?cache.match("./index.html"):Response.error());
  }));
});
