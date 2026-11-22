'use strict';
// node tests/misc.test.js — 뉴스 합치기 · 후보 순위 · 실장 결과 검사 · 화면 문구
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { merge } = require('../scripts/news');
const { rankCandidates, gradeTargets } = require('../scripts/prepare');
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✅ ' + n); pass++; } catch (e) { console.log('  ❌ ' + n + '\n     ' + e.message); fail++; } };

ok('뉴스: 같은 URL·같은 제목은 하나만, 오래된 건 뺌, 유료 표시, 새 기사 표시', () => {
  const a = [{ title: 'Big News!', url: 'https://x.com/a?u=1', date: '2026-11-20', via: 'Nasdaq' }, { title: 'big news', url: 'https://y.com/b', date: '2026-11-19', via: 'Yahoo' }];
  const b = [{ title: 'Old', url: 'https://x.com/o', date: '2026-08-01', via: 'CNBC' }, { title: 'WSJ story', url: 'https://www.wsj.com/s', date: '2026-11-18', via: 'Yahoo' }];
  const m = merge([a, b], new Set(['https://www.wsj.com/s']), 45, '2026-11-21');
  assert.deepStrictEqual(m.map((x) => x.title), ['Big News!', 'WSJ story']);
  assert.strictEqual(m[1].paywall, true); assert.strictEqual(m[1].isNew, false); assert.strictEqual(m[0].isNew, true);
});
ok('후보 순위: ★ → RS 2% → S/A 만, 둘 다 아니면 빠짐', () => {
  const it = (t, rs2, top) => ({ ticker: t, rs2, rsTop: { m1: top, m3: 50, m6: 50 } });
  const r = rankCandidates([it('N', false, 50), it('R2', true, 1.5), it('R1', true, 0.5), it('C', false, 40), it('S', true, 1.9)], { C: { grades: ['A1'] }, S: { grades: ['S2'] }, R1: { grades: ['D1'] } });
  assert.deepStrictEqual(r.map((x) => x.ticker), ['S', 'R1', 'R2', 'C']); assert.ok(r[0].star); assert.ok(!r[1].star);
});
ok('등급 대상: 오늘 돌파 + 추적 중 새 실적 공시', () => {
  const tg = gradeTargets({ session: '2026-11-20', items: [{ ticker: 'A' }] }, { items: [{ ticker: 'B', status: 'active', session: '2026-11-01' }, { ticker: 'C', status: 'active', session: '2026-11-01' }] },
    { B: { items: [{ via: 'SEC', title: 'SEC 8-K · 실적 (실적 발표)', date: '2026-11-19' }] }, C: { items: [{ via: 'SEC', title: 'SEC 8-K · 기타', date: '2026-11-19' }] } }, {});
  assert.deepStrictEqual([...tg.keys()], ['A', 'B']);
});
ok('공개 화면·스크립트에 금액·수량을 저장하지 않는다', () => {
  for (const f of ['scripts/finish.js', 'scripts/scan.js']) assert.ok(!/shares|qty|quantity/i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), f);
});
ok('화면: 탭 4개 · 계산기 · 전략 설명 링크 · 판단 보조 문구', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const k of ['data-tab="rs"', 'data-tab="cat"', 'data-tab="track"', 'data-tab="paper"', '투자비중계산기', 'strategy.html', '최종 결정']) assert.ok(h.includes(k), k);
});
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
