import ABCJS from "abcjs";
import { recognizeScore, PROVIDERS } from "./omr.js";

const SAMPLES = {
  twinkle: `X:1
T:小星星
M:4/4
L:1/4
Q:1/4=96
K:C
C C G G | A A G2 | F F E E | D D C2 |
G G F F | E E D2 | G G F F | E E D2 |
C C G G | A A G2 | F F E E | D D C2 |]`,
  ode: `X:1
T:快樂頌
C:Beethoven
M:4/4
L:1/4
Q:1/4=108
K:D
F F G A | A G F E | D D E F | F>E E2 |
F F G A | A G F E | D D E F | E>D D2 |
E E F D | E F/G/ F D | E F/G/ F E | D E A,2 |
F F G A | A G F E | D D E F | E>D D2 |]`,
  minuet: `X:1
T:G 大調小步舞曲
C:Petzold
M:3/4
L:1/8
Q:1/4=110
K:G
d2 G A B c | d2 G2 G2 | e2 c d e f | g2 G2 G2 |
c2 d c B A | B2 c B A G | F2 G A B G | A6 |
d2 G A B c | d2 G2 G2 | e2 c d e f | g2 G2 G2 |
c2 d c B A | B2 c B A G | A2 B A G F | G6 |]`
};

const $ = id => document.getElementById(id);
const store = {
  get(k){ try{ return localStorage.getItem(k) }catch(e){ return null } },
  set(k,v){ try{ localStorage.setItem(k,v) }catch(e){} }
};
const NAMES = ["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const noteName = m => NAMES[((m%12)+12)%12] + (Math.floor(m/12)-1);
const pcOf = m => ((m%12)+12)%12;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmtTime = ms => { const s = Math.round(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}` };

/* ---------- state ---------- */
const S = {
  events:[], idx:-1, mode:"idle", lastPc:null, startT:0, startMs:0, viewMs:0, particles:[], rings:[],
  baseBpm:120, lastMeasure:1,
  run:{ t0:null, hits:[], miss:{}, times:[] },
  loop:{ on:false, a:1, b:4, laps:1 }
};

/* ---------- score ---------- */
function titleOf(abc){ return ((abc.match(/^T:(.*)$/m) || [])[1] || "").trim() || "未命名" }

// Phones reflow to two bars per line so notes and their names stay readable; wider screens keep the ABC line breaks.
const narrowScore = () => $("score").clientWidth < 620;
function renderScore(abc){
  const opts = { add_classes:true, paddingtop:4, paddingbottom:30, clickListener: onScoreClick };
  if(narrowScore()){
    S.layout = "narrow";
    Object.assign(opts, { staffwidth: Math.max(240, $("score").clientWidth - 24), wrap:{ minSpacing:1.6, maxSpacing:2.6, preferredMeasuresPerLine:2 } });
  } else { S.layout = "wide"; opts.responsive = "resize" }
  const vis = ABCJS.renderAbc("score", abc, opts)[0];
  try{ vis.setUpAudio && vis.setUpAudio() }catch(e){}
  let timings = [];
  try{ timings = vis.setTiming() || vis.noteTimings || [] }catch(e){}
  try{ S.baseBpm = Math.round(vis.getBpm ? vis.getBpm() : 120) || 120 }catch(e){ S.baseBpm = 120 }
  S.events = timings.filter(e => e.type === "event").map(e => ({
    ms: e.milliseconds,
    pitches: (e.midiPitches || []).map(p => p.pitch).filter(p => p != null),
    els: (e.elements || []).flat().filter(Boolean),
    measure: (e.measureNumber ?? 0) + 1,
    top: e.top, height: e.height
  }));
  readKey(vis);
  drawLabels();
  for(let i=0;i<S.events.length;i++){
    const n = S.events[i+1];
    S.events[i].dur = n ? n.ms - S.events[i].ms : 600;
  }
}

function loadAbc(abc){
  $("abcText").value = abc;
  store.set("scorelight.abc", abc);
  stopAll(); hideSummary();
  S.abc = abc;
  renderScore(abc);
  S.lastMeasure = S.events.length ? S.events[S.events.length-1].measure : 1;
  ["loopA","loopB"].forEach(id => $(id).max = S.lastMeasure);
  setLoop(false, 1, Math.min(4, S.lastMeasure));
  resetRun(); jumpTo(0, true);
  if(!S.events.length) say("這份譜沒有讀到任何音符，請檢查 ABC 內容。", true);
  else say(`已載入「${titleOf(abc)}」。點「示範播放」聽一次，或直接彈奏。`);
  sizeFx(); renderLib();
}

let relayoutTimer = null, lastScoreWidth = 0;
new ResizeObserver(() => {
  const w = $("score").clientWidth;
  if(!S.abc || Math.abs(w - lastScoreWidth) < 40) return;
  lastScoreWidth = w;
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    if(S.layout === "wide" && !narrowScore()) return;   // the wide layout scales itself
    const at = S.idx + 1;
    renderScore(S.abc); jumpTo(Math.min(at, S.events.length), true); sizeFx();
  }, 250);
}).observe($("scorebox"));

/* ---------- note names printed under the notes ---------- */
const SPELL = {
  sharp:{ letter:["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"], solfege:["Do","Do♯","Re","Re♯","Mi","Fa","Fa♯","Sol","Sol♯","La","La♯","Si"] },
  flat: { letter:["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"], solfege:["Do","Re♭","Re","Mi♭","Mi","Fa","Sol♭","Sol","La♭","La","Si♭","Si"] },
  mixed:{ letter:["C","C♯","D","E♭","E","F","F♯","G","G♯","A","B♭","B"], solfege:["Do","Do♯","Re","Mi♭","Mi","Fa","Fa♯","Sol","Sol♯","La","Si♭","Si"] }
};
const JIANPU = ["1","♯1","2","♭3","3","4","♯4","5","♯5","6","♭7","7"];
S.labelMode = store.get("scorelight.labels") || "solfege";
S.spell = "mixed"; S.tonic = 0;
function readKey(vis){
  S.spell = "mixed"; S.tonic = 0;
  try{
    const k = vis.getKeySignature();
    const accs = k.accidentals || [];
    if(accs.some(a => a.acc === "sharp")) S.spell = "sharp"; else if(accs.some(a => a.acc === "flat")) S.spell = "flat";
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[(k.root || "C").toUpperCase()] ?? 0;
    const acc = k.acc === "#" ? 1 : k.acc === "b" ? -1 : 0;
    const minor = /^m(in)?$/i.test(k.mode || "");
    S.tonic = pcOf(base + acc + (minor ? 3 : 0));   // minor keys use the relative-major "1", so the tonic sings as 6
  }catch(e){}
}
function labelFor(m){
  if(S.labelMode === "jianpu") return JIANPU[pcOf(m - S.tonic)];
  return SPELL[S.spell][S.labelMode === "letter" ? "letter" : "solfege"][pcOf(m)];
}
function drawLabels(){
  document.querySelectorAll("#score .sl-label").forEach(t => { t.remove() });
  S.events.forEach(e => { e.els = e.els.filter(el => !el.classList.contains("sl-label")) });
  if(S.labelMode === "off") return;
  const NS = "http://www.w3.org/2000/svg";
  S.events.forEach(e => {
    const head = e.els.find(el => el.classList.contains("abcjs-note")) || e.els[0];
    if(!head || !e.pitches.length) return;
    let bb; try{ bb = head.getBBox() }catch(err){ return }
    const x = bb.x + bb.width/2;
    const base = (e.top != null && e.height != null) ? e.top + e.height + 14 : bb.y + bb.height + 14;
    [...e.pitches].sort((a,b) => b-a).forEach((p, n) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x); t.setAttribute("y", base + n*12);
      t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "11");
      t.setAttribute("class", "sl-label"); t.textContent = labelFor(p);
      head.parentNode.appendChild(t); e.els.push(t);
    });
  });
}

function nextPlayable(from){
  for(let i=Math.max(0,from);i<S.events.length;i++) if(S.events[i].pitches.length) return i;
  return -1;
}
function firstOfMeasure(m){ const i = S.events.findIndex(e => e.measure >= m); return i < 0 ? 0 : i }
function rangeStart(){ return S.loop.on ? firstOfMeasure(S.loop.a) : 0 }
function inRange(i){ return !S.loop.on || (S.events[i].measure >= S.loop.a && S.events[i].measure <= S.loop.b) }

// Move the cursor so event i is the next one to play; everything before it shows as played.
function jumpTo(i, quiet){
  S.events.forEach((e,k) => e.els.forEach(el => {
    el.classList.remove("sl-cur","sl-miss","sl-missed");
    el.classList.toggle("sl-done", k < i);
  }));
  S.idx = i-1; S.lastPc = null;
  if(S.mode === "play" && S.events[i]){ S.startMs = S.events[i].ms; S.startT = performance.now(); S.viewMs = S.startMs }
  markCurrent(quiet); updateStats();
}

function onScoreClick(abcelem){
  const els = abcelem?.abselem?.elemset || [];
  const i = S.events.findIndex(ev => ev.els.some(el => els.includes(el)));
  if(i < 0) return;
  hideSummary(); resetRun();
  if(S.loop.on && !inRange(i)) setLoop(false);
  jumpTo(i);
  say(`從第 ${S.events[i].measure} 小節開始。`);
}

function markCurrent(quiet){
  document.querySelectorAll("#score .sl-cur").forEach(el => el.classList.remove("sl-cur"));
  document.querySelectorAll(".key.hint").forEach(k => k.classList.remove("hint"));
  const t = nextPlayable(S.idx+1);
  if(t < 0) return;
  S.events[t].els.forEach(el => el.classList.add("sl-cur"));
  if(S.run.miss[t]) S.events[t].els.forEach(el => el.classList.add("sl-miss"));
  S.events[t].pitches.forEach(p => keyEl(p)?.classList.add("hint"));
  if(!quiet) scrollIntoScore(S.events[t]);
}

function advanceTo(i, hit){
  for(let k=S.idx+1;k<=i;k++) S.events[k].els.forEach(el => {
    el.classList.remove("sl-cur","sl-miss"); el.classList.add("sl-done");
    if(S.run.miss[k]) el.classList.add("sl-missed");
  });
  S.idx = i;
  if(hit){
    burst(S.events[i], false);
    if(S.mode !== "play"){
      const now = performance.now();
      if(S.run.t0 == null) S.run.t0 = now;
      S.run.hits.push(i); S.run.times.push({ i, t:now });
    }
  }
  markCurrent(); updateStats();
  const nx = nextPlayable(S.idx+1);
  if(S.loop.on && (nx < 0 || S.events[nx].measure > S.loop.b)) return lapDone();
  if(nx < 0 && S.mode !== "play") finishRun("整首完成");
}

function lapDone(){
  if(S.mode === "play"){ jumpTo(rangeStart()); return }
  finishRun(`第 ${S.loop.a}–${S.loop.b} 小節・第 ${S.loop.laps} 遍`);
  S.loop.laps++; $("lapN").textContent = S.loop.laps;
  resetRun(); jumpTo(rangeStart());
}

/* ---------- run statistics ---------- */
function resetRun(){ S.run = { t0:null, hits:[], miss:{}, times:[] }; updateStats() }

function registerMiss(midi){
  const t = nextPlayable(S.idx+1); if(t < 0) return;
  S.run.miss[t] = (S.run.miss[t] || 0) + 1;
  if(S.run.t0 == null) S.run.t0 = performance.now();
  S.events[t].els.forEach(el => el.classList.add("sl-miss"));
  burst(S.events[t], true);
  say(`彈到 ${noteName(midi)}，下一個音是 ${S.events[t].pitches.map(noteName).join(" + ")}。`);
  updateStats();
}

function playedBpm(times){
  let exp = 0, act = 0;
  for(let k=1;k<times.length;k++){
    const e = S.events[times[k].i].ms - S.events[times[k-1].i].ms, a = times[k].t - times[k-1].t;
    if(e <= 0 || a < e/4 || a > e*4) continue;   // skip pauses, jumps and accidental double hits
    exp += e; act += a;
  }
  return act > 0 ? Math.round(S.baseBpm * exp / act) : null;
}

function updateStats(){
  const t = nextPlayable(S.idx+1);
  const ev = S.events[t >= 0 ? t : Math.max(0,S.idx)];
  $("stMeasure").textContent = ev ? `${ev.measure} / ${S.lastMeasure}` : "–";
  const playable = S.events.filter((e,i) => e.pitches.length && inRange(i));
  const done = S.events.slice(0, S.idx+1).filter((e,i) => e.pitches.length && inRange(i)).length;
  $("stProg").textContent = `${done} / ${playable.length}`;
  const hits = S.run.hits.length, clean = S.run.hits.filter(i => !S.run.miss[i]).length;
  $("stAcc").textContent = hits ? `${Math.round(clean/hits*100)}%` : "–";
  const bpm = playedBpm(S.run.times.slice(-8));
  $("stBpm").textContent = bpm ? `${bpm} / ${S.baseBpm}` : `– / ${S.baseBpm}`;
}

function finishRun(title){
  const r = S.run; if(!r.hits.length) return;
  const clean = r.hits.filter(i => !r.miss[i]).length;
  const misses = Object.values(r.miss).reduce((a,b) => a+b, 0);
  const lo = S.loop.on ? S.loop.a : 1, hi = S.loop.on ? S.loop.b : S.lastMeasure;
  const per = {}; for(let m=lo;m<=hi;m++) per[m] = 0;
  Object.entries(r.miss).forEach(([i,c]) => { const m = S.events[i].measure; if(m in per) per[m] += c });
  const worst = Object.entries(per).sort((a,b) => b[1]-a[1])[0];
  $("sumTitle").textContent = `練習結果・${title}`;
  $("sumAcc").textContent = `${Math.round(clean/r.hits.length*100)}%`;
  $("sumMiss").textContent = misses;
  $("sumTime").textContent = fmtTime(performance.now() - r.t0);
  const bpm = playedBpm(r.times); $("sumBpm").textContent = bpm ? `${bpm}` : "–";
  const max = Math.max(1, ...Object.values(per));
  $("sumBars").innerHTML = "";
  Object.entries(per).forEach(([m,c]) => {
    const b = document.createElement("i"); b.style.height = `${8 + c/max*92}%`; b.title = `第 ${m} 小節：${c} 次`;
    if(c) b.classList.add("bad"); $("sumBars").appendChild(b);
  });
  const drill = $("sumDrill");
  if(worst && worst[1] > 0){
    const a = +worst[0], b = Math.min(a+1, S.lastMeasure);
    drill.hidden = false; drill.textContent = `練第 ${a}–${b} 小節`; drill.dataset.a = a; drill.dataset.b = b;
  } else drill.hidden = true;
  $("summary").hidden = false;
  say(misses ? `完成！一共錯 ${misses} 次。` : "完成！全部一次彈對。");
}
function hideSummary(){ $("summary").hidden = true }

/* ---------- loop / section practice ---------- */
function setLoop(on, a, b){
  if(a != null) S.loop.a = a; if(b != null) S.loop.b = b;
  S.loop.a = Math.max(1, Math.min(S.loop.a, S.lastMeasure));
  S.loop.b = Math.max(S.loop.a, Math.min(S.loop.b, S.lastMeasure));
  S.loop.on = on; S.loop.laps = 1;
  $("loopA").value = S.loop.a; $("loopB").value = S.loop.b;
  $("btnLoop").setAttribute("aria-pressed", String(on));
  $("lapChip").hidden = !on; $("lapN").textContent = 1;
  updateStats();
}
function enableLoop(a, b){
  hideSummary(); resetRun(); setLoop(true, a, b); jumpTo(rangeStart());
  say(`段落練習：第 ${S.loop.a}–${S.loop.b} 小節，彈完會自動回到起點。`);
}
function currentMeasure(){ const t = nextPlayable(S.idx+1); return t >= 0 ? S.events[t].measure : S.lastMeasure }

/* ---------- effects layer over the score ---------- */
const fx = $("fx"), fctx = fx.getContext("2d");
function sizeFx(){
  const sc = $("scorebox"), dpr = devicePixelRatio || 1;
  fx.width = sc.scrollWidth*dpr; fx.height = sc.scrollHeight*dpr;
  fx.style.width = sc.scrollWidth+"px"; fx.style.height = sc.scrollHeight+"px";
  fctx.setTransform(dpr,0,0,dpr,0,0);
}
new ResizeObserver(sizeFx).observe($("score"));

function scrollIntoScore(ev){
  const el = ev.els[0]; if(!el) return;
  const box = $("scorebox"), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  if(r.top < b.top + 30 || r.bottom > b.bottom - 30){
    box.scrollTo({ top: box.scrollTop + (r.top - b.top) - b.height*0.3, behavior: reduceMotion ? "auto" : "smooth" });
  }
}
function elCenter(ev){
  const box = $("scorebox").getBoundingClientRect(), sc = $("scorebox");
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  ev.els.forEach(el => { if(el.classList.contains("sl-label")) return; const r = el.getBoundingClientRect(); if(!r.width && !r.height) return;
    x0=Math.min(x0,r.left); y0=Math.min(y0,r.top); x1=Math.max(x1,r.right); y1=Math.max(y1,r.bottom) });
  if(x0 === Infinity) return null;
  return { x:(x0+x1)/2 - box.left + sc.scrollLeft, y:(y0+y1)/2 - box.top + sc.scrollTop, w:x1-x0, h:y1-y0 };
}
function burst(ev, bad){
  const c = elCenter(ev); if(!c) return;
  S.rings.push({ x:c.x, y:c.y, r:6, a:1, bad });
  const n = reduceMotion || bad ? 0 : 16;
  for(let i=0;i<n;i++){
    const ang = Math.random()*Math.PI*2, sp = 1.2 + Math.random()*2.6;
    S.particles.push({ x:c.x, y:c.y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp - 1, life:1 });
  }
}

let colors = {};
function readColors(){
  const cs = getComputedStyle(document.documentElement);
  ["--hit","--done","--upcoming","--ink","--muted","--line","--accent","--miss","--band"].forEach(k => colors[k] = cs.getPropertyValue(k).trim());
}
readColors(); setInterval(readColors, 1000);

function drawFx(){
  fctx.clearRect(0,0,fx.width,fx.height);
  const t = nextPlayable(S.idx+1);
  if(t >= 0){
    const c = elCenter(S.events[t]);
    if(c){
      const pulse = reduceMotion ? 0 : (Math.sin(performance.now()/220)+1)*2;
      const col = S.run.miss[t] ? colors["--miss"] : colors["--hit"];
      fctx.strokeStyle = col; fctx.lineWidth = 2; fctx.globalAlpha = .9;
      const w = Math.max(c.w,14)+12+pulse, h = Math.max(c.h,40)+14+pulse;
      fctx.beginPath(); fctx.roundRect ? fctx.roundRect(c.x-w/2, c.y-h/2, w, h, 8) : fctx.rect(c.x-w/2,c.y-h/2,w,h); fctx.stroke();
      fctx.globalAlpha = .12; fctx.fillStyle = col; fctx.fill(); fctx.globalAlpha = 1;
    }
  }
  S.rings = S.rings.filter(r => (r.a -= .035) > 0);
  S.rings.forEach(r => { r.r += 2.2; fctx.globalAlpha = r.a; fctx.strokeStyle = r.bad ? colors["--miss"] : colors["--hit"]; fctx.lineWidth = 2;
    fctx.beginPath(); fctx.arc(r.x, r.y, r.r, 0, Math.PI*2); fctx.stroke() });
  S.particles = S.particles.filter(p => (p.life -= .025) > 0);
  S.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .06; fctx.globalAlpha = p.life; fctx.fillStyle = colors["--hit"];
    fctx.beginPath(); fctx.arc(p.x, p.y, 2.2, 0, Math.PI*2); fctx.fill() });
  fctx.globalAlpha = 1;
}

/* ---------- piano-roll ribbon ---------- */
const roll = $("roll"), rctx = roll.getContext("2d");
function drawRoll(){
  const dpr = devicePixelRatio || 1, W = roll.clientWidth, H = roll.clientHeight;
  if(roll.width !== W*dpr || roll.height !== H*dpr){ roll.width = W*dpr; roll.height = H*dpr }
  rctx.setTransform(dpr,0,0,dpr,0,0); rctx.clearRect(0,0,W,H);
  if(!S.events.length) return;
  let target;
  if(S.mode === "play") target = (performance.now() - S.startT) * S.rate + S.startMs;
  else { const t = nextPlayable(S.idx+1); target = t >= 0 ? S.events[t].ms : S.events[S.events.length-1].ms + 500 }
  S.viewMs += (target - S.viewMs) * (S.mode === "play" ? 1 : .15);
  const span = 6000, head = W*0.22, pxPerMs = W/span, X = ms => head + (ms - S.viewMs)*pxPerMs;
  const all = S.events.flatMap(e => e.pitches); const lo = Math.min(...all)-2, hi = Math.max(...all)+2;
  const yOf = p => 8 + (H-16) * (1 - (p-lo)/Math.max(1,hi-lo));
  const nh = Math.max(4, Math.min(10, (H-16)/Math.max(1,hi-lo)));
  if(S.loop.on){
    const a = S.events[firstOfMeasure(S.loop.a)], bi = S.events.findIndex(e => e.measure > S.loop.b);
    const end = bi < 0 ? S.events[S.events.length-1].ms + S.events[S.events.length-1].dur : S.events[bi].ms;
    rctx.fillStyle = colors["--band"]; rctx.fillRect(X(a.ms), 0, (end - a.ms)*pxPerMs, H);
  }
  rctx.strokeStyle = colors["--line"]; rctx.lineWidth = 1;
  let lastM = -1;
  S.events.forEach(e => { if(e.measure !== lastM){ lastM = e.measure; const x = X(e.ms);
    if(x>0 && x<W){ rctx.beginPath(); rctx.moveTo(x,0); rctx.lineTo(x,H); rctx.stroke() } } });
  const cur = nextPlayable(S.idx+1);
  S.events.forEach((e,i) => {
    const x = X(e.ms), w = Math.max(3, e.dur*pxPerMs - 2);
    if(x + w < 0 || x > W) return;
    rctx.fillStyle = S.run.miss[i] ? colors["--miss"] : i <= S.idx ? colors["--done"] : i === cur ? colors["--hit"] : colors["--upcoming"];
    e.pitches.forEach(p => { rctx.beginPath(); rctx.roundRect ? rctx.roundRect(x, yOf(p)-nh/2, w, nh, 3) : rctx.rect(x,yOf(p)-nh/2,w,nh); rctx.fill() });
  });
  rctx.strokeStyle = colors["--hit"]; rctx.lineWidth = 2;
  rctx.beginPath(); rctx.moveTo(head,0); rctx.lineTo(head,H); rctx.stroke();
  if(S.heard != null){
    rctx.fillStyle = colors["--ink"]; rctx.beginPath(); rctx.arc(head, yOf(Math.max(lo, Math.min(hi, S.heard))), 4, 0, Math.PI*2); rctx.fill();
  }
}

/* ---------- audio out ---------- */
let actx = null;
function audio(){ if(!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if(actx.state === "suspended") actx.resume(); return actx }
function tone(midi, durMs){
  const a = audio(), t = a.currentTime, f = 440*Math.pow(2,(midi-69)/12);
  const o = a.createOscillator(), g = a.createGain();
  o.type = "triangle"; o.frequency.value = f;
  const d = Math.min(Math.max(durMs/1000, .15), 2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22, t+.01); g.gain.exponentialRampToValueAtTime(.001, t+d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t+d+.05);
}

/* ---------- demo playback ---------- */
function startPlay(){
  if(!S.events.length) return;
  stopMic(); audio(); hideSummary();
  const nx = nextPlayable(S.idx+1);
  if(nx < 0 || !inRange(nx)) jumpTo(rangeStart());
  S.mode = "play"; S.rate = $("tempo").value/100;
  const from = Math.max(0, S.idx+1);
  S.startMs = S.events[from].ms; S.viewMs = S.startMs; S.startT = performance.now();
  $("btnPlay").textContent = "暫停";
}
function stopPlay(){ if(S.mode === "play"){ S.mode = "idle"; $("btnPlay").textContent = "示範播放" } }
function tickPlay(){
  if(S.mode !== "play") return;
  for(let guard=0; guard<64 && S.mode === "play"; guard++){
    const now = (performance.now() - S.startT) * S.rate + S.startMs;
    const e = S.events[S.idx+1];
    if(!e){
      const last = S.events[S.events.length-1];
      if(now > last.ms + last.dur){ stopPlay(); say("播放完畢。換你彈一次看看。") }
      return;
    }
    if(e.ms > now) return;
    e.pitches.forEach(p => tone(p, e.dur / S.rate));
    advanceTo(S.idx+1, e.pitches.length > 0);
  }
}

/* ---------- score following ---------- */
function heardNote(midi){
  if(S.mode === "play") return false;
  const pc = pcOf(midi);
  let k = S.idx, looked = 0;
  while(looked < 3){
    k = nextPlayable(k+1); if(k < 0) break; looked++;
    if(S.loop.on && S.events[k].measure > S.loop.b) break;
    if(S.events[k].pitches.some(p => pcOf(p) === pc)){
      S.lastPc = pc; advanceTo(k, true); return true;
    }
  }
  return false;
}

/* ---------- microphone pitch tracking ---------- */
const M = { stream:null, an:null, buf:null, stable:0, cand:null, armed:true, rmsHist:[], quiet:0, gate:0.012, lock:null };
const gateFromSlider = v => 0.05 * Math.pow(0.7, v);   // 1 → 0.035 (deaf) … 10 → 0.0014 (very sensitive)
async function startMic(){
  stopPlay(); hideSummary();
  if(!navigator.mediaDevices?.getUserMedia){ say("這個瀏覽器不支援麥克風，可以改用下方琴鍵。", true); return }
  try{
    M.stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
  }catch(e){
    say("無法使用麥克風。請在瀏覽器或系統設定允許麥克風權限，或改用下方琴鍵。", true); return;
  }
  const a = audio(), src = a.createMediaStreamSource(M.stream);
  M.an = a.createAnalyser(); M.an.fftSize = 2048; M.buf = new Float32Array(M.an.fftSize);
  src.connect(M.an);
  S.mode = "mic"; $("btnMic").setAttribute("aria-pressed","true"); $("micRow").hidden = false;
  try{ M.lock = await navigator.wakeLock?.request("screen") }catch(e){ M.lock = null }
  say("正在聆聽…開始演奏吧。");
}
function stopMic(){
  if(M.stream){ M.stream.getTracks().forEach(t => t.stop()); M.stream = null }
  try{ M.lock?.release() }catch(e){} M.lock = null;
  if(S.mode === "mic") S.mode = "idle";
  $("btnMic").setAttribute("aria-pressed","false"); $("micRow").hidden = true; S.heard = null;
}
function detectPitch(buf, sr, gate){
  let rms = 0; for(const v of buf) rms += v*v; rms = Math.sqrt(rms/buf.length);
  if(rms < gate) return { f:-1, rms };
  let r1 = 0, r2 = buf.length-1; const th = 0.2;
  for(let i=0;i<buf.length/2;i++) if(Math.abs(buf[i]) < th){ r1 = i; break }
  for(let i=1;i<buf.length/2;i++) if(Math.abs(buf[buf.length-i]) < th){ r2 = buf.length-i; break }
  const b = buf.slice(r1, r2), n = b.length, c = new Float32Array(n);
  for(let i=0;i<n;i++) for(let j=0;j<n-i;j++) c[i] += b[j]*b[j+i];
  let d = 0; while(d < n-1 && c[d] > c[d+1]) d++;
  let mx = -1, mp = -1; for(let i=d;i<n;i++) if(c[i] > mx){ mx = c[i]; mp = i }
  if(mp <= 0 || mp >= n-1) return { f:-1, rms };
  const x1 = c[mp-1], x2 = c[mp], x3 = c[mp+1], A = (x1+x3-2*x2)/2, B = (x3-x1)/2;
  const T0 = A ? mp - B/(2*A) : mp;
  return { f: sr/T0, rms };
}
function tickMic(){
  if(S.mode !== "mic" || !M.an) return;
  M.an.getFloatTimeDomainData(M.buf);
  const { f, rms } = detectPitch(M.buf, actx.sampleRate, M.gate);
  const lvl = Math.min(1, Math.sqrt(rms/0.25));
  $("meter").style.width = `${lvl*100}%`; $("meter").classList.toggle("loud", rms >= M.gate);
  M.rmsHist.push(rms); if(M.rmsHist.length > 8) M.rmsHist.shift();
  const minRecent = Math.min(...M.rmsHist.slice(0,-1));
  if(rms > M.gate*2 && rms > minRecent*1.8) M.armed = true;      // fresh attack, e.g. a repeated note
  if(f < 50 || f > 2200){
    if(++M.quiet >= 2) M.armed = true;
    M.cand = null; M.stable = 0; S.heard = null;
    $("stPitch").textContent = "—"; return;
  }
  M.quiet = 0;
  const mf = 69 + 12*Math.log2(f/440), midi = Math.round(mf), cents = Math.round((mf-midi)*100);
  S.heard = midi;
  $("stPitch").textContent = `${noteName(midi)} ${cents>=0?"+":""}${cents}¢`;
  $("tunerNeedle").style.left = `calc(${50 + cents}% - 2px)`;
  if(midi === M.cand) M.stable++; else { M.cand = midi; M.stable = 1 }
  if(pcOf(midi) !== S.lastPc) M.armed = true;
  if(!M.armed) return;
  if(M.stable >= 3 && heardNote(midi)) { M.armed = false; return }
  if(M.stable === 6){ registerMiss(midi); M.armed = false }   // held a wrong note long enough to count
}

/* ---------- on-screen keyboard ---------- */
const LOW = 55, HIGH = 84;  // G3–C6
const KB = "awsedftgyhujk";  // C4..C5
function keyEl(m){ return document.querySelector(`.key[data-m="${m}"]`) }
function buildKeys(){
  const inner = $("keysInner"); inner.innerHTML = "";
  const isB = m => [1,3,6,8,10].includes(m%12);
  const whites = []; for(let m=LOW;m<=HIGH;m++) if(!isB(m)) whites.push(m);
  const ww = 100/whites.length;
  for(let m=LOW;m<=HIGH;m++){
    const k = document.createElement("div"); k.className = "key " + (isB(m) ? "b" : "w"); k.dataset.m = m;
    if(isB(m)){ const wi = whites.indexOf(m-1); k.style.left = `calc(${(wi+1)*ww}% - ${ww*0.3}%)`; k.style.width = `${ww*0.6}%` }
    else { k.style.left = `${whites.indexOf(m)*ww}%`; k.style.width = `${ww}%`; if(m%12===0) k.textContent = noteName(m) }
    k.addEventListener("pointerdown", ev => { ev.preventDefault(); press(m) });
    inner.appendChild(k);
  }
}
function press(m){
  tone(m, 500);
  if(S.mode === "play") return flash(m, "on");
  hideSummary();
  if(heardNote(m)) flash(m, "on");
  else if(nextPlayable(S.idx+1) >= 0){ flash(m, "bad"); registerMiss(m) }
}
function flash(m, cls){ const k = keyEl(m); if(k){ k.classList.add(cls); setTimeout(() => k.classList.remove(cls), 160) } }
document.addEventListener("keydown", e => {
  if(e.target.closest("textarea,input") || e.repeat || e.metaKey || e.ctrlKey) return;
  const i = KB.indexOf(e.key.toLowerCase()); if(i >= 0){ e.preventDefault(); press(60+i) }
});

/* ---------- my scores (per-browser library) ---------- */
function libRead(){ try{ return JSON.parse(store.get("scorelight.lib") || "[]") }catch(e){ return [] } }
function libWrite(l){ store.set("scorelight.lib", JSON.stringify(l.slice(0,30))) }
function saveToLib(abc){
  const title = titleOf(abc);
  libWrite([{ title, abc, at:Date.now() }, ...libRead().filter(x => x.title !== title)]);
  renderLib();
}
function renderLib(){
  const box = $("lib"), l = libRead(), cur = titleOf($("abcText").value);
  box.innerHTML = "";
  if(!l.length){ box.innerHTML = '<div class="empty">還沒有存過樂譜。拍照辨識的結果會自動存在這裡（只存在這個瀏覽器）。</div>'; return }
  l.forEach((x, n) => {
    const row = document.createElement("div"); row.className = "item";
    const open = document.createElement("button"); open.type = "button"; open.className = "sm"; open.textContent = x.title;
    if(x.title === cur) open.setAttribute("aria-pressed","true");
    open.onclick = () => loadAbc(x.abc);
    const del = document.createElement("button"); del.type = "button"; del.className = "sm"; del.textContent = "刪除";
    del.onclick = () => {
      if(del.dataset.armed){ libWrite(libRead().filter((_,k) => k !== n)); renderLib(); return }
      del.dataset.armed = "1"; del.textContent = "確定刪除"; del.classList.add("danger");
      setTimeout(() => { if(del.isConnected){ delete del.dataset.armed; del.textContent = "刪除"; del.classList.remove("danger") } }, 3000);
    };
    row.append(open, del); box.appendChild(row);
  });
}

/* ---------- photo → ABC via Claude or Gemini (your own API key) ---------- */
// Claude keeps the original storage keys so keys saved by earlier versions still work.
const STORE_KEYS = {
  claude: { key:"scorelight.key", model:"scorelight.model" },
  gemini: { key:"scorelight.gemini.key", model:"scorelight.gemini.model" }
};
const settings = {
  get provider(){ const p = store.get("scorelight.provider"); return PROVIDERS[p] ? p : "claude" },
  keyFor(p){ return store.get(STORE_KEYS[p].key) || "" },
  modelFor(p){ const m = store.get(STORE_KEYS[p].model); return PROVIDERS[p].models.some(x => x.id === m) ? m : PROVIDERS[p].models[0].id },
  get key(){ return this.keyFor(this.provider) },
  get model(){ return this.modelFor(this.provider) }
};
let omrCtl = null;

function canvasToImage(src, w, h, maxSide = 2000){
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w*s); c.height = Math.round(h*s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.9);
  return { mediaType:"image/jpeg", data:url.split(",")[1], url };
}
async function fileToImage(blob){
  const bmp = await createImageBitmap(blob, { imageOrientation:"from-image" });
  return canvasToImage(bmp, bmp.width, bmp.height);
}

const OMR_COPY = {
  cancelled:"已停止辨識。", no_key:"請先在「設定」貼上 {name} 的 API 金鑰。", bad_key:"{name} 的 API 金鑰無效，請到「設定」檢查。",
  forbidden:"這把金鑰沒有使用這個模型的權限，請到「設定」換一個模型。", bad_model:"找不到這個模型，請到「設定」換一個。",
  rate_limited:"請求太頻繁或達到用量上限（含免費額度），請稍後再試。", billing:"API 帳戶餘額不足，請到 {name} 的帳戶頁面儲值。",
  offline:"連不上網路，辨識需要連線。", refused:"這張圖片無法辨識，請換一張樂譜照片。",
  too_long:"這頁樂譜太長，請一次拍半頁。", invalid:"辨識結果不完整，請換一張更清楚的照片再試，或在設定換一個模型。",
  bad_request:"圖片或請求有問題，請換一張照片再試。", server:"{name} 服務暫時有問題，請稍後再試。"
};
const omrCopy = (code, name) => (OMR_COPY[code] || "辨識失敗，請再試一次。").replaceAll("{name}", name);
function omrSay(t, err){ $("omrMsg").textContent = t; $("omrMsg").className = err ? "msg err" : "msg" }

async function recognize(image){
  const img = $("preview"); img.src = image.url; img.hidden = false;
  const provider = settings.provider, name = PROVIDERS[provider].name;
  if(!settings.key){ omrSay(omrCopy("no_key", name), true); openSettings(); return }
  omrCtl = new AbortController(); $("btnStop").hidden = false;
  omrSay(`辨識中…${name} 正在讀譜（約 30–60 秒）`);
  try{
    const out = await recognizeScore({ provider, apiKey:settings.key, model:settings.model, image, signal:omrCtl.signal });
    const abc = out.abc.trim();
    loadAbc(abc); saveToLib(abc);
    omrSay(`已辨識「${out.title || titleOf(abc)}」並存到我的樂譜。` + (out.notes ? ` ${out.notes}` : "") + " 有錯可在下方 ABC 修正後按「套用」。");
  }catch(e){
    omrSay(omrCopy(e.code, name), e.code !== "cancelled");
    if(e.code === "bad_key") openSettings();
  }finally{ $("btnStop").hidden = true; omrCtl = null }
}
$("fileIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if(!f) return;
  try{ recognize(await fileToImage(f)) }catch(err){ omrSay("這張圖片無法讀取，請換一張 JPG 或 PNG。", true) }
});
$("btnStop").addEventListener("click", () => omrCtl?.abort());

/* live camera viewfinder */
const cam = { stream:null, track:null, torch:false };
async function openCamera(){
  if(!navigator.mediaDevices?.getUserMedia){ omrSay("這個瀏覽器不支援相機，請改用「選擇圖片」。", true); return }
  try{
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio:false,
      video:{ facingMode:{ ideal:"environment" }, width:{ ideal:3840 }, height:{ ideal:2160 } } });
  }catch(e){ omrSay("無法開啟相機。請允許相機權限，或改用「選擇圖片」。", true); return }
  cam.track = cam.stream.getVideoTracks()[0];
  $("camVideo").srcObject = cam.stream;
  $("camTorch").hidden = !(cam.track.getCapabilities?.() || {}).torch;
  $("camDlg").showModal();
}
function closeCamera(){
  cam.stream?.getTracks().forEach(t => t.stop());
  cam.stream = null; cam.track = null; cam.torch = false;
  $("camVideo").srcObject = null; $("camTorch").setAttribute("aria-pressed","false");
  if($("camDlg").open) $("camDlg").close();
}
$("btnCam").addEventListener("click", openCamera);
$("camCancel").addEventListener("click", closeCamera);
$("camDlg").addEventListener("close", closeCamera);
$("camTorch").addEventListener("click", async () => {
  cam.torch = !cam.torch;
  try{ await cam.track.applyConstraints({ advanced:[{ torch:cam.torch }] }) }catch(e){ cam.torch = false }
  $("camTorch").setAttribute("aria-pressed", String(cam.torch));
});
$("camShot").addEventListener("click", () => {
  const v = $("camVideo"); if(!v.videoWidth) return;
  const image = canvasToImage(v, v.videoWidth, v.videoHeight);
  closeCamera(); recognize(image);
});

/* settings */
// The dialog edits a draft holding both providers, so switching back and forth keeps what was typed.
let draft = null;
$("setProvider").innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join("");
function showProvider(p){
  const info = PROVIDERS[p];
  draft.current = p; $("setProvider").value = p;
  $("setModel").innerHTML = info.models.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
  $("setModel").value = draft.models[p];
  $("setKey").value = draft.keys[p]; $("setKey").placeholder = info.keyPlaceholder;
  $("setKey").type = "password"; $("setShow").textContent = "顯示";
  $("setKeyLabel").textContent = `${info.name} API 金鑰`;
  $("setHelp").textContent = info.keyHelp;
}
function keepDraft(){
  draft.keys[draft.current] = $("setKey").value.trim(); draft.models[draft.current] = $("setModel").value;
}
function openSettings(){
  const ids = Object.keys(PROVIDERS);
  draft = {
    keys: Object.fromEntries(ids.map(p => [p, settings.keyFor(p)])),
    models: Object.fromEntries(ids.map(p => [p, settings.modelFor(p)]))
  };
  showProvider(settings.provider);
  if(!$("setDlg").open) $("setDlg").showModal();
}
$("setProvider").addEventListener("change", e => { keepDraft(); showProvider(e.target.value) });
$("btnSettings").addEventListener("click", openSettings);
$("setForm").addEventListener("submit", e => {
  e.preventDefault();
  keepDraft();
  for(const p of Object.keys(PROVIDERS)){ store.set(STORE_KEYS[p].key, draft.keys[p]); store.set(STORE_KEYS[p].model, draft.models[p]) }
  store.set("scorelight.provider", draft.current);
  $("setDlg").close();
  const name = PROVIDERS[settings.provider].name;
  omrSay(settings.key ? `設定已儲存，拍照辨識會使用 ${name}。` : `已儲存。尚未填 ${name} 的 API 金鑰，拍照辨識前請先填入。`);
});
$("setCancel").addEventListener("click", () => $("setDlg").close());
$("setShow").addEventListener("click", e => {
  const i = $("setKey"), show = i.type === "password";
  i.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "隱藏" : "顯示";
});

/* install + offline */
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("btnInstall").hidden = false });
$("btnInstall").addEventListener("click", async () => {
  if(!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice.catch(() => null);
  installEvt = null; $("btnInstall").hidden = true;
});
addEventListener("appinstalled", () => { $("btnInstall").hidden = true });
if(/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) $("iosHint").hidden = false;
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", async () => {
  if(document.visibilityState === "visible" && S.mode === "mic" && (!M.lock || M.lock.released)){
    try{ M.lock = await navigator.wakeLock?.request("screen") }catch(e){ M.lock = null }
  }
});

/* ---------- wiring ---------- */
function say(t, err){ const m = $("msg"); m.textContent = t; m.className = err ? "msg err" : "msg" }
function stopAll(){ stopPlay(); stopMic() }
$("btnPlay").addEventListener("click", () => S.mode === "play" ? stopPlay() : startPlay());
$("btnMic").addEventListener("click", () => S.mode === "mic" ? (stopMic(), say("已停止聆聽。")) : startMic());
$("btnReset").addEventListener("click", () => { stopPlay(); hideSummary(); resetRun(); jumpTo(rangeStart()); $("scorebox").scrollTo({top:0}); say("回到開頭。") });
$("btnFocus").addEventListener("click", e => {
  const on = document.body.classList.toggle("focus"); e.currentTarget.setAttribute("aria-pressed", String(on));
  store.set("scorelight.focus", on ? "1" : "");
});
$("btnApply").addEventListener("click", () => loadAbc($("abcText").value));
$("btnSave").addEventListener("click", () => { saveToLib($("abcText").value); say(`已存「${titleOf($("abcText").value)}」到我的樂譜。`) });
$("tempo").addEventListener("input", e => {
  $("tempoVal").textContent = e.target.value + "%";
  if(S.mode === "play"){ const now = (performance.now()-S.startT)*S.rate + S.startMs; S.startMs = now; S.startT = performance.now(); S.rate = e.target.value/100 }
});
$("labelMode").value = S.labelMode;
$("labelMode").addEventListener("change", e => {
  S.labelMode = e.target.value; store.set("scorelight.labels", S.labelMode);
  drawLabels(); jumpTo(S.idx+1, true);
});
$("gate").addEventListener("input", e => { M.gate = gateFromSlider(+e.target.value) });
M.gate = gateFromSlider(+$("gate").value);
$("btnLoop").addEventListener("click", () => S.loop.on ? (setLoop(false), say("已關閉段落練習。")) : enableLoop(+$("loopA").value, +$("loopB").value));
["loopA","loopB"].forEach(id => $(id).addEventListener("change", () => {
  const a = +$("loopA").value || 1, b = +$("loopB").value || a;
  S.loop.on ? enableLoop(a, Math.max(a,b)) : setLoop(false, a, Math.max(a,b));
}));
$("btnSetA").addEventListener("click", () => { const m = currentMeasure(); S.loop.on ? enableLoop(m, Math.max(m, S.loop.b)) : setLoop(false, m, Math.max(m, S.loop.b)) });
$("btnSetB").addEventListener("click", () => { const m = currentMeasure(); S.loop.on ? enableLoop(Math.min(S.loop.a, m), m) : setLoop(false, Math.min(S.loop.a, m), m) });
$("sumAgain").addEventListener("click", () => { hideSummary(); resetRun(); jumpTo(rangeStart()); say("再來一次！") });
$("sumDrill").addEventListener("click", e => enableLoop(+e.currentTarget.dataset.a, +e.currentTarget.dataset.b));
$("sumClose").addEventListener("click", hideSummary);
document.querySelectorAll("[data-sample]").forEach(b => b.addEventListener("click", () => loadAbc(SAMPLES[b.dataset.sample])));

function frame(){ tickPlay(); tickMic(); drawRoll(); drawFx(); requestAnimationFrame(frame) }
buildKeys();
if(store.get("scorelight.focus")){ document.body.classList.add("focus"); $("btnFocus").setAttribute("aria-pressed","true") }
loadAbc(store.get("scorelight.abc") || SAMPLES.twinkle);
requestAnimationFrame(frame);
