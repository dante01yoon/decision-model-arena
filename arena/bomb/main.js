import * as B from './game.js';

const MODELS = {
  laya:   { name: 'Laya', who: '내 맥 · 무료', c: 'var(--laya)' },
  jev:    { name: 'Jev', who: 'TypeSafe', c: 'var(--jev)' },
  openai: { name: 'Decisions API', who: 'OpenAI', c: 'var(--openai)' },
  d1:     { name: 'Decision-1', who: 'Microsoft', c: 'var(--d1)' },
};
const PLAN = {
  'escape danger': ['피하기', 'escape'], 'break crates': ['상자 깨기', 'crates'],
  'hunt an opponent': ['사냥하기', 'hunt'], 'grab a power-up': ['아이템 줍기', 'item'], 'wait': ['기다리기', 'wait'],
};
const ACT = { up: '↑', down: '↓', left: '←', right: '→', stay: '·', bomb: '폭탄 설치' };
const q = new URLSearchParams(location.search);
const seed = parseInt(q.get('seed') || '1', 10);
const order = (q.get('order') || 'laya,jev,openai,d1').split(',');
const floor = parseInt(q.get('pace') || '420', 10);
const CELL = 66;
const g = B.createGame(seed, order);
for (const p of g.players) p.tag = `rec-bomb:${seed}`;
window.match = { done: false, g };

const $ = s => document.querySelector(s);
const cards = {}, units = {};
for (const p of g.players) {
  const m = MODELS[p.side];
  const c = document.createElement('div');
  c.className = 'card'; c.style.setProperty('--c', m.c);
  c.innerHTML = `<div class="n">${m.name}<small>${m.who}</small></div><div class="ms">—</div>
    <div class="plan">—</div><div class="st"></div>
    <div class="meter">스스로 본 위험 <i><em></em></i><b>—</b></div><ol class="log"></ol>`;
  $('#cards').append(c); cards[p.side] = c;
  const u = document.createElement('div');
  u.className = 'unit'; u.style.setProperty('--c', m.c);
  u.innerHTML = `<div class="body"></div><div class="tag">${m.name}</div>`;
  $('#units').append(u); units[p.side] = u;
}

function drawTiles() {
  const blast = new Set();
  for (const [k] of B.dangerMap(g)) blast.add(k);
  const warnRing = new Set(B.closingCells(g).map(([x, y]) => y * B.W + x));
  let html = '';
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    const t = g.tiles[y * B.W + x];
    const k = y * B.W + x;
    let cls = t === B.TILE.PILLAR ? 'p' : t === B.TILE.CRATE ? 'c' : 'e' + ((x + y) % 2 ? ' alt' : '');
    if (t !== B.TILE.PILLAR && warnRing.has(k)) cls += ' warn';
    else if (t === B.TILE.EMPTY && blast.has(k)) cls += ' blast';
    html += `<div class="t ${cls}" style="left:${x * CELL}px;top:${y * CELL}px"></div>`;
  }
  $('#tiles').innerHTML = html;
}

function draw() {
  drawTiles();
  let fx = '';
  for (const i of g.items) fx += `<div class="pu ${i.kind}" style="left:${i.x * CELL}px;top:${i.y * CELL}px"><i>${i.kind === 'fire' ? '불' : '폭'}</i></div>`;
  for (const b of g.bombs) fx += `<div class="bomb" style="left:${b.x * CELL}px;top:${b.y * CELL}px;--c:${MODELS[g.players[b.owner].side].c}"><i>${b.fuse}</i></div>`;
  for (const [x, y] of g.flames) fx += `<div class="flame" style="left:${x * CELL}px;top:${y * CELL}px"></div>`;
  $('#fx').innerHTML = fx;
  for (const p of g.players) {
    const u = units[p.side];
    u.style.left = `${p.x * CELL}px`; u.style.top = `${p.y * CELL}px`;
    u.classList.toggle('dead', !p.alive);
    const c = cards[p.side];
    c.querySelector('.ms').textContent = p.lat.n ? `${Math.round(p.lat.samples.at(-1))}ms` : '—';
    const [label, cls] = PLAN[p.plan] ?? ['—', ''];
    const pl = c.querySelector('.plan');
    if (!p.alive) { c.classList.add('out'); pl.className = 'plan'; pl.textContent = p.killedBy === 'wall' ? `탈락 · 벽에 갇힘 (${p.diedAt}턴)` : p.killedBy === p.side ? `탈락 · 자기 폭탄 (${p.diedAt}턴)` : `탈락 · ${MODELS[p.killedBy]?.name ?? ''} 폭탄 (${p.diedAt}턴)`; }
    else { pl.className = 'plan ' + cls; pl.textContent = label; }
    if (p.error) pl.textContent = '연결 오류';
    c.querySelector('.log').innerHTML = p.log.slice(0, 3).map(e => `<li><span>${e.turn}턴</span><span>${PLAN[e.plan]?.[0] ?? e.plan}</span><span>${ACT[e.action] ?? e.action}</span><span>${Math.round(e.ms ?? 0)}ms</span></li>`).join('');
    c.querySelector('.st').textContent = `불길 ${p.range} · 폭탄 ${p.maxBombs} · 상자 ${p.crates}`;
    c.querySelector('.meter em').style.width = p.danger == null ? '0%' : `${p.danger * 100}%`;
    c.querySelector('.meter b').textContent = p.danger == null ? '—' : `${Math.round(p.danger * 100)}%`;
  }
  $('#turn').textContent = g.turn;
  const left = B.SHRINK_AT - g.turn;
  $('#shrink').textContent = left > 0 && left <= 15 ? `벽이 ${left}턴 뒤 좁혀짐` : left <= 0 ? '벽이 좁혀지는 중' : '';
}

async function run() {
  // every turn already waits for the slowest answer (Promise.all); this only sets a watchable minimum
  const tick = async t0 => { const w = floor - (performance.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  while (!g.over) {
    const t0 = performance.now();
    await B.turn(g);
    draw();
    await tick(t0);
  }
  draw();
  if (g.winner) cards[g.winner].classList.add('win');
  if (g.winner) cards[g.winner].querySelector('.plan').textContent = g.tiebreak ? '승리 · 동시 탈락 중 점수 우위' : '승리 · 마지막 생존';
  Object.assign(window.match, { done: true, winner: g.winner, turns: g.turn, placings: B.placings(g) });
}
draw();
window.startMatch = run;
if (q.get('auto') !== '0') setTimeout(run, parseInt(q.get('delay') || '1500', 10));
