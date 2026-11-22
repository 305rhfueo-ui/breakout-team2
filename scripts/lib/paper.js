'use strict';
// 팀2 모의투자 장부 — 순수 함수. 금액·수량 없음: 비중(계좌 대비 %)과 가격·수익률만 기록한다 (공개 저장소).
// 규칙 (사용자 확정 2026-11-22) — 판단은 종가, 실행은 다음 장 시가:
//   손절: 첫 분할 매도 전, 종가 ≤ 매수가×(1−ADR) → 전부 (비교용: 'adrIntraday' 장중 저가 · 'lod' 돌파일 저가)
//   신고가 1/3: 신고가를 낸 날 종가가 상단 밴드 아래 → 1/3
//   20일선 이탈: 촉매(S/A) 있으면 남은 것의 2/3, 없으면 전부 → (촉매) 50일선 이탈 2/3 → 200일선 이탈 전부
const { bollinger, smaAt, r2 } = require('./core');

function newPos(sig, entryBar, mode = 'adrClose') {
  const stopRef = mode === 'lod' ? sig.low : entryBar.o * (1 - sig.adr / 100);
  return { ticker: sig.ticker, signal: sig.session, entryDate: entryBar.__d, entry: entryBar.o, weightPct: sig.weightPct, adr: sig.adr,
    stop: r2(stopRef), hi: sig.hi52 || entryBar.h, left: 1, steps: [], s1: false, s20: false, s50: false, open: true, pending: null, catalyst: !!sig.catalyst, mode };
}

// 봉 하나 처리. bars = 그 종목 전체 봉(__d 날짜), i = 오늘 봉 위치. catalyst = 오늘까지 S/A 확인 여부.
function step(p, bars, i, catalyst, bbArr = null) {   // bbArr: 미리 계산한 bollinger(종가) — 여러 날 돌릴 때 속도용
  if (!p.open) return p;
  const b = bars[i], c = bars.map((x) => x.c);
  p = { ...p, steps: [...p.steps], catalyst: p.catalyst || !!catalyst };
  // ① 어제 종가로 정한 매도를 오늘 시가에 실행
  if (p.pending) {
    const q = p.pending.frac * p.left;
    p.steps.push({ date: b.__d, why: p.pending.why, frac: r2(q, 4), px: b.o, retPct: r2((b.o / p.entry - 1) * 100, 2) });
    p.left = r2(p.left - q, 6); p.pending = null;
    if (p.left <= 1e-6) { p.open = false; p.exitDate = b.__d; return p; }
  }
  // ② 오늘 종가로 판단 → 내일 시가
  const bb = (bbArr || bollinger(c.slice(0, i + 1)))[i];
  const m20 = smaAt(c, 20, i), m50 = smaAt(c, 50, i), m200 = smaAt(c, 200, i);
  const early = !p.s1 && !p.s20;
  if (early && p.mode === 'adrIntraday' && b.l <= p.stop) {   // 비교용: 장중 손절은 그 자리에서
    const px = Math.min(p.stop, b.o); p.steps.push({ date: b.__d, why: '손절(장중)', frac: p.left, px: r2(px), retPct: r2((px / p.entry - 1) * 100, 2) });
    p.left = 0; p.open = false; p.exitDate = b.__d; return p;
  }
  if (early && p.mode !== 'adrIntraday' && b.c <= p.stop) { p.pending = { frac: 1, why: p.mode === 'lod' ? '손절(돌파일 저가)' : '손절(ADR 종가)' }; return p; }
  if (b.h > p.hi) {
    p.hi = b.h;
    if (!p.s1 && bb && b.c < bb.up) { p.s1 = true; p.pending = { frac: 1 / 3, why: '신고가 · 상단 아래 마감 → 1/3' }; return p; }
  }
  if (!p.s20 && m20 && b.c < m20) { p.s20 = true; p.pending = p.catalyst ? { frac: 2 / 3, why: '20일선 이탈 → 남은 것의 2/3 (촉매 있음)' } : { frac: 1, why: '20일선 이탈 → 전부 (촉매 없음)' }; return p; }
  if (p.s20 && !p.s50 && m50 && b.c < m50) { p.s50 = true; p.pending = { frac: 2 / 3, why: '50일선 이탈 → 남은 것의 2/3' }; return p; }
  if (p.s50 && m200 && b.c < m200) { p.pending = { frac: 1, why: '200일선 이탈 → 전부' }; return p; }
  return p;
}

// 포지션 수익률(포지션 기준 %) — 판 부분 + 남은 부분(평가)
function perf(p, lastClose) {
  const sold = p.steps.reduce((s, x) => s + x.frac * (x.px / p.entry - 1), 0);
  const ret = sold + p.left * (lastClose / p.entry - 1);
  return { retPct: r2(ret * 100, 2), acctPct: r2(ret * p.weightPct, 3) };
}

// 손절 전 위험(계좌 대비 %) — 합계 6% 한도 판정용
const openRisk = (p) => (p.open && !p.s1 && !p.s20 ? r2(p.weightPct * p.left * (1 - p.stop / p.entry), 3) : 0);

module.exports = { newPos, step, perf, openRisk };
