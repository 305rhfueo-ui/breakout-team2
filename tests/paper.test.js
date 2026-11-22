'use strict';
// node tests/paper.test.js — 모의투자 매도 규칙
const assert = require('assert');
const { newPos, step, perf, openRisk } = require('../scripts/lib/paper');
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✅ ' + n); pass++; } catch (e) { console.log('  ❌ ' + n + '\n     ' + e.message); fail++; } };

// 220봉 완만한 상승 뒤 시나리오 봉을 붙인다
const base = Array.from({ length: 220 }, (_, i) => { const c = 50 + i * 0.25; return { __d: `D${String(i).padStart(3, '0')}`, o: c, h: c + 0.3, l: c - 0.3, c, v: 1000 }; });
const add = (bars, rows) => bars.concat(rows.map((r, k) => ({ __d: `E${String(k).padStart(3, '0')}`, v: 1000, ...r })));
const sig = { ticker: 'Z', session: 'D219', adr: 5, weightPct: 25, hi52: 105, low: 103 };
const run = (bars, from, mode, cat = false, hi52 = 999) => { let p = newPos({ ...sig, hi52 }, bars[from], mode); for (let i = from; i < bars.length; i++) p = step(p, bars, i, cat); return p; };

ok('ADR 종가 손절: 종가가 매수가×(1−ADR) 아래 → 다음 날 시가에 전부', () => {
  const b = add(base, [{ o: 105, h: 105.5, l: 104, c: 104.5 }, { o: 104, h: 104.2, l: 99, c: 99.5 }, { o: 98, h: 99, l: 97, c: 98 }]);
  const p = run(b, 220, 'adrClose');
  assert.strictEqual(p.open, false); assert.strictEqual(p.steps[0].why, '손절(ADR 종가)'); assert.strictEqual(p.steps[0].px, 98); assert.strictEqual(p.exitDate, 'E002');
});
ok('장중 손절(비교용)은 그날 손절가에 체결', () => {
  const b = add(base, [{ o: 105, h: 105.5, l: 104, c: 104.5 }, { o: 104, h: 104.2, l: 99, c: 100.5 }]);
  const p = run(b, 220, 'adrIntraday'); assert.strictEqual(p.open, false); assert.strictEqual(p.steps[0].px, 99.75);
});
ok('신고가인데 상단 아래 마감 → 1/3 · 그 뒤엔 손절 안 걸림', () => {
  const rows = [{ o: 105, h: 106, l: 104.8, c: 105.8 }];
  for (let k = 0; k < 6; k++) rows.push({ o: 106 + k, h: 107.5 + k, l: 105.5 + k, c: 107 + k });
  rows.push({ o: 112, h: 113.5, l: 109, c: 110 });          // 신고가지만 상단 아래 마감(이 봉에서 판단)
  rows.push({ o: 110, h: 110.5, l: 108, c: 109 });
  const b = add(base, rows); const p = run(b, 220, 'adrClose', false, 105);
  const s = p.steps.find((x) => x.why.startsWith('신고가')); assert.ok(s, JSON.stringify(p.steps)); assert.ok(Math.abs(s.frac - 1 / 3) < 1e-3); assert.ok(p.open);
});
ok('20일선 이탈: 촉매 없으면 전부, 있으면 2/3만', () => {
  const rows = [{ o: 105, h: 105.6, l: 104.6, c: 105.4 }];
  for (let k = 0; k < 4; k++) rows.push({ o: 105.4, h: 105.6, l: 105.1, c: 105.3 });
  rows.push({ o: 105, h: 105.1, l: 101.5, c: 101.8 }, { o: 101.5, h: 102, l: 101, c: 101.6 });
  const b = add(base, rows);
  const a = run(b, 220, 'adrClose', false), c = run(b, 220, 'adrClose', true);
  assert.strictEqual(a.steps.at(-1).why, '20일선 이탈 → 전부 (촉매 없음)'); assert.strictEqual(a.open, false);
  assert.ok(c.steps.at(-1).why.includes('2/3')); assert.ok(c.open && Math.abs(c.left - 1 / 3) < 1e-3);
});
ok('수익률·계좌 기여·위험', () => {
  const p = { entry: 100, weightPct: 20, left: 0.5, steps: [{ frac: 0.5, px: 110 }], open: true, s1: false, s20: false, stop: 95 };
  assert.deepStrictEqual(perf(p, 120), { retPct: 15, acctPct: 3 }); assert.strictEqual(openRisk(p), 0.5);
  assert.strictEqual(openRisk({ ...p, s1: true }), 0);
});
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
