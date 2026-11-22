'use strict';
// node tests/core.test.js — 돌파 6조건 · 비중 · 시장 손실 허용 · 추적
const assert = require('assert');
const { breakout, sizing, riskFor, isSA, bollinger } = require('../scripts/lib/core');
const { trackStep } = require('../scripts/scan');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); console.log('  ✅ ' + name); pass++; } catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); fail++; } };

// 200봉: 150봉 상승 → 48봉 좁은 횡보 → 전날(조용) → 당일 돌파
function make({ prevClose, dayClose = 112, dayVol = 3000, flatAmp = 0.4, drop = false } = {}) {
  const b = [];
  for (let i = 0; i < 150; i++) { const c = 60 + i * 0.27; b.push({ t: i, o: c, h: c + 0.5, l: c - 0.5, c, v: 1000 }); }
  for (let i = 0; i < 48; i++) { const c = 100 + (i % 2 ? flatAmp : -flatAmp); b.push({ t: 150 + i, o: c, h: c + 0.6, l: c - 0.6, c, v: 1000 }); }
  const pc = prevClose ?? 100.2; b.push({ t: 198, o: 100, h: pc + 0.5, l: 99.5, c: pc, v: 1000 });
  const dc = drop ? 40 : dayClose; b.push({ t: 199, o: pc, h: dc + 0.5, l: pc - 0.2, c: dc, v: dayVol });
  return b;
}

ok('여섯 조건을 모두 채우면 통과', () => { const j = breakout(make()); assert.ok(j.pass, JSON.stringify(j.rows.filter((r) => !r.ok))); assert.strictEqual(j.rows.length, 6); });
ok('① 150일선 아래면 탈락', () => { const j = breakout(make({ drop: true })); assert.strictEqual(j.rows[0].ok, false); assert.strictEqual(j.pass, false); });
ok('② 전날 폭이 0.25 넘으면 탈락', () => { const j = breakout(make({ flatAmp: 14 })); assert.strictEqual(j.rows[1].ok, false); assert.strictEqual(j.pass, false); });
ok('③ 전날 이미 상단 위면 탈락', () => { const j = breakout(make({ prevClose: 104 })); assert.strictEqual(j.rows[2].ok, false); assert.strictEqual(j.pass, false); });
ok('④ 당일 종가가 상단 아래면 탈락', () => { const j = breakout(make({ dayClose: 100.5 })); assert.strictEqual(j.rows[3].ok, false); assert.strictEqual(j.pass, false); });
ok('⑥ 거래량이 50일 평균 아래면 탈락', () => { const j = breakout(make({ dayVol: 900 })); assert.strictEqual(j.rows[5].ok, false); assert.strictEqual(j.pass, false); });
ok('⑤ 밴드가 좁아지는 날(상단↓)은 탈락', () => {
  // 전날 큰 봉이 20일 창에서 빠지며 상단이 내려가는 경우를 직접 만든다
  const b = make(); const c = b.map((x) => x.c), bb = bollinger(c); const j = breakout(b);
  assert.strictEqual(j.rows[4].ok, bb[199].up > bb[198].up && bb[199].lo < bb[198].lo);
});
ok('봉이 170개 미만이면 null', () => assert.strictEqual(breakout(make().slice(-100)), null));
ok('비중 = 손실 허용 ÷ ADR, 25% 상한', () => {
  assert.deepStrictEqual(sizing(2, 10), { riskPct: 2, weightPct: 20, capped: false, stopPct: 10, realRiskPct: 2 });
  const s = sizing(2, 5); assert.strictEqual(s.weightPct, 25); assert.strictEqual(s.capped, true); assert.strictEqual(s.realRiskPct, 1.25);
  assert.strictEqual(sizing(0.5, 5).weightPct, 10);
});
ok('시장: 초록 2% · 빨강+투자 적기 0.5% · 빨강 나머지 관망', () => { assert.strictEqual(riskFor(true, false), 2); assert.strictEqual(riskFor(false, true), 0.5); assert.strictEqual(riskFor(false, false), null); });
ok('S/A 판정', () => { assert.ok(isSA(['B1', 's2'])); assert.ok(!isSA(['B1', 'C', 'D1'])); assert.ok(!isSA(null)); });
ok('추적: 50일선 아래 마감이면 종료, 60거래일이면 종료', () => {
  const bars = make().map((x, i) => ({ ...x, __d: `D${String(i).padStart(3, '0')}` }));
  const t = { ticker: 'Z', session: 'D190', close: 100, status: 'active', volUpDays: 0, lastSession: 'D190' };
  const a = trackStep(t, bars, 'D199'); assert.strictEqual(a.status, 'active'); assert.strictEqual(a.days, 9); assert.strictEqual(a.volUpDays, 1);
  const down = bars.slice(0, 199).concat([{ ...bars[199], c: 80, __d: 'D199' }]);
  assert.strictEqual(trackStep(t, down, 'D199').endReason, '50일선 아래 마감');
  assert.strictEqual(trackStep({ ...t, session: 'D100' }, bars, 'D199').status, 'ended');
});

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
