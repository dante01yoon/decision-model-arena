// Round-robin versus tetris between four decision models, headless, against the
// real arena server. Every pairing plays every seed, so the record is not one lucky game.
// usage: node measure/tournament.mjs <out-name> <seed> [<seed> ...]
globalThis.performance ??= { now: () => Date.now() };
const BASE = process.env.ARENA || 'http://localhost:8750';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(u.startsWith('http') ? u : BASE + u, o);
const G = await import('../arena/tetris/game.js');
const fs = await import('node:fs/promises');

const MODELS = (process.env.MODELS || 'laya,jev,openai,d1').split(',');
const [outName, ...seedArgs] = process.argv.slice(2);
const SEEDS = seedArgs.map(Number);
const PAIRS = [];
for (let i = 0; i < MODELS.length; i++)
  for (let j = i + 1; j < MODELS.length; j++) PAIRS.push([MODELS[i], MODELS[j]]);

// a side that topped out loses; otherwise more lines, then more garbage sent, then more pieces
function winnerOf(a, b, A, B) {
  if (A.dead !== B.dead) return A.dead ? b : a;
  for (const k of ['lines', 'sent', 'pieces']) if (A[k] !== B[k]) return A[k] > B[k] ? a : b;
  return 'draw';
}

const summary = s => ({ lines: s.lines, sent: s.sent, received: s.received, pieces: s.pieces,
  dead: s.dead, error: s.error, p50_ms: Math.round(s.lat.p50), cost_usd: +s.cost.toFixed(6),
  plans: s.plans });

const matches = [];
for (const seed of SEEDS) for (const [a, b] of PAIRS) {
  const S = { [a]: G.createSide(a, seed, 1), [b]: G.createSide(b, seed, 2) };
  for (const k of [a, b]) { S[k].tag = `${outName}:${a}-${b}:${seed}`; S[k].plans = {}; }
  let turns = 0;
  while (turns < 300) {
    const live = [a, b].filter(k => !S[k].dead && !S[k].error);
    if (live.length < 2) break;
    await Promise.all(live.map(async k => {
      await G.step(S[k], S[k === a ? b : a]);
      if (S[k].plan && !S[k].error) S[k].plans[S[k].plan] = (S[k].plans[S[k].plan] ?? 0) + 1;
    }));
    turns++;
  }
  const err = S[a].error || S[b].error;
  const row = { seed, a, b, turns, winner: err ? 'void' : winnerOf(a, b, S[a], S[b]),
                [a]: summary(S[a]), [b]: summary(S[b]) };
  matches.push(row);
  console.log(`seed ${seed}  ${a.padEnd(6)} vs ${b.padEnd(6)} → ${row.winner.padEnd(6)} ` +
    `${S[a].lines}L/${S[a].sent}g ${S[a].dead ? 'X' : 'o'}  vs  ${S[b].lines}L/${S[b].sent}g ${S[b].dead ? 'X' : 'o'}  turns ${turns}` +
    (err ? `  ERR ${err}` : ''));
  await fs.writeFile(new URL(`../evidence/${outName}.json`, import.meta.url),
    JSON.stringify({ measured_at: new Date().toISOString(), models: MODELS, seeds: SEEDS, matches }, null, 2));
}

const table = Object.fromEntries(MODELS.map(m => [m, { w: 0, l: 0, d: 0, void: 0 }]));
for (const r of matches) {
  if (r.winner === 'void') { table[r.a].void++; table[r.b].void++; }
  else if (r.winner === 'draw') { table[r.a].d++; table[r.b].d++; }
  else { table[r.winner].w++; table[r.winner === r.a ? r.b : r.a].l++; }
}
console.log('\nstandings', JSON.stringify(table));
