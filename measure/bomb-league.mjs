// Four-player bomb battles, headless, against the real arena server.
// Spawn corners rotate across games so nobody keeps the same corner.
// usage: node measure/bomb-league.mjs <out-name> <seed> [<seed> ...]
globalThis.performance ??= { now: () => Date.now() };
const BASE = process.env.ARENA || 'http://localhost:8750';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(u.startsWith('http') ? u : BASE + u, o);
const B = await import('../arena/bomb/game.js');
const fs = await import('node:fs/promises');
const MODELS = (process.env.MODELS || 'laya,jev,openai,d1').split(',');
const [outName, ...seedArgs] = process.argv.slice(2);
const games = [];
for (const [i, seed] of seedArgs.map(Number).entries()) {
  const order = MODELS.map((_, j) => MODELS[(j + i) % MODELS.length]);
  const g = B.createGame(seed, order);
  for (const p of g.players) p.tag = `${outName}:${seed}`;
  while (!g.over) await B.turn(g);
  const row = { seed, order, turns: g.turn, winner: g.winner, placings: B.placings(g), feed: g.feed };
  games.push(row);
  console.log(`seed ${seed} turns ${g.turn} winner ${g.winner}  ` + row.placings.map(p => `${p.place}.${p.side}(k${p.kills},c${p.crates},d${p.diedAt ?? '-'}${p.killedBy ? '<' + p.killedBy : ''}${p.error ? ' ERR' : ''})`).join(' '));
  await fs.writeFile(new URL(`../evidence/${outName}.json`, import.meta.url),
    JSON.stringify({ measured_at: new Date().toISOString(), models: MODELS, games }, null, 2));
}
const wins = Object.fromEntries(MODELS.map(m => [m, 0])); wins.draw = 0;
for (const g of games) wins[g.winner ?? 'draw']++;
console.log('\nwins', JSON.stringify(wins));
