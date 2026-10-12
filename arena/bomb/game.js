// Bomb battle: four decision models on one board, last one standing wins.
//
// Code owns every rule and every number: blast lines, fuse timers, chain reactions,
// which tiles are safe in how many turns, the shortest escape route, where a bomb
// would break crates. The model owns the judgement call each turn — run, dig,
// hunt, grab a power-up, or hold still — and code turns that call into one step.

import { rng, decide, Latency } from '../shared/arena.js';

export const W = 15, H = 13;
export const FUSE = 4, MAX_TURNS = 150, SHRINK_AT = 90, SHRINK_EVERY = 3;
const EMPTY = 0, PILLAR = 1, CRATE = 2;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const CORNERS = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2]];

export const PLANS = {
  'escape danger': 'move out of every bomb blast line toward a tile that will stay safe',
  'break crates': 'walk to a spot next to crates and drop a bomb to clear them and uncover power-ups',
  'hunt an opponent': 'move toward the nearest opponent and drop a bomb when they are in your blast line',
  'grab a power-up': 'walk to the nearest power-up to get a bigger blast or an extra bomb',
  'wait': 'stay where you are this turn'
};

const key = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

export function createGame(seed, sides) {
  const r = rng(seed);
  const tiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = EMPTY;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) t = PILLAR;
    else if (r() < 0.5) t = CRATE;
    tiles.push(t);
  }
  // clear the spawn corners so nobody starts boxed in
  for (const [cx, cy] of CORNERS)
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const x = cx + dx, y = cy + dy;
      if (inside(x, y) && tiles[key(x, y)] === CRATE) tiles[key(x, y)] = EMPTY;
    }
  const players = sides.map((side, i) => ({
    side, slot: i, x: CORNERS[i][0], y: CORNERS[i][1], alive: true, range: 2, maxBombs: 1,
    kills: 0, crates: 0, items: 0, diedAt: null, killedBy: null, lat: new Latency(), cost: 0,
    plan: null, conf: null, danger: null, error: null, log: [], plans: {}, tag: null
  }));
  return { seed, r, tiles, players, bombs: [], items: [], flames: [], turn: 0, ring: 0, over: false, winner: null, feed: [] };
}

// --- reading the board -------------------------------------------------------
const walkable = (g, x, y) => inside(x, y) && g.tiles[key(x, y)] === EMPTY && !g.bombs.some(b => b.x === x && b.y === y);

function blastCells(g, b) {
  const out = [[b.x, b.y]];
  for (const [dx, dy] of Object.values(DIRS))
    for (let i = 1; i <= b.range; i++) {
      const x = b.x + dx * i, y = b.y + dy * i;
      if (!inside(x, y) || g.tiles[key(x, y)] === PILLAR) break;
      out.push([x, y]);
      if (g.tiles[key(x, y)] === CRATE) break;
    }
  return out;
}

// turns until each tile explodes (1 = at the end of this turn), with chain reactions
export function dangerMap(g, bombs = g.bombs) {
  const timer = new Map(bombs.map(b => [b, b.fuse]));
  for (let changed = true; changed;) {
    changed = false;
    for (const a of bombs) for (const [x, y] of blastCells(g, a))
      for (const b of bombs) if (b !== a && b.x === x && b.y === y && timer.get(a) < timer.get(b)) {
        timer.set(b, timer.get(a)); changed = true;
      }
  }
  const d = new Map();
  // the next ring of wall counts as danger once it is about to close
  const nextShrink = nextShrinkTurn(g);
  if (nextShrink != null && nextShrink - g.turn <= SHRINK_EVERY)
    for (const [x, y] of ringCells(g.ring + 1)) d.set(key(x, y), nextShrink - g.turn);
  for (const b of bombs) for (const [x, y] of blastCells(g, b)) {
    const k = key(x, y), t = timer.get(b);
    if (!d.has(k) || d.get(k) > t) d.set(k, t);
  }
  return d;
}

export function closingCells(g) {
  const n = nextShrinkTurn(g);
  return n != null && n - g.turn <= SHRINK_EVERY ? ringCells(g.ring + 1) : [];
}

function nextShrinkTurn(g) {
  if (g.ring + 1 >= Math.min(W, H) / 2 - 1) return null;
  if (g.turn < SHRINK_AT) return SHRINK_AT;
  return g.turn + SHRINK_EVERY - ((g.turn - SHRINK_AT) % SHRINK_EVERY);
}

export function ringCells(ring) {
  const out = [];
  for (let y = ring; y <= H - 1 - ring; y++) for (let x = ring; x <= W - 1 - ring; x++)
    if (x === ring || y === ring || x === W - 1 - ring || y === H - 1 - ring) out.push([x, y]);
  return out;
}

// shortest route to a tile no bomb will reach, never standing on a tile in the turn it explodes
function escapeRoute(g, x0, y0, danger, extraBlocked = null) {
  if (!danger.has(key(x0, y0))) return [];
  const seen = new Set([`${x0},${y0},0`]);
  const q = [[x0, y0, 0, []]];
  while (q.length) {
    const [x, y, t, path] = q.shift();
    if (t >= 8) continue;
    for (const [name, [dx, dy]] of [...Object.entries(DIRS), ['stay', [0, 0]]]) {
      const nx = x + dx, ny = y + dy, nt = t + 1;
      if (name !== 'stay' && (!walkable(g, nx, ny) || (extraBlocked && extraBlocked(nx, ny)))) continue;
      const boom = danger.get(key(nx, ny));
      if (boom === nt) continue;
      const p = [...path, name];
      if (boom === undefined) return p;
      const s = `${nx},${ny},${nt}`;
      if (!seen.has(s)) { seen.add(s); q.push([nx, ny, nt, p]); }
    }
  }
  return null;
}

// shortest walk to any tile satisfying goal(x, y), skipping tiles that explode on arrival
function routeTo(g, p, goal, danger) {
  const seen = new Set([key(p.x, p.y)]);
  const q = [[p.x, p.y, []]];
  while (q.length) {
    const [x, y, path] = q.shift();
    if (goal(x, y)) return path;
    for (const [name, [dx, dy]] of Object.entries(DIRS)) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(g, nx, ny) || seen.has(key(nx, ny))) continue;
      if (danger.get(key(nx, ny)) === path.length + 1) continue;
      seen.add(key(nx, ny));
      q.push([nx, ny, [...path, name]]);
    }
  }
  return null;
}

function cratesHit(g, x, y, range) {
  return blastCells(g, { x, y, range }).filter(([cx, cy]) => g.tiles[key(cx, cy)] === CRATE).length;
}

// would I survive dropping a bomb right here?
function safeToBomb(g, p, x = p.x, y = p.y) {
  const hypo = [...g.bombs, { x, y, range: p.range, fuse: FUSE, owner: p.slot }];
  const d = dangerMap(g, hypo);
  return escapeRoute({ ...g, bombs: hypo }, x, y, d) !== null;
}

const myBombs = (g, p) => g.bombs.filter(b => b.owner === p.slot).length;
const foes = (g, p) => g.players.filter(o => o.alive && o !== p);
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function inLine(g, p, o) {
  return blastCells(g, { x: p.x, y: p.y, range: p.range }).some(([x, y]) => x === o.x && y === o.y);
}

// --- what the model is told ---------------------------------------------------
export function describe(g, p) {
  const danger = dangerMap(g);
  const here = danger.get(key(p.x, p.y));
  const esc = escapeRoute(g, p.x, p.y, danger);
  const others = foes(g, p).sort((a, b) => dist(p, a) - dist(p, b));
  const near = others[0];
  const toNear = near ? routeTo(g, p, (x, y) => dist({ x, y }, near) <= 1, danger) : null;
  const crateSpot = routeTo(g, p, (x, y) => cratesHit(g, x, y, p.range) > 0, danger);
  const itemPath = g.items.length ? routeTo(g, p, (x, y) => g.items.some(i => i.x === x && i.y === y), danger) : null;
  const canBomb = myBombs(g, p) < p.maxBombs;
  const shrinkIn = SHRINK_AT - g.turn;

  return {
    game: 'bomb battle, four players, last one standing wins',
    rules: `Bombs explode ${FUSE} turns after they are dropped and blast in a straight line. Anyone caught in a blast is out. Breaking crates can uncover power-ups. Late in the game the outer walls close in one ring at a time, and anyone standing there is out.`,
    your_position: here === undefined
      ? 'you are safe where you stand'
      : `the tile you stand on will be hit in ${here} turn${here > 1 ? 's' : ''}` +
        (esc ? `, and an escape route ${esc.length} step${esc.length > 1 ? 's' : ''} long exists` : ', and there is no escape route'),
    nearest_opponent: near
      ? `${toNear ? toNear.length + ' steps' : 'blocked off, about ' + dist(p, near) + ' tiles'} away` +
        (inLine(g, p, near) ? ', and they are in your blast line right now' : '')
      : 'no opponents left',
    opponents_left: others.length,
    crates: cratesHit(g, p.x, p.y, p.range)
      ? `a bomb here would break ${cratesHit(g, p.x, p.y, p.range)} crate${cratesHit(g, p.x, p.y, p.range) > 1 ? 's' : ''}`
      : crateSpot ? `the nearest spot that breaks crates is ${crateSpot.length} steps away` : 'no crates you can reach',
    power_ups: itemPath ? `a power-up is ${itemPath.length} steps away` : 'no power-up you can reach',
    your_power: `blast range ${p.range}, ${p.maxBombs} bomb${p.maxBombs > 1 ? 's' : ''} at a time` + (canBomb ? '' : ', and your bomb is already on the board'),
    arena: shrinkIn > 0 ? `the walls start closing in ${shrinkIn} turns from now` : 'the walls are closing in now'
  };
}

export const QUESTIONS = {
  plan: { type: 'choice', instructions: 'What should you do this turn?', criteria: PLANS },
  danger: {
    type: 'noul', instructions: 'If you stay where you are, will an explosion catch you soon?',
    criteria: { true: 'staying here gets you caught', false: 'staying here is safe' }
  }
};

// --- the chosen plan becomes one action --------------------------------------
export function actionFor(g, p, plan) {
  const danger = dangerMap(g);
  const canBomb = myBombs(g, p) < p.maxBombs;
  const first = path => (path && path.length ? path[0] : 'stay');
  switch (plan) {
    case 'escape danger': return first(escapeRoute(g, p.x, p.y, danger));
    case 'break crates':
      if (canBomb && cratesHit(g, p.x, p.y, p.range) && safeToBomb(g, p)) return 'bomb';
      return first(routeTo(g, p, (x, y) => cratesHit(g, x, y, p.range) > 0 && !(x === p.x && y === p.y), danger));
    case 'hunt an opponent': {
      if (canBomb && foes(g, p).some(o => inLine(g, p, o)) && safeToBomb(g, p)) return 'bomb';
      const others = foes(g, p).sort((a, b) => dist(p, a) - dist(p, b));
      if (!others.length) return 'stay';
      const path = routeTo(g, p, (x, y) => dist({ x, y }, others[0]) <= 1, danger);
      if (path) return first(path);
      // walled off: dig toward them
      if (canBomb && cratesHit(g, p.x, p.y, p.range) && safeToBomb(g, p)) return 'bomb';
      return first(routeTo(g, p, (x, y) => cratesHit(g, x, y, p.range) > 0 && !(x === p.x && y === p.y), danger));
    }
    case 'grab a power-up':
      return first(routeTo(g, p, (x, y) => g.items.some(i => i.x === x && i.y === y), danger));
    default: return 'stay';
  }
}

// --- one turn for everyone ------------------------------------------------------
export async function turn(g) {
  if (g.over) return;
  const live = g.players.filter(p => p.alive && !p.error);
  const chosen = new Map();
  await Promise.all(live.map(async p => {
    const state = describe(g, p);
    let r;
    try { r = await decide(p.side, state, QUESTIONS, p.tag); }
    catch (e) { p.error = e.message; return; }
    p.lat.add(r.latency_ms);
    p.cost += r.cost_usd ?? 0;
    p.plan = r.answers.plan?.choice ?? 'wait';
    p.conf = r.answers.plan?.confidence ?? null;
    p.danger = r.answers.danger?.noul ?? null;
    p.plans[p.plan] = (p.plans[p.plan] ?? 0) + 1;
    chosen.set(p, actionFor(g, p, p.plan));
  }));
  g.turn++;
  g.flames = [];

  // bombs first (dropped where you stand), then movement
  for (const [p, a] of chosen) if (a === 'bomb' && myBombs(g, p) < p.maxBombs && !g.bombs.some(b => b.x === p.x && b.y === p.y))
    g.bombs.push({ x: p.x, y: p.y, range: p.range, fuse: FUSE, owner: p.slot });
  const danger = dangerMap(g);
  for (const [p, a] of chosen) {
    const d = DIRS[a];
    if (!d) continue;
    const nx = p.x + d[0], ny = p.y + d[1];
    if (walkable(g, nx, ny) && danger.get(key(nx, ny)) !== 1) { p.x = nx; p.y = ny; }
  }
  for (const [p, a] of chosen) p.log.unshift({ turn: g.turn, plan: p.plan, action: a, ms: p.lat.samples.at(-1) });
  for (const p of g.players) p.log.length = Math.min(p.log.length, 7);

  // fuses burn down; explosions chain
  for (const b of g.bombs) b.fuse--;
  let exploding = g.bombs.filter(b => b.fuse <= 0);
  const burned = new Set(), blamed = new Map();
  while (exploding.length) {
    const next = [];
    for (const b of exploding) {
      g.bombs = g.bombs.filter(o => o !== b);
      for (const [x, y] of blastCells(g, b)) {
        const k = key(x, y);
        burned.add(k); if (!blamed.has(k)) blamed.set(k, b.owner);
        for (const o of g.bombs) if (o.x === x && o.y === y && !next.includes(o)) next.push(o);
      }
    }
    exploding = next;
  }
  for (const k of burned) {
    const x = k % W, y = Math.floor(k / W);
    g.flames.push([x, y]);
    if (g.tiles[k] === CRATE) {
      g.tiles[k] = EMPTY;
      const owner = g.players[blamed.get(k)]; if (owner) owner.crates++;
      const roll = g.r();
      if (roll < 0.22) g.items.push({ x, y, kind: 'fire' });
      else if (roll < 0.36) g.items.push({ x, y, kind: 'bomb' });
    } else g.items = g.items.filter(i => !(i.x === x && i.y === y));
  }
  for (const p of g.players) if (p.alive && burned.has(key(p.x, p.y))) {
    p.alive = false; p.diedAt = g.turn;
    const killer = g.players[blamed.get(key(p.x, p.y))];
    p.killedBy = killer?.side ?? null;
    if (killer && killer !== p) killer.kills++;
    g.feed.unshift({ turn: g.turn, who: p.side, by: killer && killer !== p ? killer.side : null });
  }

  // power-ups
  for (const p of g.players) if (p.alive) {
    const it = g.items.find(i => i.x === p.x && i.y === p.y);
    if (it) { if (it.kind === 'fire') p.range++; else p.maxBombs++; p.items++; g.items = g.items.filter(i => i !== it); }
  }

  // sudden death: the next ring turns to stone (it was flagged as danger beforehand)
  if (nextShrinkTurn({ ...g, turn: g.turn - 1 }) === g.turn) {
    g.ring++;
    for (const [x, y] of ringCells(g.ring)) {
      g.tiles[key(x, y)] = PILLAR;
      g.bombs = g.bombs.filter(b => !(b.x === x && b.y === y));
      g.items = g.items.filter(i => !(i.x === x && i.y === y));
      for (const p of g.players) if (p.alive && p.x === x && p.y === y) {
        p.alive = false; p.diedAt = g.turn; p.killedBy = 'wall';
        g.feed.unshift({ turn: g.turn, who: p.side, by: 'wall' });
      }
    }
  }

  const standing = g.players.filter(p => p.alive && !p.error);
  if (standing.length <= 1 || g.turn >= MAX_TURNS) {
    g.over = true;
    if (standing.length === 1) g.winner = standing[0].side;
    else if (standing.length === 0) {
      // the last players went out on the same turn: more knockouts, then more crates, wins
      const last = g.players.filter(p => p.diedAt === g.turn).sort((a, b) => b.kills - a.kills || b.crates - a.crates);
      g.winner = last.length > 1 && last[0].kills === last[1].kills && last[0].crates === last[1].crates ? null : last[0]?.side ?? null;
      g.tiebreak = true;
    } else {
      const best = [...standing].sort((a, b) => b.kills - a.kills || b.crates - a.crates)[0];
      g.winner = best.side;
    }
  }
}

// finishing order: winner first, then by how long each lasted
export function placings(g) {
  return [...g.players].sort((a, b) =>
    (b.side === g.winner) - (a.side === g.winner) ||
    (b.alive - a.alive) || ((b.diedAt ?? 1e9) - (a.diedAt ?? 1e9)) || b.kills - a.kills
  ).map((p, i) => ({ place: i + 1, side: p.side, alive: p.alive, diedAt: p.diedAt, killedBy: p.killedBy,
    kills: p.kills, crates: p.crates, items: p.items, p50_ms: Math.round(p.lat.p50), cost_usd: +p.cost.toFixed(6),
    plans: p.plans, error: p.error }));
}

export const TILE = { EMPTY, PILLAR, CRATE };
