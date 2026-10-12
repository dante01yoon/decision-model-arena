// Versus Tetris. Clearing lines sends garbage rows to the other side, so the board
// you are reading keeps changing under pressure from someone else's success.
//
// Code owns every rule and every number: the legal placements, where the piece
// lands, how many lines it clears, how many holes it buries, how tall it leaves
// you, how much garbage it sends. The model owns the one thing code is bad at —
// deciding which of those futures is worth taking *in this situation*.

import { rng, decide, Latency } from '../shared/arena.js';

export const COLS = 10, ROWS = 20, TOP_OUT = ROWS;

const SHAPES = {
  I: [[[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[2,0],[3,0]]],
  O: [[[0,0],[0,1],[1,0],[1,1]]],
  T: [[[0,0],[0,1],[0,2],[1,1]], [[0,1],[1,0],[1,1],[2,1]], [[1,0],[1,1],[1,2],[0,1]], [[0,0],[1,0],[2,0],[1,1]]],
  S: [[[1,0],[1,1],[0,1],[0,2]], [[0,0],[1,0],[1,1],[2,1]]],
  Z: [[[0,0],[0,1],[1,1],[1,2]], [[1,0],[2,0],[0,1],[1,1]]],
  J: [[[0,0],[1,0],[1,1],[1,2]], [[0,0],[0,1],[1,0],[2,0]], [[0,0],[0,1],[0,2],[1,2]], [[0,1],[1,1],[2,0],[2,1]]],
  L: [[[0,2],[1,0],[1,1],[1,2]], [[0,0],[1,0],[2,0],[2,1]], [[0,0],[0,1],[0,2],[1,0]], [[0,0],[0,1],[1,1],[2,1]]],
};
export const PIECES = Object.keys(SHAPES);

// Same bag order for both sides — neither side gets luckier pieces.
export function bag(seed) {
  const r = rng(seed); let queue = [];
  return () => {
    if (!queue.length) {
      queue = [...PIECES];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    return queue.pop();
  };
}

export const empty = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));

function cells(piece, rot, col) {
  const s = SHAPES[piece][rot % SHAPES[piece].length];
  const minC = Math.min(...s.map(([, c]) => c));
  return s.map(([r, c]) => [r, c - minC + col]);
}

function width(piece, rot) {
  const s = SHAPES[piece][rot % SHAPES[piece].length];
  return Math.max(...s.map(([, c]) => c)) - Math.min(...s.map(([, c]) => c)) + 1;
}

export function placements(piece) {
  const out = [];
  for (let rot = 0; rot < SHAPES[piece].length; rot++)
    for (let col = 0; col + width(piece, rot) <= COLS; col++) out.push({ rot, col });
  return out;
}

function drop(grid, piece, rot, col) {
  const cs = cells(piece, rot, col);
  let row = -Math.min(...cs.map(([r]) => r));
  for (;;) {
    const next = cs.map(([r, c]) => [r + row + 1, c]);
    const blocked = next.some(([r, c]) => r >= ROWS || (r >= 0 && grid[r][c]));
    if (blocked) break;
    row++;
    if (row > ROWS + 4) break;
  }
  return cs.map(([r, c]) => [r + row, c]);
}

function applied(grid, placed, who) {
  const g = grid.map(r => [...r]);
  for (const [r, c] of placed) if (r >= 0 && r < ROWS) g[r][c] = who;
  const kept = g.filter(r => r.some(v => !v));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(0));
  return { grid: kept, cleared };
}

// how the board reads after a placement — the numbers a good player weighs
function readBoard(g) {
  const heights = Array(COLS).fill(0);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      if (g[r][c]) { if (!seen) { seen = true; heights[c] = ROWS - r; } }
      else if (seen) holes++;
    }
  }
  const max = Math.max(...heights);
  let bumpy = 0;
  for (let c = 0; c + 1 < COLS; c++) bumpy += Math.abs(heights[c] - heights[c + 1]);
  return { heights, holes, max, bumpy };
}

const GARBAGE = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4 };   // standard-ish attack table
const label = p => `column ${p.col + 1} rotation ${p.rot}`;

// Six options that disagree with each other: the biggest clear, the flattest, the
// one that buries nothing, the one that keeps a well open for a four-line clear,
// the safest, and whatever is left over — so the model is choosing a strategy.
function pickDistinct(opts, n = 6) {
  const take = [], seen = new Set();
  const add = o => { if (o && !seen.has(o.label)) { seen.add(o.label); take.push(o); } };
  const by = f => [...opts].sort(f)[0];

  add(by((a, b) => b.cleared - a.cleared));                                  // biggest clear
  add(by((a, b) => a.newHoles - b.newHoles || a.after.max - b.after.max));   // buries least
  add(by((a, b) => a.after.bumpy - b.after.bumpy));                          // flattest
  add(by((a, b) => a.after.max - b.after.max));                              // lowest stack
  // keeps one column open as a well — the shape a four-line clear needs
  add(by((a, b) => wellScore(b.after) - wellScore(a.after)));
  for (const o of opts) { if (take.length >= n) break; add(o); }
  return take.slice(0, n);
}


// Each strategy is a different ranking over the same placements. Code owns this;
// the model only says which ranking the situation calls for.
function bestFor(plan, opts) {
  const pick = f => [...opts].sort(f)[0];
  switch (plan) {
    case 'clear lines now':
      return pick((a, b) => (b.cleared - a.cleared) || (a.newHoles - b.newHoles) || (a.after.max - b.after.max));
    case 'build a bigger attack':
      return pick((a, b) => (wellScore(b.after) - wellScore(a.after)) || (a.newHoles - b.newHoles) || (a.after.max - b.after.max));
    case 'dig out the buried holes':
      return pick((a, b) => (a.after.holes - b.after.holes) || (b.cleared - a.cleared) || (a.after.max - b.after.max));
    default: // stay safe and keep the stack low
      return pick((a, b) => (a.newHoles - b.newHoles) || (a.after.max - b.after.max) || (a.after.bumpy - b.after.bumpy));
  }
}

function wellScore(a) {
  const h = a.heights, min = Math.min(...h), rest = h.filter(v => v !== min);
  if (!rest.length) return 0;
  const avgRest = rest.reduce((x, y) => x + y, 0) / rest.length;
  return avgRest - min;                       // one deep column, the others level
}


export function options(grid, piece, who) {
  const before = readBoard(grid);
  return placements(piece).map(p => {
    const placed = drop(grid, piece, p.rot, p.col);
    if (placed.some(([r]) => r < 0)) return null;
    const { grid: g2, cleared } = applied(grid, placed, who);
    const after = readBoard(g2);
    return {
      ...p, placed, cleared, grid: g2, after,
      newHoles: Math.max(0, after.holes - before.holes),
      garbage: GARBAGE[cleared] ?? 0,
      label: label(p)
    };
  }).filter(Boolean);
}

function describeOption(o, me) {
  const bits = [];
  if (o.cleared) bits.push(o.garbage
    ? `clears ${o.cleared} ${o.cleared > 1 ? 'lines' : 'line'} and sends ${o.garbage} garbage ${o.garbage > 1 ? 'rows' : 'row'} to the opponent`
    : `clears ${o.cleared} line and sends no garbage`);
  else bits.push('clears no lines');
  bits.push(o.newHoles ? `buries ${o.newHoles} new hole${o.newHoles > 1 ? 's' : ''}` : 'buries no new holes');
  bits.push(`leaves your stack ${o.after.max} of ${ROWS} rows high`);
  if (o.after.max >= ROWS - 3) bits.push('which is close to topping out');
  if (o.after.holes === 0 && o.after.max <= 6) bits.push('and keeps the board clean');
  return bits.join(', ');
}

// Garbage: solid rows pushed up from the bottom, one gap so they stay clearable.
function addGarbage(grid, n, holeCol) {
  let g = grid;
  for (let i = 0; i < n; i++) {
    const row = Array(COLS).fill(8); row[holeCol] = 0;
    g = [...g.slice(1), row];
  }
  return g;
}

export function createSide(side, seed, color = 1) {
  return {
    side, color, grid: empty(), next: bag(seed), piece: null,
    lat: new Latency(), lines: 0, sent: 0, received: 0, pieces: 0,
    dead: false, error: null, incoming: 0, holeCol: (seed % COLS),
    lastChoice: null, lastConf: null, lastLosing: null, lastFinish: null,
    plan: null, lastCleared: 0, log: [], cost: 0, tag: null
  };
}

export async function step(s, foe) {
  if (s.dead || s.error) return;

  if (s.incoming) {                       // take the hit before you choose
    s.grid = addGarbage(s.grid, s.incoming, s.holeCol);
    s.received += s.incoming; s.incoming = 0;
    if (readBoard(s.grid).max >= TOP_OUT) { s.dead = true; return; }
  }

  s.piece = s.piece ?? s.next();
  const opts = options(s.grid, s.piece, s.color);
  if (!opts.length) { s.dead = true; return; }

  // The model is asked for a STRATEGY, not a placement. Choosing between six
  // numerically-described placements is arithmetic, and arithmetic belongs in code;
  // deciding whether this is a moment to attack, to dig, or to stay safe is the
  // judgement a System One model is actually for.
  const me = readBoard(s.grid), them = readBoard(foe.grid);
  const canClear = Math.max(...opts.map(o => o.cleared));
  const bigReady = opts.some(o => o.cleared >= 3);

  const state = {
    game: 'versus tetris',
    rules: `Clearing lines sends garbage rows to your opponent. Four lines at once sends four rows. You lose the moment your stack reaches ${ROWS} rows.`,
    your_stack: `${me.max} of ${ROWS} rows high, with ${me.holes} buried holes blocking future line clears`,
    opponent_stack: `${them.max} of ${ROWS} rows high, with ${them.holes} buried holes`,
    this_piece: `you are holding an ${s.piece} piece`,
    available_now: canClear
      ? `this piece can clear ${canClear} line${canClear > 1 ? 's' : ''} right now if you spend it on that`
      : 'this piece cannot clear any line right now',
    bigger_attack_possible: bigReady
      ? 'a multi-line clear is available this turn'
      : 'no multi-line clear is available this turn',
    garbage_you_have_taken: s.received,
    garbage_you_have_sent: s.sent
  };

  const questions = {
    plan: {
      type: 'choice',
      instructions: 'What should you do with this piece?',
      criteria: {
        'clear lines now': 'spend the piece on the largest clear available this turn, sending garbage immediately even if it is only a small attack',
        'build a bigger attack': 'clear nothing this turn and keep one column open as a well, so a later piece can clear four rows at once and send four garbage rows',
        'dig out the buried holes': 'spend the piece uncovering holes that are blocking future line clears, accepting no attack this turn',
        'stay safe and keep the stack low': 'place the piece wherever keeps the stack lowest and flattest, taking no risk and making no attack'
      }
    },
    pressure: {
      type: 'noul',
      instructions: 'Are you in danger of topping out within the next few pieces?',
      criteria: { true: 'in danger of losing soon', false: 'the stack is under control' }
    },
    finish: {
      type: 'noul',
      instructions: 'Is your opponent close enough to losing that attacking right now would finish them?',
      criteria: { true: 'attack now and they will top out', false: 'they have room to survive' }
    }
  };

  let r;
  // a side that plays by sight gets only a picture of both boards and the rules, no numbers
  let images = null, sent = state;
  if (s.see) {
    images = [s.see(s, foe)];
    sent = {
      game: state.game, rules: state.rules,
      picture: 'The picture shows YOUR board on the left and your OPPONENT board on the right. Grey rows are garbage. The piece you are holding is drawn above your board.',
      this_piece: state.this_piece
    };
    s.lastImage = images[0];
  }
  try { r = await decide(s.side.replace(/-vision$/, '') + (s.see ? '-vision' : ''), sent, questions, s.tag, images); }
  catch (e) { s.error = e.message; return; }

  s.lat.add(r.latency_ms);
  s.cost += r.cost_usd ?? 0;
  const plan = r.answers.plan?.choice ?? 'stay safe and keep the stack low';
  s.lastConf = r.answers.plan?.confidence ?? null;
  s.lastLosing = r.answers.pressure?.noul ?? null;
  s.lastFinish = r.answers.finish?.noul ?? null;
  s.plan = plan;

  // Code turns the chosen strategy into an actual placement.
  const chosen = bestFor(plan, opts);

  s.grid = chosen.grid;
  s.lines += chosen.cleared;
  s.lastCleared = chosen.cleared;
  s.lastChoice = chosen.label;
  s.pieces++;
  s.log.unshift({ piece: s.piece, plan, label: chosen.label, cleared: chosen.cleared,
                  holes: chosen.newHoles, ms: r.latency_ms, conf: s.lastConf,
                  danger: s.lastLosing });
  s.log.length = Math.min(s.log.length, 8);

  if (chosen.garbage) { foe.incoming += chosen.garbage; s.sent += chosen.garbage; }
  if (readBoard(s.grid).max >= TOP_OUT) s.dead = true;
  s.piece = s.next();
}

export { readBoard };
