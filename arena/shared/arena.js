// Shared harness: same seed, same payload, one shared pace.

export function rng(seed) {                    // mulberry32 — identical stream both sides
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function decide(side, state, questions, tag = null, images = null) {
  const t0 = performance.now();
  const r = await fetch('/api/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side, state, questions, tag, images })
  });
  const wall = performance.now() - t0;
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  j.wall_ms = wall;
  return j;
}

export class Latency {                          // p50/p90 over the run
  constructor() { this.samples = []; }
  add(ms) { this.samples.push(ms); }
  pct(p) {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }
  get p50() { return this.pct(0.5); }
  get p90() { return this.pct(0.9); }
  get perSec() { return this.p50 ? 1000 / this.p50 : 0; }
  get n() { return this.samples.length; }
}

// Calibration: the model said p; was it actually safe? Ten bins, live.
export class Calibration {
  constructor(bins = 10) {
    this.bins = Array.from({ length: bins }, () => ({ n: 0, hit: 0, sum: 0 }));
  }
  add(p, outcome) {
    const i = Math.min(this.bins.length - 1, Math.floor(p * this.bins.length));
    const b = this.bins[i];
    b.n++; b.sum += p; b.hit += outcome ? 1 : 0;
  }
  get total() { return this.bins.reduce((a, b) => a + b.n, 0); }
  get ece() {                                   // expected calibration error
    const N = this.total; if (!N) return null;
    return this.bins.reduce((acc, b) =>
      b.n ? acc + (b.n / N) * Math.abs(b.hit / b.n - b.sum / b.n) : acc, 0);
  }
  rows() {
    return this.bins.map((b, i) => ({
      lo: i / this.bins.length, hi: (i + 1) / this.bins.length,
      n: b.n, said: b.n ? b.sum / b.n : null, was: b.n ? b.hit / b.n : null
    }));
  }
}

// One shared pace, derived from the slowest side's measured latency —
// so a speed gap never decides a game that is meant to test judgement.
export class Pacer {
  constructor(floorMs = 120) { this.floor = floorMs; this.slowest = floorMs; }
  observe(ms) { this.slowest = Math.max(this.slowest, ms); }
  async tick(startedAt) {
    const wait = this.slowest - (performance.now() - startedAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
}

export const fmt = {
  ms: v => `${Math.round(v)} ms`,
  pct: v => v == null ? '—' : `${(v * 100).toFixed(1)}%`,
  n3: v => v == null ? '—' : v.toFixed(3)
};
