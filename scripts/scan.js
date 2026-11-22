'use strict';
// 팀2 아침 스캔 — 1단계 돌파 찾기(코드만) + 추적 목록 갱신. AI 없음.
//   node scripts/scan.js [--no-fetch]   결과: state/today.json · state/track.json · data/ohlc/*.js
// 1차 거름은 RS 사이트 자료로 (야후 예절): ETF 제외 · 150일선 위 · 당일 상승 · 전날 폭 ≤0.25 · 당일 폭 ≥ 전날 폭×0.98
// 봉 판정 조건(6개)은 lib/core.js breakout() — 사용자 확정 2026-11-22.
const fs = require('fs');
const path = require('path');
const { req, ROOT } = require('./lib/shared');
const { RULE, breakout, adrPct, r2, smaAt } = require('./lib/core');
const U = req('lib/util');

const STATE = path.join(ROOT, 'state');
const HIST = 'https://305rhfueo-ui.github.io/RS_Investment/static/history/result_';
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n'); };

// 전날 장의 BBWTHD — 사이트 라벨은 UTC 완료일이라 라벨 L 은 'L 전 마지막 거래일' 장을 담는다.
// 그래서 장 S 의 전날 장은 라벨 ≤ S 중 가장 늦은 것. (주말 라벨 11-21·11-22 는 둘 다 11-20 장 — 'label−1' 로 찾으면 당일 폭이 나온다, 2026-11-22 실측)
// 하율과 같은 캐시 이름을 써서 하루 한 번만 받는다.
async function prevBbw(session) {
  const { fetchText, parseLooseJson } = req('fetch-rs-data');
  const cache = req('lib/cache');
  for (let k = 0; k <= 6; k++) {
    const d = new Date(`${session}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - k);
    const key = d.toISOString().slice(0, 10);
    const map = await cache.through('rsHistoryBbw', key, async () => {
      try { const j = parseLooseJson(await fetchText(`${HIST}${key}.json`, 40000)); const m = {}; for (const r of (Array.isArray(j) ? j : j.data || [])) if (r.Ticker && r.BBWTHD != null) m[r.Ticker] = r.BBWTHD; return m; } catch (e) { return null; }
    }, cache.DAY * 30);
    if (map && Object.keys(map).length) return { date: key, map };
  }
  return null;
}

// 사이트 행 → RS 상위 %(작을수록 강함) · 같은 업종 강한 종목 (라온 체크리스트 입력 모양)
function ranksOf(rows) {
  const top = (p) => (p == null ? null : r2(100 - p, 1)), m = new Map(), byInd = new Map();
  for (const r of rows) { const p = r.__p || {}; m.set(r.Ticker, { m1: top(p.RS_1mo), m3: top(p.RS_3mo), m6: top(p.RS_6mo), industry: r.Industry || '' }); }
  for (const [T, x] of m) if (x.industry && [x.m1, x.m3, x.m6].some((v) => v != null && v <= RULE.rsTop)) byInd.set(x.industry, [...(byInd.get(x.industry) || []), T]);
  for (const [T, x] of m) x.peers = (byInd.get(x.industry) || []).filter((u) => u !== T).slice(0, 8);
  return m;
}

// 추적 하루치 갱신 — 순수 함수 (봉 = 그 종목의 오늘까지 봉)
function trackStep(t, bars, session) {
  if (t.status !== 'active' || !bars || !bars.length) return t;
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v || 0), D = bars.length - 1, last = bars[D];
  const since = bars.filter((b) => b.__d > t.session);
  const ma50 = smaAt(c, 50, D), ma150 = smaAt(c, 150, D), v50 = smaAt(v, 50, D);
  const out = { ...t, lastSession: session, days: since.length, retPct: r2((last.c / t.close - 1) * 100, 1), above50: ma50 != null ? last.c > ma50 : null, above150: ma150 != null ? last.c > ma150 : null };
  if (session > (t.lastSession || t.session) && D > 0 && last.c > c[D - 1] && v[D] > v50) out.volUpDays = (t.volUpDays || 0) + 1;
  if (out.above50 === false) { out.status = 'ended'; out.endReason = '50일선 아래 마감'; out.endSession = session; }
  else if (out.days >= RULE.trackDays) { out.status = 'ended'; out.endReason = `${RULE.trackDays}거래일 경과`; out.endSession = session; }
  return out;
}

async function main() {
  U.loadEnv();
  const { fetchRsData } = req('fetch-rs-data');
  const { rankPercentiles } = req('lib/percentile');
  const { fetchMany, barDateET } = req('lib/bars');
  const { gradeSetup } = req('lib/setup-grade');
  const { loadRules } = req('lib/rules');
  const { qullamaggieRegime } = req('lib/regime');
  const UC = req('lib/user-checklist');

  // --label=YYYY-MM-DD : 사이트 히스토리 파일로 지난 장을 다시 판정 (되돌려 돌리기·검증용)
  const argLabel = (process.argv.find((x) => x.startsWith('--label=')) || '').slice(8);
  let rows, meta;
  if (argLabel) {
    const { fetchText, parseLooseJson, normalize } = req('fetch-rs-data');
    const j = parseLooseJson(await fetchText(`${HIST}${argLabel}.json`, 40000));
    rows = normalize(j); meta = { last_updated: argLabel };
  } else ({ rows, meta } = await fetchRsData());
  const label = String(meta.last_updated || U.today()).slice(0, 10);
  rankPercentiles(rows);
  const ranks = ranksOf(rows), byT = new Map(rows.map((r) => [r.Ticker, r]));
  const q0 = (await fetchMany(['QQQ'], { range: '2y', label: '팀2 QQQ' })).results.get('QQQ');
  const qb = q0 && q0.ok ? q0.bars.filter((b) => barDateET(b.t) < label) : [];
  if (!qb.length) { U.say('WARN', '팀2: QQQ 봉 없음 — 건너뜀'); return { ok: false }; }
  const session = barDateET(qb[qb.length - 1].t);
  const prev = await prevBbw(session);
  if (!prev) { U.say('WARN', '팀2: 전날 볼린저 폭을 못 구해 건너뜀'); return { ok: false }; }
  const n = (x) => (x == null || x === '' ? null : Number(x));
  const pre150 = rows.filter((r) => r.Ticker && !U.isEtf(r) && r.Above_150_SMA === 'O' && n(r.Ret_1D_Pct) > 0
    && prev.map[r.Ticker] != null && prev.map[r.Ticker] <= RULE.th && n(r.BBWTHD) >= prev.map[r.Ticker] * 0.98);
  const track = readJ(path.join(STATE, 'track.json'), { items: [] });
  const active = track.items.filter((x) => x.status === 'active').map((x) => x.ticker);
  const want = [...new Set([...pre150.map((r) => r.Ticker), ...active, 'QQQ'])];
  U.say('SYSTEM', `팀2: ${session} 장 (사이트 ${label}) · 1차 거름 ${pre150.length}종목 (전날 폭 ${prev.date}) · 추적 ${active.length} → 봉 ${want.length}`);
  const { results } = await fetchMany(want, { range: '2y', label: '팀2 봉', budgetMs: 240000 });
  const barsOf = (t) => { const r = results.get(String(t).toUpperCase()); return r && r.ok ? r.bars.filter((b) => barDateET(b.t) < label).map((b) => ({ ...b, __d: barDateET(b.t) })) : null; };
  const qqq = barsOf('QQQ');
  const reg = qullamaggieRegime(qqq);
  const regime = { green: !!reg.ma10AboveMa20, ma10: reg.ma10, ma20: reg.ma20, ko: reg.ko || '', verdict: reg.verdict };
  const rules = loadRules();

  const items = [];
  for (const r of pre150) {
    const b = barsOf(r.Ticker);
    if (!b || !b.length || b[b.length - 1].__d !== session) continue;
    const j = breakout(b);
    if (!j || !j.pass) continue;
    let s = null; try { s = gradeSetup(b, { rules, regime: 'green' }); } catch (e) { s = null; }
    const M = s && s.ok && s.metrics ? s.metrics : null;
    const rk = ranks.get(r.Ticker) || null;
    const ev = UC.evaluate({ bars: b, setup: s, ranks: rk, regime: reg });
    const ck = ev.rows.filter((x) => x.no !== '1' && x.status !== 'info');
    items.push({
      ticker: r.Ticker, session, sector: r.Sector || '', industry: r.Industry || '', price: r2(j.close), adr: adrPct(b),
      ret: { m1: n(r.Ret_1M_Pct), m3: n(r.Ret_3M_Pct), m6: n(r.Ret_6M_Pct) }, rsTop: rk ? { m1: rk.m1, m3: rk.m3, m6: rk.m6 } : null,
      rs2: !!rk && [rk.m1, rk.m3, rk.m6].some((v) => v != null && v <= RULE.rsTop), peers: rk ? rk.peers : [],
      volX: j.volX, bbwPrev: j.bbwPrev, bbw: j.bbw, rows: j.rows,
      base: M ? { days: M.baseBars, weeks: M.baseWeeks, depthPct: M.depthPct, priorPct: M.priorMovePct, pivot: s.pivot, pivotDate: s.pivotDate, breakDate: s.breakDate || null } : null,
      checklist: { pass: ck.filter((x) => x.status === 'ok').length, total: ck.length, rows: ev.rows.filter((x) => x.no !== '1') },
    });
  }
  // 다음 실적일 (나스닥 달력 · 10거래일 · 못 받으면 '모름')
  try { const E = req('lib/earnings'), res = await E.upcomingEarnings(session, 10); for (const x of items) x.nextEarnings = E.earningsOf(res, x.ticker); } catch (e) { /* 모름 */ }
  items.sort((a, b) => b.rs2 - a.rs2 || (Math.min(...Object.values(a.rsTop || {}).filter((v) => v != null), 100) - Math.min(...Object.values(b.rsTop || {}).filter((v) => v != null), 100)));
  U.say('SYSTEM', `팀2: ${session} 돌파 ${items.length}종목 — RS 2% ${items.filter((x) => x.rs2).length}${items.length ? ' · ' + items.map((x) => x.ticker + (x.rs2 ? '(RS)' : '')).join(', ') : ''}`);

  // 추적: 기존 갱신 → 오늘 돌파 추가 (같은 종목이 추적 중이면 새로 넣지 않는다)
  const upd = track.items.map((t) => (t.status === 'active' ? trackStep(t, barsOf(t.ticker), session) : t));
  for (const x of items) if (!upd.some((t) => t.ticker === x.ticker && t.status === 'active'))
    upd.push({ ticker: x.ticker, session, close: x.price, rs2: x.rs2, status: 'active', days: 0, volUpDays: 0, retPct: 0, above50: true, above150: true, lastSession: session, grades: [] });
  const keepEnded = upd.filter((t) => t.status !== 'active').slice(-200);
  writeJ(path.join(STATE, 'track.json'), { updated: new Date().toISOString(), items: [...upd.filter((t) => t.status === 'active'), ...keepEnded] });
  writeJ(path.join(STATE, 'today.json'), { updated: new Date().toISOString(), label, session, regime, scan: { universe: rows.length, prefilter: pre150.length, prevDate: prev.date }, items });

  // 신호 기록 — 최근 KEEP 장 (탭·모의투자·차트 파일이 이걸 본다). 같은 장을 다시 돌리면 그 장만 바꾼다.
  const SIG = path.join(STATE, 'signals.json'), KEEP = 25;
  const old = readJ(SIG, { items: [] }).items.filter((x) => x.session !== session);
  const all = [...items, ...old], keepS = [...new Set(all.map((x) => x.session))].sort().reverse().slice(0, KEEP);
  const signals = all.filter((x) => keepS.includes(x.session));
  writeJ(SIG, { updated: new Date().toISOString(), items: signals });

  const tickers = [...new Set([...items.map((x) => x.ticker), ...upd.filter((t) => t.status === 'active').map((t) => t.ticker)])];
  const keep = [...new Set([...signals.map((x) => x.ticker), ...upd.filter((t) => t.status === 'active').map((t) => t.ticker)])];
  req('lib/lists').writeOhlcFiles(tickers, (t) => barsOf(t), path.join(ROOT, 'data', 'ohlc'), { bars: 330, dateOf: barDateET, keepTickers: keep });
  return { ok: true, session, items, byT };
}

module.exports = { trackStep, ranksOf, prevBbw };
if (require.main === module) main().then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
