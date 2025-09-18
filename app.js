/* Time Timer – Visual countdown (소리 3번 버전)
 * - 60분 스케일, 설정한 시간만큼 빨간영역 즉시 표시
 * - 시작 시 그 지점부터 줄어듦
 * - 분침은 표시만 (조작 불가)
 * - 시간 설정은 '프리셋' 또는 '분 입력'만 사용
 * - 종료 시 삡 삡 삡 (3회) 소리
 */

// ----- Embed / Notion detection -----
(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const force = params.get('embed');
  const inIFrame = (window.self !== window.top) || force;
  if (inIFrame) {
    root.classList.add('is-embed');
    const isNotionRef = /notion\.so|notion\.site/i.test(document.referrer || '') || String(force).toLowerCase() === 'notion';
    if (isNotionRef) root.classList.add('is-notion-embed');
  }
})();

const CENTER = { x: 150, y: 150 };
const R = 118;
const SCALE_SEC = 60 * 60;

const remainingEl   = document.getElementById('remaining');
const sector        = document.getElementById('sector');
const ticksG        = document.getElementById('ticks');
const knob          = document.getElementById('knob');
const minutesInput  = document.getElementById('minutesInput');
const btnStartPause = document.getElementById('startPause');
const btnReset      = document.getElementById('reset');
const btnMute       = document.getElementById('mute');

let durationSec = 25 * 60;
let remainingSec = durationSec;
let running = false;
let rafId = null;
let endAt = null;
let muted = false;

// ---------- Utils ----------
const clamp = (v,min,max)=> Math.max(min, Math.min(max,v));
const pad   = n => String(n).padStart(2,'0');
const fmt   = s => `${pad(Math.floor(s/60))}:${pad(s%60)}`;

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

// ---------- Beep Sound ----------
let audioCtx;
function beep(){
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    o.start(); o.stop(audioCtx.currentTime + 0.4);
  } catch(e){}
}

// ---------- Drawing ----------
function secToAngle(secRemain){
  const frac = clamp(secRemain / SCALE_SEC, 0, 1);
  return 360 * frac;
}
function polar(cx, cy, r, deg){
  const rad = (deg - 90) * (Math.PI/180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function sectorPath(cx, cy, r, deg){
  if (deg <= 0) return '';
  if (deg >= 360) {
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
  const deg = secToAngle(remainingSec);
  sector.setAttribute('d', sectorPath(CENTER.x, CENTER.y, R, deg));
  const boundary = (360 - deg + 360) % 360;
  const knobAngle = (boundary - 90 + 360) % 360;
  knob.setAttribute('transform', `rotate(${knobAngle} 150 150)`);
  knob.setAttribute('aria-valuenow', String(boundary));
}
function drawTicks(){
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
    // 삡 삡 삡 (3회)
    let count = 0;
    const interval = setInterval(()=>{
      beep();
      count++;
      if (count >= 3) clearInterval(interval);
    }, 600);
    return;
  }
  rafId = requestAnimationFrame(tick);
}
function startRun(){
  if (durationSec <= 0) return;
  if (remainingSec <= 0) remainingSec = durationSec;
  endAt = performance.now() + remainingSec*1000 + 30;
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

// (3) 숫자 입력 안정화: 실시간 반영 + 경계 보정
minutesInput.addEventListener('input', e => {
  const raw = String(e.target.value || '');
  const val = Number(raw.replace(/[^\d]/g,'') || 0);
  const clamped = clamp(val, 0, 60);
  e.target.value = String(clamped);
  setDurationMinutes(clamped);
});

document.querySelectorAll('.chip').forEach(b=>{
  b.addEventListener('click', ()=>{
    const m = Number(b.dataset.min);
    setDurationMinutes(m);
  });
});

// 초기화
loadSetting();
remainingEl.textContent = fmt(remainingSec);
drawSector();

// 탭 전환 시 자동 일시정지
document.addEventListener('visibilitychange', ()=>{
  if (document.hidden && running) stopRun();
});
