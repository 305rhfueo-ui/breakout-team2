'use strict';
// "과거 같은 셋업 성적" — 지난 2년 같은 조건 신호가 어떻게 됐나 (trader skill '타임머신' 생각을 일봉으로, 우리 코드로).
//   node scripts/odds.js     주 1회(월요일 아침) · 결과 state/odds.json
// 대상: 1팀 봉 캐시의 2년 일봉 전 종목(살아남은 종목만이라 실제보다 좋게 나올 수 있다 — 화면에 적는다).
// RS 상위 2%는 그날 캐시 종목 안에서 21·63·126일 수익률 순위로 근사한다(RS 사이트 원래 순위가 아님).
// 결과: 다음 날 시가 매수 → 5·20·60거래일 뒤 종가 수익률 · 모의투자 규칙(ADR 종가 손절, 촉매 없음 가정) 결과.
const fs = require('fs');
const path = require('path');
const { req, ROOT } = require('./lib/shared');
const { breakoutAt, arrays, smaAt, r2 } = require('./lib/core');
const { newPos, step, perf } = require('./lib/paper');

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function stats(ev) {
  const g = (k) => ev.map((e) => e[k]).filter((x) => x != null);
  const f = (k) => { const v = g(k); return v.length ? { n: v.length, win: r2(v.filter((x) => x > 0).length / v.length * 100, 0), med: r2(med(v), 1), avg: r2(v.reduce((s, x) => s + x, 0) / v.length, 1) } : null; };
  const rule = g('rule');
  return { n: ev.length, d5: f('r5'), d20: f('r20'), d60: f('r60'), rule: f('rule'), stopRate: rule.length ? r2(ev.filter((e) => e.stopped).length / ev.length * 100, 0) : null };
}

function main() {
  const { barDateET } = req('lib/bars');
  const root = path.join(process.env.HOME, 'Library', 'Caches', 'breakout-team', 'bars');
  const latest = {};
  for (const d of fs.readdirSync(root).sort()) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('_2y_1d.json')) latest[f.split('_')[0]] = path.join(root, d, f);
  const B = {};
  for (const [t, f] of Object.entries(latest)) {
    let b; try { b = (JSON.parse(fs.readFileSync(f, 'utf8')).bars || []).filter((x) => x.c && x.o && x.h && x.l); } catch (e) { continue; }
    if (b.length >= 250) B[t] = b.map((x) => ({ ...x, __d: barDateET(x.t) }));
  }
  const ETF = new Set(['QQQ', 'SPY', 'IWM', 'DIA']);
  const qqq = B.QQQ; if (!qqq) return { ok: false };
  const qi = new Map(qqq.map((x, i) => [x.__d, i])), qc = qqq.map((x) => x.c);
  const green = (d) => { const i = qi.get(d); return i != null && i >= 20 && smaAt(qc, 10, i) > smaAt(qc, 20, i); };
  // 날짜별 RS 백분위 (21/63/126일)
  const dates = qqq.map((x) => x.__d), ix = {}; for (const [t, b] of Object.entries(B)) ix[t] = new Map(b.map((x, i) => [x.__d, i]));
  const rsTop2 = new Map();
  for (let k = 126; k < dates.length; k++) {
    const d = dates[k];
    for (const L of [21, 63, 126]) {
      const vals = [];
      for (const [t, b] of Object.entries(B)) { if (ETF.has(t)) continue; const i = ix[t].get(d); if (i == null || i < L) continue; vals.push([b[i].c / b[i - L].c, t]); }
      vals.sort((a, b) => b[0] - a[0]); const cut = Math.max(1, Math.floor(vals.length * 0.02));
      for (let r = 0; r < cut; r++) rsTop2.set(`${vals[r][1]}|${d}`, true);
    }
  }
  const ev = [];
  for (const [t, b] of Object.entries(B)) {
    if (ETF.has(t)) continue;
    const A = arrays(b); let last = -99;
    for (let i = 170; i < b.length - 1; i++) {
      const j = breakoutAt(A, i);
      if (!j || !j.pass || i - last < 20) continue; last = i;
      const e = i + 1, entry = b[e].o, fwd = (n) => (e + n < b.length ? r2((b[e + n].c / entry - 1) * 100, 2) : null);
      const adr = b.slice(i - 19, i + 1).reduce((s, x) => s + (x.h / x.l - 1), 0) / 20 * 100;
      let p = newPos({ ticker: t, session: b[i].__d, adr, weightPct: 1, hi52: Math.max(...b.slice(Math.max(0, i - 251), i + 1).map((x) => x.h)), low: b[i].l }, b[e], 'adrClose');
      let k = e; for (; k < b.length && p.open; k++) p = step(p, b, k, false, A.bb);
      ev.push({ t, d: b[i].__d, rs2: !!rsTop2.get(`${t}|${b[i].__d}`), green: green(b[i].__d), r5: fwd(5), r20: fwd(20), r60: fwd(60),
        rule: p.open ? null : perf(p, b[b.length - 1].c).retPct, stopped: p.steps.some((s) => s.why.startsWith('손절')) });
    }
  }
  const out = { updated: new Date().toISOString(), universe: Object.keys(B).length, from: dates[0], to: dates[dates.length - 1],
    all: stats(ev), rs2: stats(ev.filter((e) => e.rs2)), rs2Green: stats(ev.filter((e) => e.rs2 && e.green)), rs2Red: stats(ev.filter((e) => e.rs2 && !e.green)),
    byTicker: ev.reduce((m, e) => ((m[e.t] = m[e.t] || []).push({ d: e.d, rs2: e.rs2, r20: e.r20, r60: e.r60, rule: e.rule }), m), {}),
    note: '살아남은 종목만(1팀 봉 캐시) · RS 2%는 캐시 종목 안 순위 근사 · 같은 종목 20일 안 반복 신호는 첫 번째만 · 매수 = 다음 날 시가 · 시장 차감 안 함' };
  fs.writeFileSync(path.join(ROOT, 'state', 'odds.json'), JSON.stringify(out) + '\n');
  console.log(`과거 같은 셋업: 종목 ${out.universe} · ${out.from}~${out.to} · 신호 ${ev.length} (RS2% ${out.rs2.n})`);
  console.log('전체', JSON.stringify(out.all)); console.log('RS2%', JSON.stringify(out.rs2)); console.log('RS2%·초록', JSON.stringify(out.rs2Green)); console.log('RS2%·빨강', JSON.stringify(out.rs2Red));
  return { ok: true };
}
module.exports = { stats };
if (require.main === module) process.exit(main().ok ? 0 : 1);
