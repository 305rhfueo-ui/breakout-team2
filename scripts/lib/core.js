'use strict';
// 팀2 판정 — 순수 함수만 (테스트 대상). 봉: { t, o, h, l, c, v } 배열, 마지막 봉 = 판정할 장(D).
const { req } = require('./shared');
const { bollinger } = req('bb-squeeze-watch');   // 하율과 같은 식 (20일·2σ·표본표준편차 = RS 사이트 BBWTHD)

const RULE = { th: 0.25, rsTop: 2, ma: 150, volK: 1, trackDays: 60, capPct: 25, riskGreen: 2, riskRed: 0.5, riskSum: 6 };
const r2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const smaAt = (a, n, i) => (i + 1 < n ? null : a.slice(i + 1 - n, i + 1).reduce((s, x) => s + x, 0) / n);

// 1단계 돌파 — 사용자 확정 6개 조건 (2026-11-22). 배열 위치 D 하나를 판정 (실전·과거 성적 계산이 같은 코드를 쓴다)
//   A = { c, v, bb } (bb = bollinger(c)) — 같은 종목을 여러 날 볼 때 한 번만 계산
function breakoutAt(A, D) {
  const { c, v, bb } = A, P = D - 1, b = bb[D], p = bb[P];
  if (D < 169 || !b || !p) return null;
  const ma150 = smaAt(c, 150, D), v50 = smaAt(v, 50, D), volX = v50 ? v[D] / v50 : null;
  const rows = [
    { no: '1', item: '종가가 150일선 위', ok: c[D] > ma150, detail: `종가 ${r2(c[D])} · 150일선 ${r2(ma150)}` },
    { no: '2', item: `전날 볼린저 폭 ${RULE.th} 이하`, ok: p.bbw <= RULE.th, detail: `전날 ${r2(p.bbw, 3)} → 당일 ${r2(b.bbw, 3)}` },
    { no: '3', item: '전날 종가는 상단 밴드 아래', ok: c[P] <= p.up, detail: `전날 종가 ${r2(c[P])} · 상단 ${r2(p.up)}` },
    { no: '4', item: '당일 종가가 상단 밴드 위 (돌파)', ok: c[D] > b.up, detail: `종가 ${r2(c[D])} · 상단 ${r2(b.up)}` },
    { no: '5', item: '상단 밴드 ↑ · 하단 밴드 ↓', ok: b.up > p.up && b.lo < p.lo, detail: `상단 ${r2(p.up)}→${r2(b.up)} · 하단 ${r2(p.lo)}→${r2(b.lo)}` },
    { no: '6', item: '거래량 50일 평균 위', ok: volX > RULE.volK, detail: `${r2(volX)}배` },
  ];
  return { pass: rows.every((r) => r.ok), rows, volX: r2(volX), bbwPrev: r2(p.bbw, 3), bbw: r2(b.bbw, 3), up: r2(b.up), lo: r2(b.lo), mid: r2((b.up + b.lo) / 2), close: c[D], ma150: r2(ma150) };
}
const arrays = (bars) => { const c = bars.map((b) => b.c); return { c, v: bars.map((b) => b.v || 0), bb: bollinger(c) }; };
function breakout(bars) { return bars.length < 170 ? null : breakoutAt(arrays(bars), bars.length - 1); }

// ADR % (RS 사이트 정의: (고가−저가)/저가 의 20일 평균)
function adrPct(bars) {
  const n = bars.length; if (n < 20) return null;
  return r2(bars.slice(-20).reduce((s, b) => s + (b.h / b.l - 1), 0) / 20 * 100);
}

// 투자 비중 — RS 사이트 단기 투자비중 계산기와 같은 식(비중 = 손실 허용 ÷ ADR) + 한 종목 상한
function sizing(riskPct, adr, capPct = RULE.capPct) {
  if (!riskPct || !adr) return null;
  const raw = riskPct / adr * 100;
  return { riskPct, weightPct: r2(Math.min(raw, capPct), 1), capped: raw > capPct, stopPct: r2(adr, 1), realRiskPct: r2(Math.min(raw, capPct) * adr / 100, 2) };
}

// 시장 조건 → 손실 허용 % (초록 2 · 빨강이면 '투자 적기'만 0.5 · 나머지 관망 = null)
function riskFor(regimeGreen, timely) { return regimeGreen ? RULE.riskGreen : timely ? RULE.riskRed : null; }

const GOOD = new Set(['S1', 'S2', 'A1', 'A2', 'A3']);
const isSA = (grades) => (grades || []).some((g) => GOOD.has(String(g).toUpperCase()));

module.exports = { RULE, breakout, breakoutAt, arrays, adrPct, sizing, riskFor, isSA, smaAt, r2, bollinger };
