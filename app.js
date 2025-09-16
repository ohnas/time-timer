/* Time Timer – Visual countdown
 * - Drag knob to set 0–60 minutes
 * - Start/Pause/Reset, presets, mm:ss readout
 * - Beep + vibration at end, last setting saved to localStorage
 */

const TWO_PI = Math.PI * 2;
const CENTER = { x: 150, y: 150 };
const R = 118; // sector radius (inside white face)
const remainingEl = document.getElementById('remaining');
const dial = document.getElementById('dial');
const sector = document.getElementById('sector');
const ticksG = document.getElementById('ticks');
const knob = document.getElementById('knob');
const minutesInput = document.getElementById('minutesInput');
const btnStartPause = document.getElementById('startPause');
const btnReset = document.getElementById('reset');
const btnMute = document.getElementById('mute');

let durationSec = 25 * 60;        // total seconds
let remainingSec = durationSec;   // remaining seconds
let running = false;
let rafId = null;
let endAt = null;
let muted = false;

// WebAudio beep
let audioCtx;
function beep() {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    o.start(); o.stop(audioCtx.currentTime + 0.4);
  } catch {}
}

function vibrate() {
  if (navigator.vibrate) navigator.vibrate([160, 80, 160]);
}

// ---------- UI helpers ----------
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function pad(n){ return String(n).padStart(2, '0'); }
function fmt(sec){
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${pad(m)}:${pad(s)}`;
}
function saveSetting(){
  localStorage.setItem('ttimer:lastMin', String(Math.round(durationSec/60)));
  localStorage.setItem('ttimer:muted', muted ? '1' : '0');
}
function loadSetting(){
  const m = parseInt(localStorage.getItem('ttimer:lastMin') || '25', 10);
  muted = localStorage.getItem('ttimer:muted') === '1';
  btnMute.textContent = muted ? '🔇' : '🔊';
  setDurationMinutes(clamp(m, 0, 60));
}

// ---------- Drawing ----------
/* Angle convention:
 * 0 minutes = angle 0 (pointing up); increases clockwise to 360 (60 minutes)
 * Convert minutes (0–60) or seconds to angle degrees.
 */
function secToAngle(secTotal, secRemain){
  const frac = clamp(secRemain / secTotal, 0, 1);
  return 360 * frac; // remaining sector size
}

function polar(cx, cy, r, deg){
  const rad = (deg - 90) * (Math.PI/180); // 0deg at top, clockwise
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx, cy, r, deg){
  if (deg <= 0) return '';                    // nothing
  if (deg >= 360) {                           // full circle sector
    // draw full circle by two arcs
    const p1 = polar(cx, cy, r, 0);
    return [
      `M ${cx} ${cy}`,
      `L ${p1.x} ${p1.y}`,
      `A ${r} ${r} 0 1 1 ${polar(cx,cy,r,180).x} ${polar(cx,cy,r,180).y}`,
      `A ${r} ${r} 0 1 1 ${p1.x} ${p1.y}`,
      'Z'
    ].join(' ');
  }
  const end = polar(cx, cy, r, 360 - deg);
  const start = polar(cx, cy, r, 0);
  const largeArc = deg > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    'Z'
  ].join(' ');
}

function drawSector(){
  const deg = secToAngle(durationSec, remainingSec);
  sector.setAttribute('d', sectorPath(CENTER.x, CENTER.y, R, deg));
  // Update knob position on arc end
  const pos = polar(CENTER.x, CENTER.y, R, 360 - deg);
  const dx = pos.x - CENTER.x, dy = pos.y - CENTER.y;
  const angRad = Math.atan2(dy, dx);
  const knobR = 28;
  const kx = CENTER.x + Math.cos(angRad) * 0; // keep center fixed
  const ky = CENTER.y + Math.sin(angRad) * 0;
  knob.setAttribute('transform', `rotate(${360 - deg} 150 150)`);
  knob.setAttribute('aria-valuenow', String(360 - deg));
}

function drawTicks(){
  const g = document.createDocumentFragment();
  const outerR = 120, innerMajor = 100, innerMinor = 110;
  for (let i=0;i<60;i++){
    const deg = i*6;
    const pOuter = polar(150,150,outerR,deg);
    const inner = (i%5===0) ? innerMajor : innerMinor;
    const pInner = polar(150,150,inner,deg);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', pInner.x); line.setAttribute('y1', pInner.y);
    line.setAttribute('x2', pOuter.x); line.setAttribute('y2', pOuter.y);
    line.setAttribute('stroke', i%5===0 ? '#0f0f0f22' : '#0f0f0f16');
    line.setAttribute('stroke-width', i%5===0 ? '3' : '2');
    ticksG.appendChild(line);

    if (i%5===0){
      const num = (i===0) ? '0' : String(60-i);
      const tp = polar(150,150,92,deg);
      const text = document.createElementNS('http://www.w3.org/2000/svg','text');
      text.setAttribute('x', tp.x);
      text.setAttribute('y', tp.y+5);
      text.setAttribute('text-anchor','middle');
      text.setAttribute('font-size','16');
      text.setAttribute('font-weight','700');
      text.setAttribute('fill','currentColor');
      text.textContent = num;
      ticksG.appendChild(text);
    }
  }
}
drawTicks();

// ---------- State & Logic ----------
function setDurationMinutes(min){
  durationSec = clamp(Math.round(min)*60, 0, 60*60);
  remainingSec = durationSec;
  minutesInput.value = Math.round(min);
  remainingEl.textContent = fmt(remainingSec);
  drawSector();
  updateButtons();
  saveSetting();
}

function updateButtons(){
  btnStartPause.disabled = durationSec === 0;
  btnStartPause.textContent = running ? '일시정지' : '시작';
}

function tick(){
  const now = performance.now();
  const msLeft = Math.max(0, endAt - now);
  const nextSec = Math.round(msLeft/1000);
  if (nextSec !== remainingSec){
    remainingSec = nextSec;
    remainingEl.textContent = fmt(remainingSec);
    drawSector();
  }
  if (msLeft <= 0){
    stopRun();
    remainingSec = 0;
    remainingEl.textContent = fmt(0);
    drawSector();
    beep(); vibrate();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function startRun(){
  if (durationSec <= 0) return;
  if (remainingSec <= 0) remainingSec = durationSec;
  endAt = performance.now() + remainingSec*1000 + 30; // small cushion
  running = true; updateButtons();
  rafId = requestAnimationFrame(tick);
}

function stopRun(){
  running = false; updateButtons();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function resetRun(){
  stopRun();
  remainingSec = durationSec;
  remainingEl.textContent = fmt(remainingSec);
  drawSector();
}

// ---------- Events ----------
btnStartPause.addEventListener('click', () => running ? stopRun() : startRun());
btnReset.addEventListener('click', resetRun);

btnMute.addEventListener('click', () => {
  muted = !muted;
  btnMute.setAttribute('aria-pressed', String(muted));
  btnMute.textContent = muted ? '🔇' : '🔊';
  saveSetting();
});

minutesInput.addEventListener('change', e => {
  const val = Number(e.target.value || 0);
  setDurationMinutes(clamp(val, 0, 60));
});

document.querySelectorAll('.chip').forEach(b=>{
  b.addEventListener('click', ()=>{
    const m = Number(b.dataset.min);
    setDurationMinutes(m);
  });
});

// Drag to set time
let dragging = false;
function pointAngle(evt){
  const pt = dial.createSVGPoint();
  if (evt.touches && evt.touches[0]) {
    pt.x = evt.touches[0].clientX;
    pt.y = evt.touches[0].clientY;
  } else {
    pt.x = evt.clientX; pt.y = evt.clientY;
  }
  const m = pt.matrixTransform(dial.getScreenCTM().inverse());
  const dx = m.x - CENTER.x, dy = m.y - CENTER.y;
  let angle = Math.atan2(dy, dx) * 180/Math.PI + 90; // 0 on top
  if (angle < 0) angle += 360;
  return angle; // 0..360 clockwise
}

function angleToMinutes(angle){
  const minutes = Math.round((angle/360) * 60);
  return (minutes === 60) ? 60 : minutes;
}

function onDrag(evt){
  if (!dragging) return;
  evt.preventDefault();
  const ang = pointAngle(evt);
  const mins = angleToMinutes(ang);
  setDurationMinutes(mins);
}

function startDrag(evt){
  dragging = true;
  stopRun();            // stop if running
  onDrag(evt);
}
function endDrag(){ dragging = false; }

['pointerdown','mousedown','touchstart'].forEach(ev => knob.addEventListener(ev, startDrag, {passive:false}));
['pointermove','mousemove','touchmove'].forEach(ev => window.addEventListener(ev, onDrag, {passive:false}));
['pointerup','mouseup','touchend','touchcancel','mouseleave'].forEach(ev => window.addEventListener(ev, endDrag));

// Keyboard for accessibility
knob.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp'){
    setDurationMinutes(clamp(Math.round(durationSec/60)+1, 0, 60)); e.preventDefault();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown'){
    setDurationMinutes(clamp(Math.round(durationSec/60)-1, 0, 60)); e.preventDefault();
  } else if (e.key === 'Enter' || e.key === ' '){
    btnStartPause.click(); e.preventDefault();
  }
});

// Persist + init
loadSetting();
remainingEl.textContent = fmt(remainingSec);
drawSector();

// Visibility pause (saves battery in embeds)
document.addEventListener('visibilitychange', ()=>{
  if (document.hidden && running) stopRun();
});
