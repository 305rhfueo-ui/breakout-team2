'use strict';
// 팀2 뉴스 — 오늘 돌파 종목 + 추적 중 종목의 기사를 최대한 모은다 (코드만, AI 없음).
//   node scripts/news.js        결과: state/news.json  { 티커: { items:[{title,url,date,publisher,via,paywall,isNew}], sources } }
// 소스(전부 1팀 모듈 · 캐시 공유): Nasdaq RSS · CNBC · 야후(3~5초 간격·12시간 쿨다운 공유) · SEC 8-K
// 하나가 실패해도 나머지는 계속한다. 같은 URL·같은 제목은 하나만.
const fs = require('fs');
const path = require('path');
const { req, ROOT } = require('./lib/shared');
const U = req('lib/util');

const STATE = path.join(ROOT, 'state');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const PAYWALL = /wsj\.com|barrons\.com|ft\.com|bloomberg\.com|investors\.com|seekingalpha\.com|\/m\//i;

// 소스별 목록 → 하나로 (순수 함수 · 테스트)
function merge(lists, seenBefore = new Set(), maxAgeDays = 45, today = new Date().toISOString().slice(0, 10)) {
  const out = [], key = new Set();
  const cut = new Date(new Date(`${today}T00:00:00Z`).getTime() - maxAgeDays * 864e5).toISOString().slice(0, 10);
  for (const x of lists.flat()) {
    if (!x || !x.title || !x.url) continue;
    if (x.date && x.date < cut) continue;
    const k1 = x.url.split('?')[0], k2 = String(x.title).toLowerCase().replace(/\W+/g, ' ').trim();
    if (key.has(k1) || key.has(k2)) continue;
    key.add(k1); key.add(k2);
    out.push({ title: x.title, url: x.url, date: x.date || null, publisher: x.publisher || x.via || '', via: x.via, paywall: PAYWALL.test(x.url), isNew: !seenBefore.has(k1) });
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

async function newsFor(T, seen) {
  const src = {}, lists = [];
  const tryIt = async (name, fn) => { try { const v = await fn(); src[name] = v.length; lists.push(v); } catch (e) { src[name] = 'fail'; } };
  await tryIt('nasdaq', async () => ((await req('data/news-rss').getTickerNews(T, { limit: 20 })).items || []).map((x) => ({ ...x, via: 'Nasdaq' })));
  await tryIt('cnbc', async () => ((await req('data/cnbc').getTickerArticles(T)).items || []).map((x) => ({ ...x, via: 'CNBC' })));
  await tryIt('yahoo', async () => (await req('data/yahoo-estimates').getNews(T)) || []);
  await tryIt('sec', async () => ((await req('data/sec-edgar').getFilings(T, { forms: ['8-K'], limit: 8 })).filings || [])
    .map((f) => ({ title: `SEC 8-K · ${(f.itemsKo || f.items || []).join(', ')}${f.isEarnings ? ' (실적 발표)' : ''}`, url: f.url, date: f.filingDate, publisher: 'SEC', via: 'SEC' })));
  return { items: merge(lists, seen), sources: src };
}

async function main() {
  U.loadEnv();
  const today = readJ(path.join(STATE, 'today.json'), { items: [] });
  const track = readJ(path.join(STATE, 'track.json'), { items: [] });
  const tickers = [...new Set([...today.items.map((x) => x.ticker), ...track.items.filter((t) => t.status === 'active').map((t) => t.ticker)])];
  const prev = readJ(path.join(STATE, 'news.json'), {});
  const out = {};
  for (const T of tickers) {
    const seen = new Set(((prev[T] && prev[T].items) || []).map((x) => x.url.split('?')[0]));
    out[T] = { updated: new Date().toISOString(), ...(await newsFor(T, seen)) };
    U.say('SYSTEM', `팀2 뉴스 ${T}: ${out[T].items.length}건 (새 ${out[T].items.filter((x) => x.isNew).length}) ${JSON.stringify(out[T].sources)}`);
  }
  fs.writeFileSync(path.join(STATE, 'news.json'), JSON.stringify(out, null, 1) + '\n');
  return { ok: true, n: tickers.length };
}

module.exports = { merge };
if (require.main === module) main().then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
