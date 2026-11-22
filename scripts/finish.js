'use strict';
// 팀2 마무리 — AI 결과 검사·합치기 → 모의투자 장부(처음부터 다시 계산) → 대시보드 자료 → 텔레그램 → 깃
//   node scripts/finish.js [--no-git] [--no-tg]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { req, ROOT } = require('./lib/shared');
const { RULE, sizing, riskFor, isSA, smaAt, r2 } = require('./lib/core');
const { newPos, step, perf, openRisk } = require('./lib/paper');
const { rankCandidates } = require('./prepare');
const U = req('lib/util');

const S = (f) => path.join(ROOT, 'state', f);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJ = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n');
const CODES = new Set(['S1', 'S2', 'A1', 'A2', 'A3', 'B1', 'B2', 'C', 'D1', 'D2']);
const SITE = 'https://305rhfueo-ui.github.io/breakout-team2/';

async function linkOk(url) {
  try { const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }); return r.status < 400 || r.status === 403; } catch (e) { return false; }
}

// AI 등급 검사 — 입력에 없던 종목·이상한 등급 코드는 버리고, 근거 링크가 안 열리면 표시한다
async function mergeGrades(session) {
  const inp = readJ(S('grade-input.json'), { items: [] }), neu = readJ(S('grades-new.json'), null), grades = readJ(S('grades.json'), {});
  const allowed = new Set(inp.items.map((x) => x.ticker)), changes = [];
  if (neu && neu.items) for (const [T, g] of Object.entries(neu.items)) {
    if (!allowed.has(T)) continue;
    const gr = (g.grades || []).map((x) => String(x).toUpperCase()).filter((x) => CODES.has(x));
    const ev = [];
    for (const e of (g.evidence || []).slice(0, 3)) if (/^https?:\/\//.test(e.url || '')) ev.push({ ...e, linkOk: await linkOk(e.url) });
    const noEvidence = !ev.some((e) => e.linkOk);
    const prev = grades[T];
    const rec = { session, date: session, grades: noEvidence ? [] : gr, summary: noEvidence ? '근거 없음 (열리는 원문 없음)' : String(g.summary || '').slice(0, 120),
      evidence: ev, plus: (g.plus || []).slice(0, 5), minus: (g.minus || []).slice(0, 5), next: (g.next || []).slice(0, 4), eventDate: g.eventDate || null,
      history: [...((prev && prev.history) || []), { date: session, grades: noEvidence ? [] : gr }].slice(-12) };
    if (!isSA(prev && prev.grades) && isSA(rec.grades)) changes.push(T);
    grades[T] = rec;
  }
  writeJ(S('grades.json'), grades);
  try { fs.unlinkSync(S('grades-new.json')); } catch (e) { /* 없음 */ }
  return { grades, newSA: changes };
}

// 실장 결과 검사 — 후보 안·관망 아님·최대 3
function mergeChief(session, cands) {
  const neu = readJ(S('chief-new.json'), null), ok = new Map(cands.map((c) => [c.ticker, c]));
  let picks = [], note = cands.length ? '' : '오늘은 후보가 없습니다.', skipped = [];
  if (neu && neu.session === session) {
    picks = (neu.picks || []).filter((p) => ok.has(p.ticker) && !ok.get(p.ticker).watchOnly).slice(0, 3);
    skipped = (neu.skipped || []).filter((p) => ok.has(p.ticker)); note = String(neu.note || '').slice(0, 200);
  }
  try { fs.unlinkSync(S('chief-new.json')); } catch (e) { /* 없음 */ }
  const book = readJ(S('chief-picks.json'), { items: [] });
  book.items = book.items.filter((x) => x.session !== session).concat(picks.map((p) => ({ session, ticker: p.ticker, codeRank: p.codeRank, changed: !!p.changed, plan: ok.get(p.ticker).plan })));
  writeJ(S('chief-picks.json'), book);
  return { picks: picks.map((p) => ({ ...p, ...ok.get(p.ticker) })), skipped, note };
}

// 모의투자 — 신호 기록 + 봉 + 등급 이력으로 매번 처음부터 계산 (장부가 꼬이지 않게). 금액·수량 없음.
function runBooks(sigs, barsOf, gradeHist, qqq, chiefBook) {
  const qi = new Map(qqq.map((x, i) => [x.__d, i])), qc = qqq.map((x) => x.c);
  const green = (d) => { const i = qi.get(d); return i != null && smaAt(qc, 10, i) > smaAt(qc, 20, i); };
  const saAt = (T, d) => ((gradeHist[T] && gradeHist[T].history) || []).some((h) => h.date <= d && isSA(h.grades));
  const book = (list, mode) => {
    const pos = [], skipped = [];
    for (const s of [...list].sort((a, b) => a.session.localeCompare(b.session))) {
      const b = barsOf(s.ticker); if (!b) continue;
      const i = b.findIndex((x) => x.__d === s.session); if (i < 0) continue;
      if (i + 1 >= b.length) { skipped.push({ ...s, why: '매수 대기 (다음 장 시가)' }); continue; }
      if (pos.some((p) => p.ticker === s.ticker && p.open)) continue;
      const g = green(s.session), timely = s.star || saAt(s.ticker, s.session), risk = s.plan ? s.plan.riskPct : riskFor(g, timely);
      if (!risk) { skipped.push({ ...s, why: '시장 빨간불 · 관망' }); continue; }
      const adr = b.slice(i - 19, i + 1).reduce((t, x) => t + (x.h / x.l - 1), 0) / 20 * 100, sz = sizing(risk, adr);
      const used = pos.filter((p) => p.open).reduce((t, p) => t + openRisk(p), 0);
      if (used + sz.realRiskPct > RULE.riskSum) { skipped.push({ ...s, why: `자리 없음 (위험 합계 ${r2(used, 2)}%)` }); continue; }
      let p = newPos({ ...s, adr, weightPct: sz.weightPct, hi52: Math.max(...b.slice(Math.max(0, i - 251), i + 1).map((x) => x.h)), low: b[i].l }, b[i + 1], mode);
      p = { ...p, agent: s.agent, star: !!s.star, riskPct: risk };
      const bb = require('./lib/core').bollinger(b.map((x) => x.c));
      for (let k = i + 1; k < b.length && p.open; k++) p = step(p, b, k, saAt(s.ticker, b[k].__d), bb);
      pos.push({ ...p, last: b[b.length - 1].c, lastDate: b[b.length - 1].__d, ...perf(p, b[b.length - 1].c) });
    }
    const sum = (f) => { const L = pos.filter(f), closed = L.filter((p) => !p.open); return { n: L.length, open: L.length - closed.length, closed: closed.length,
      win: closed.length ? r2(closed.filter((p) => p.retPct > 0).length / closed.length * 100, 0) : null, acctPct: r2(L.reduce((t, p) => t + p.acctPct, 0), 2),
      stopRate: closed.length ? r2(closed.filter((p) => p.steps.some((x) => x.why.startsWith('손절'))).length / closed.length * 100, 0) : null }; };
    return { positions: pos, skipped, total: sum(() => true), rs: sum((p) => p.agent.includes('rs')), cat: sum((p) => p.agent.includes('cat')), star: sum((p) => p.star),
      openRisk: r2(pos.filter((p) => p.open).reduce((t, p) => t + openRisk(p), 0), 2) };
  };
  return { main: book(sigs, 'adrClose'), cmp: { adrIntraday: book(sigs, 'adrIntraday').total, lod: book(sigs, 'lod').total },
    chief: book(chiefBook.map((x) => ({ ...x, agent: ['chief'] })), 'adrClose').total };
}

function message(d) {
  const L = [`🅱️ 브레이크아웃팀2 — ${d.session} 장`, `${d.regime.green ? '🟢 시장 초록불 (손실 허용 2%)' : '🔴 시장 빨간불 — 관망 · 투자 적기만 0.5%'}`];
  L.push(`돌파 ${d.today.length} · RS 돌파 ${d.today.filter((x) => x.rs2).length} · 촉매 돌파 ${d.today.filter((x) => x.sa).length} · 추적 ${d.track.filter((t) => t.status === 'active').length}`);
  if (d.chief.picks.length) { L.push('', '🧑‍💼 실장 최종 추천'); for (const p of d.chief.picks) L.push(`${String(p.tier).startsWith('★') ? '★ ' : ''}${p.ticker} · ${p.tier} · 손실 ${p.plan.riskPct}% · 비중 ${p.plan.weightPct}% · 손절 −${p.plan.stopPct}%\n  ${(p.reasons || [])[0] || ''}`); }
  else L.push('', `🧑‍💼 실장: ${d.chief.note || '오늘은 추천 없음'}`);
  for (const T of d.newSA) L.push(`🔔 2단계 확인 — ${T} 추적 중 S/A 재료 확인`);
  const nn = Object.entries(d.news).map(([T, v]) => [T, v.items.filter((x) => x.isNew)]).filter(([, v]) => v.length);
  if (nn.length) { L.push('', '📰 새 기사'); for (const [T, v] of nn.slice(0, 5)) L.push(`${T} ${v.length}건 — ${v[0].title.slice(0, 60)}`); }
  L.push('', '판단 보조이며 최종 결정은 사장님입니다.', SITE);
  return L.join('\n');
}

function gitPublish(msg) {
  const git = (a) => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try {
    git(['add', '--', 'data', 'state']);
    if (!git(['diff', '--staged', '--name-only']).trim()) return { ok: true, pushed: false };
    git(['commit', '-q', '-m', msg]);
    if (!git(['remote']).trim()) return { ok: true, pushed: false };
    try { git(['push', '-q', 'origin', 'HEAD']); } catch (e) { git(['pull', '--rebase', '-q', 'origin', 'master']); git(['push', '-q', 'origin', 'HEAD']); }
    return { ok: true, pushed: true };
  } catch (e) { return { ok: false, error: String(e.stderr || e.message).split('\n')[0] }; }
}

async function main() {
  U.loadEnv();
  const a = process.argv.slice(2), git = !a.includes('--no-git'), tg = !a.includes('--no-tg');
  const today = readJ(S('today.json'), null); if (!today) return { ok: false };
  const session = today.session, { grades, newSA } = await mergeGrades(session);
  const track = readJ(S('track.json'), { items: [] }), news = readJ(S('news.json'), {}), odds = readJ(S('odds.json'), null);
  for (const t of track.items) if (grades[t.ticker]) t.grades = grades[t.ticker].grades;
  writeJ(S('track.json'), track);
  const cin = readJ(S('chief-input.json'), { candidates: [] });
  const chief = mergeChief(session, cin.session === session ? cin.candidates : []);

  // 신호 기록(모의투자용, 지우지 않음): 두 에이전트 중 하나라도 해당하는 돌파
  const trackSA = new Set(track.items.filter((t) => isSA(t.grades)).map((t) => t.ticker));
  const ranked = rankCandidates(today.items, grades, trackSA);
  const PS = readJ(S('paper-signals.json'), { items: [] });
  PS.items = PS.items.filter((x) => x.session !== session).concat(ranked.map((x) => ({ ticker: x.ticker, session, star: x.star, agent: [x.rs2 && 'rs', x.sa && 'cat'].filter(Boolean) })));
  writeJ(S('paper-signals.json'), PS);

  const { fetchMany, barDateET } = req('lib/bars');
  const want = [...new Set([...PS.items.map((x) => x.ticker), ...readJ(S('chief-picks.json'), { items: [] }).items.map((x) => x.ticker), 'QQQ'])];
  const { results } = await fetchMany(want, { range: '2y', label: '팀2 장부' });
  const barsOf = (t) => { const r = results.get(String(t).toUpperCase()); return r && r.ok ? r.bars.filter((b) => barDateET(b.t) < today.label).map((b) => ({ ...b, __d: barDateET(b.t) })) : null; };
  const books = runBooks(PS.items, barsOf, grades, barsOf('QQQ') || [], readJ(S('chief-picks.json'), { items: [] }).items);
  writeJ(S('paper.json'), { updated: new Date().toISOString(), session, ...books });

  // 대시보드 자료
  const sigs = readJ(S('signals.json'), { items: [] }).items.map((x) => {
    const g = grades[x.ticker] && grades[x.ticker].session <= x.session ? grades[x.ticker] : grades[x.ticker] || null;
    const sa = isSA(g && g.grades) || trackSA.has(x.ticker);
    return { ...x, sa, star: x.rs2 && sa, grade: g ? { grades: g.grades, summary: g.summary, evidence: g.evidence, plus: g.plus, minus: g.minus, next: g.next } : null,
      newsN: news[x.ticker] ? news[x.ticker].items.length : null, newsNew: news[x.ticker] ? news[x.ticker].items.filter((n) => n.isNew).length : null,
      odds: odds ? { rule: x.rs2 ? odds.rs2 : odds.all, mine: (odds.byTicker[x.ticker] || []).slice(-5) } : null };
  });
  const data = { updated: new Date().toISOString(), session, regime: today.regime, rule: RULE, scan: today.scan,
    chief: { picks: chief.picks, skipped: chief.skipped, note: chief.note }, signals: sigs,
    track: track.items.slice(-120), paper: { ...books.main.total, rs: books.main.rs, cat: books.main.cat, star: books.main.star, openRisk: books.main.openRisk,
      positions: books.main.positions.map((p) => ({ ticker: p.ticker, agent: p.agent, star: p.star, signal: p.signal, entryDate: p.entryDate, entry: p.entry, weightPct: p.weightPct, riskPct: p.riskPct,
        stop: p.stop, open: p.open, left: p.left, steps: p.steps, retPct: p.retPct, acctPct: p.acctPct, catalyst: p.catalyst, lastDate: p.lastDate })),
      skipped: books.main.skipped.slice(-30), cmp: books.cmp, chief: books.chief },
    odds: odds ? { all: odds.all, rs2: odds.rs2, rs2Green: odds.rs2Green, rs2Red: odds.rs2Red, from: odds.from, to: odds.to, universe: odds.universe, note: odds.note } : null };
  fs.writeFileSync(path.join(ROOT, 'data', 'team2.js'), `window.TEAM2=${JSON.stringify(data)};\n`);
  fs.writeFileSync(path.join(ROOT, 'data', 'news.js'), `window.NEWS2=${JSON.stringify(news)};\n`);
  U.say('SYSTEM', `팀2 마무리: ${session} · 돌파 ${today.items.length} · 실장 추천 ${chief.picks.length} · 모의투자 ${books.main.total.n}건(보유 ${books.main.total.open}) · 새 S/A ${newSA.length}`);

  if (tg) { const r = await req('lib/notify').notify(message({ session, regime: today.regime, today: ranked.concat(today.items.filter((x) => !ranked.some((y) => y.ticker === x.ticker))), track: track.items, chief, newSA, news })); if (!r.ok) U.say('WARN', `텔레그램: ${r.error}`); }
  if (git) { const g = gitPublish(`팀2: ${session} 돌파 ${today.items.length} · 실장 ${chief.picks.length}`); if (!g.ok) U.say('WARN', `깃: ${g.error}`); }
  return { ok: true };
}

module.exports = { runBooks, mergeChief, message };
if (require.main === module) main().then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
