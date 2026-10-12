import { decide } from '../shared/arena.js';
const MODELS = {
  laya:   { name: 'Laya', who: '내 맥 · 무료', c: 'var(--laya)' },
  jev:    { name: 'Jev', who: 'TypeSafe', c: 'var(--jev)' },
  openai: { name: 'Decisions API', who: 'OpenAI', c: 'var(--openai)' },
  d1:     { name: 'Decision-1', who: 'Microsoft', c: 'var(--d1)' },
};
const q = new URLSearchParams(location.search);
const preset = {
  state: q.get('state') ?? '',
  question: q.get('question') ?? '',
  choices: (q.get('choices') ?? '').split('|').filter(Boolean),
};
const $ = s => document.querySelector(s);
$('#state').value = q.get('fill') === '1' ? preset.state : '';
$('#question').value = q.get('fill') === '1' ? preset.question : '';
$('#choices').innerHTML = preset.choices.map(c => `<span>${c}</span>`).join('');
const cards = {};
for (const [k, m] of Object.entries(MODELS)) {
  const d = document.createElement('div');
  d.className = 'card wait'; d.style.setProperty('--c', m.c);
  d.innerHTML = `<div class="h"><span class="n">${m.name}</span><span class="w">${m.who}</span><span class="ms">—</span></div>
    <div class="ans">대기 중</div><div class="bars"></div><div class="meta"></div>`;
  $('#cards').append(d); cards[k] = d;
}
async function ask() {
  const state = $('#state').value, question = $('#question').value;
  const criteria = Object.fromEntries(preset.choices.map(c => [c, c]));
  const questions = { answer: { type: 'choice', instructions: question, criteria } };
  $('#go').classList.add('busy');
  for (const d of Object.values(cards)) { d.className = 'card wait'; d.querySelector('.ans').textContent = '생각 중…'; d.querySelector('.bars').innerHTML = ''; d.querySelector('.ms').textContent = '…'; d.querySelector('.meta').textContent = ''; }
  const results = {};
  await Promise.all(Object.keys(MODELS).map(async k => {
    const d = cards[k];
    try {
      const r = await decide(k, state, questions, 'ask');
      const a = r.answers.answer;
      results[k] = { choice: a.choice, probabilities: a.probabilities, latency_ms: r.latency_ms, usage: r.usage, cost_usd: r.cost_usd };
      d.className = 'card';
      d.querySelector('.ms').textContent = `${Math.round(r.latency_ms)}ms`;
      d.querySelector('.ans').textContent = a.choice;
      d.querySelector('.bars').innerHTML = preset.choices.map(c => {
        const p = a.probabilities?.[c] ?? 0;
        return `<div class="bar"><span>${c}</span><i><em style="width:${(p * 100).toFixed(1)}%"></em></i><b>${(p * 100).toFixed(0)}%</b></div>`;
      }).join('');
      const tok = r.usage?.input_tokens;
      d.querySelector('.meta').textContent = k === 'laya' ? '내 맥에서 계산 · 비용 0원' : `입력 ${tok ?? '—'}토큰 · $${(r.cost_usd ?? 0).toFixed(7)}`;
    } catch (e) { d.querySelector('.ans').textContent = '오류'; d.querySelector('.meta').textContent = e.message.slice(0, 60); results[k] = { error: e.message }; }
  }));
  $('#go').classList.remove('busy');
  window.lastAsk = results;
}
$('#go').onclick = ask;
window.ask = ask;
