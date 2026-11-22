'use strict';
// AI 작업 입력 만들기 (코드가 자료를 모아 넘긴다 — AI 는 받은 자료와 열어 본 원문만 쓴다).
//   node scripts/prepare.js grade   → state/grade-input.json  (등급 매길 종목: 오늘 돌파 전부 + 추적 중 새 실적 발표)
//   node scripts/prepare.js chief   → state/chief-input.json  (코드 순위 · 비중 · 과거 성적 · 뉴스 제목)
// 종목 수를 출력한다(0이면 run-job.sh 가 AI 를 부르지 않는다).
const fs = require('fs');
const path = require('path');
const { req, ROOT } = require('./lib/shared');
const { RULE, sizing, riskFor, isSA } = require('./lib/core');
const U = req('lib/util');

const S = (f) => path.join(ROOT, 'state', f);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJ = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n');

// 등급이 필요한가: 오늘 돌파했거나, 추적 중인데 마지막 등급 뒤에 SEC 실적 공시(8-K 2.02)가 새로 나왔다
function gradeTargets(today, track, news, grades) {
  const out = new Map();
  for (const x of today.items) if (!(grades[x.ticker] && grades[x.ticker].session === today.session)) out.set(x.ticker, 'new');
  for (const t of track.items.filter((y) => y.status === 'active')) {
    if (out.has(t.ticker)) continue;
    const g = grades[t.ticker], last = g ? g.date : t.session;
    const earn = ((news[t.ticker] && news[t.ticker].items) || []).find((n) => n.via === 'SEC' && /실적 발표/.test(n.title) && n.date > last);
    if (earn) out.set(t.ticker, `earnings ${earn.date}`);
  }
  return out;
}

// 코드 순위: ★(RS 2% + S/A) → RS 2% → S/A 만 · 같은 칸은 RS 높은 순. 둘 다 아니면 후보 아님.
function rankCandidates(items, grades, trackSA = new Set()) {
  const best = (x) => Math.min(...Object.values(x.rsTop || {}).filter((v) => v != null), 100);
  return items.map((x) => {
    const sa = isSA((grades[x.ticker] || {}).grades) || trackSA.has(x.ticker);
    const tier = x.rs2 && sa ? 0 : x.rs2 ? 1 : sa ? 2 : null;
    return { ...x, sa, star: tier === 0, tier };
  }).filter((x) => x.tier != null).sort((a, b) => a.tier - b.tier || best(a) - best(b));
}

async function main() {
  U.loadEnv();
  const mode = process.argv[2];
  const today = readJ(S('today.json'), { items: [] }), track = readJ(S('track.json'), { items: [] });
  const news = readJ(S('news.json'), {}), grades = readJ(S('grades.json'), {});
  if (mode === 'grade') {
    const tg = gradeTargets(today, track, news, grades), sec = req('data/sec-edgar'), yh = req('data/yahoo-estimates');
    const items = [];
    for (const [T, why] of tg) {
      const x = today.items.find((y) => y.ticker === T) || { ticker: T };
      const q = await sec.getQuarterlyFinancials(T, { count: 6 }).catch(() => null);
      const est = await yh.getEstimates(T).catch(() => null);
      items.push({ ticker: T, why, session: today.session, sector: x.sector, industry: x.industry, price: x.price, ret: x.ret, rsTop: x.rsTop,
        quarters: q && q.ok && q.quarters.length && (Date.now() - Date.parse(q.quarters[0].periodEnd)) / 864e5 < 200 ? q.quarters.map((z) => ({ end: z.periodEnd, revenue: z.revenue, profit: z.profit, margin: z.margin, yoy: z.yoy, label: q.profitLabel })) : null,
        quartersNote: q && q.ok && q.quarters.length && (Date.now() - Date.parse(q.quarters[0].periodEnd)) / 864e5 >= 200 ? `SEC 재무가 오래됨(마지막 분기 ${q.quarters[0].periodEnd}) — 외국 기업(6-K·20-F) 등. 실적은 뉴스·회사 발표 원문으로 확인` : null,
        estimates: est && est.ok !== false ? est : null,
        news: ((news[T] && news[T].items) || []).slice(0, 30).map((n) => ({ date: n.date, via: n.via, publisher: n.publisher, title: n.title, url: n.url, paywall: n.paywall })) });
    }
    writeJ(S('grade-input.json'), { session: today.session, rubric: 'docs/catalysts-v3.md', items });
    console.log(items.length); return;
  }
  if (mode === 'chief') {
    const odds = readJ(S('odds.json'), null);
    const trackSA = new Set(track.items.filter((t) => t.status === 'active' && isSA(t.grades)).map((t) => t.ticker));
    const cand = rankCandidates(today.items, grades, trackSA);
    const green = !!(today.regime && today.regime.green);
    const rows = cand.map((x, i) => {
      const risk = riskFor(green, x.star || trackSA.has(x.ticker));   // 빨간불 '투자 적기' = ★ 또는 추적 중 S/A 확인
      const g = grades[x.ticker] || {};
      return { codeRank: i + 1, ticker: x.ticker, tier: ['★ RS 2% + S/A', 'RS 2%', 'S/A 만'][x.tier], sector: x.sector, industry: x.industry,
        rsTop: x.rsTop, ret: x.ret, base: x.base, volX: x.volX, bbw: `${x.bbwPrev}→${x.bbw}`, checklist: `${x.checklist.pass}/${x.checklist.total}`,
        grades: g.grades || [], gradeSummary: g.summary || null, minus: g.minus || [], plus: g.plus || [], nextEarnings: x.nextEarnings || null,
        plan: risk ? sizing(risk, x.adr) : null, watchOnly: !risk,
        odds: odds ? { sameRule: x.rs2 ? (green ? odds.rs2Green : odds.rs2Red) : odds.all, ticker: (odds.byTicker[x.ticker] || []).slice(-5) } : null,
        headlines: ((news[x.ticker] && news[x.ticker].items) || []).slice(0, 10).map((n) => `${n.date} ${n.publisher}: ${n.title}`) };
    });
    writeJ(S('chief-input.json'), { session: today.session, regime: today.regime, rule: RULE, candidates: rows });
    console.log(rows.length); return;
  }
  console.error('용법: node scripts/prepare.js grade|chief'); process.exit(2);
}

module.exports = { gradeTargets, rankCandidates };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
