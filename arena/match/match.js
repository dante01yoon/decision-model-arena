import * as T from '../tetris/game.js';

const MODELS = {
  laya:   { name: 'Laya',          who: '내 맥에서 실행 · 무료',     c: 'var(--laya)' },
  jev:    { name: 'Jev',           who: 'TypeSafe',                 c: 'var(--jev)' },
  openai: { name: 'Decisions API', who: 'OpenAI · gpt-6-luna',      c: 'var(--openai)' },
  d1:     { name: 'Decision-1',    who: 'Microsoft',                c: 'var(--d1)' },
  'openai-text':   { name: 'Decisions API', who: '글로 읽고 판단',  c: 'var(--openai)' },
  'openai-vision': { name: 'Decisions API', who: '그림만 보고 판단', c: 'var(--vision)' },
};

// draws both boards the way a person would see them: mine on the left, theirs on the right
function picture(s, foe) {
  const cell = 14, gap = 40, top = 54, w = T.COLS * cell, h = T.ROWS * cell;
  const cv = document.createElement('canvas'); cv.width = w * 2 + gap + 40; cv.height = h + top + 20;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, cv.width, cv.height);
  g.font = 'bold 15px sans-serif'; g.fillStyle = '#fff';
  g.fillText('YOU', 20, 18); g.fillText('OPPONENT', 20 + w + gap, 18);
  g.fillText(`holding: ${s.piece}`, 20, 40);
  [[s, 20], [foe, 20 + w + gap]].forEach(([side, x0]) => {
    g.fillStyle = '#151925'; g.fillRect(x0, top, w, h);
    for (let r = 0; r < T.ROWS; r++) for (let c = 0; c < T.COLS; c++) {
      const v = side.grid[r][c]; if (!v) continue;
      g.fillStyle = v === 8 ? '#7a8194' : side === s ? '#5ad1ff' : '#ffb347';
      g.fillRect(x0 + c * cell + 1, top + r * cell + 1, cell - 2, cell - 2);
    }
    g.strokeStyle = '#3a4258'; g.strokeRect(x0, top, w, h);
  });
  return cv.toDataURL('image/png');
}
const PLAN = {
  'clear lines now': ['지금 공격', 'attack'],
  'build a bigger attack': ['큰 공격 준비', 'build'],
  'dig out the buried holes': ['구멍 파내기', 'dig'],
  'stay safe and keep the stack low': ['안전하게 낮게', 'safe'],
};
const q = new URLSearchParams(location.search);
const a = q.get('a') || 'jev', b = q.get('b') || 'd1';
const seed = parseInt(q.get('seed') || '7', 10);
const floor = parseInt(q.get('pace') || '450', 10);
document.querySelector('#seed').textContent = seed;

const P = {};
for (const [slot, key] of [['A', a], ['B', b]]) {
  const sec = document.getElementById(slot);
  sec.append(document.getElementById('side-t').content.cloneNode(true));
  sec.style.setProperty('--c', MODELS[key].c);
  sec.querySelector('.name').textContent = MODELS[key].name;
  sec.querySelector('.who').textContent = MODELS[key].who;
  const well = sec.querySelector('.well');
  const blocks = [];
  for (let i = 0; i < T.ROWS * T.COLS; i++) { const d = document.createElement('div'); d.className = 'blk'; well.append(d); blocks.push(d); }
  P[key] = { sec, blocks, k: Object.fromEntries([...sec.querySelectorAll('[data-k]')].map(n => [n.dataset.k, n])) };
}

function render(s) {
  const p = P[s.side];
  if (p.img && s.lastImage) p.img.src = s.lastImage;
  for (let r = 0; r < T.ROWS; r++) for (let c = 0; c < T.COLS; c++) {
    const v = s.grid[r][c];
    p.blocks[r * T.COLS + c].className = 'blk' + (v ? ` f${v}` : '');
  }
  p.k.lines.textContent = s.lines; p.k.sent.textContent = s.sent; p.k.recv.textContent = s.received;
  p.k.ms.textContent = s.lat.n ? `${Math.round(s.lat.samples.at(-1))}ms` : '—';
  const [label, cls] = PLAN[s.plan] ?? ['—', ''];
  const pn = p.sec.querySelector('.plan-now'); pn.textContent = label; pn.className = 'plan-now ' + cls;
  p.sec.querySelector('.conf').textContent = s.lastConf == null ? '' : `확신 ${(s.lastConf * 100).toFixed(0)}%`;
  const d = s.lastLosing;
  p.sec.querySelector('.danger em').style.width = d == null ? '0%' : `${d * 100}%`;
  p.sec.querySelector('.dv').textContent = d == null ? '—' : `${(d * 100).toFixed(0)}%`;
  const logEl = p.sec.querySelector('.log');
  if (logEl) logEl.innerHTML = s.log.map(e => `<li><span class="pc">${e.piece}</span>
    <span class="mv">${PLAN[e.plan]?.[0] ?? e.plan}</span><span class="cl">${e.cleared ? `${e.cleared}줄` : ''}</span>
    <span class="ms">${Math.round(e.ms)}ms</span></li>`).join('');
  const v = p.sec.querySelector('.verdict');
  if (s.error) { v.className = 'verdict dead'; v.textContent = '연결 오류'; }
  else if (s.dead) { v.className = 'verdict dead'; v.textContent = '탈락'; }
}

const S = { [a]: T.createSide(a, seed, 1), [b]: T.createSide(b, seed, 2) };
for (const k of [a, b]) if (k.endsWith('-vision')) {
  S[k].see = picture;
  const img = document.createElement('img'); img.className = 'sees';
  const box = document.createElement('div'); box.className = 'seebox'; box.innerHTML = '<label>모델이 받은 그림</label>'; box.append(img);
  P[k].sec.querySelector('.log').replaceWith(box); P[k].img = img;
}
S[a].tag = S[b].tag = `rec:${a}-${b}:${seed}`;
window.match = { done: false, winner: null, turns: 0, S };
for (const k of [a, b]) render(S[k]);

function winnerOf() {
  const A = S[a], B = S[b];
  if (A.dead !== B.dead) return A.dead ? b : a;
  for (const k of ['lines', 'sent', 'pieces']) if (A[k] !== B[k]) return A[k] > B[k] ? a : b;
  return null;
}

async function run() {
  // every turn already waits for the slowest answer (Promise.all); this only sets a watchable minimum
  const tick = async t0 => { const w = floor - (performance.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  while (window.match.turns < 300) {
    const live = [a, b].filter(k => !S[k].dead && !S[k].error);
    if (live.length < 2) break;
    const t0 = performance.now();
    await Promise.all(live.map(async k => {
      await T.step(S[k], S[k === a ? b : a]);
      render(S[k]);
    }));
    window.match.turns++;
    document.querySelector('#turn').textContent = window.match.turns;
    await tick(t0);
  }
  for (const k of [a, b]) render(S[k]);
  const w = winnerOf();
  if (w) {
    P[w].sec.classList.add('win');
    const v = P[w].sec.querySelector('.verdict'); v.className = 'verdict win'; v.textContent = '승리';
    P[w === a ? b : a].sec.classList.add('lose');
  }
  Object.assign(window.match, { done: true, winner: w });
}
if (q.get('auto') !== '0') setTimeout(run, parseInt(q.get('delay') || '1500', 10));
window.startMatch = run;
