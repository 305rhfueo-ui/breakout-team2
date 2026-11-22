'use strict';
// 한국투자증권 모의투자 계좌 연결 — 안전장치만 (2026-11-22).
// ⚠️ 지금 1팀 .env 의 KIS_APP_KEY 는 실전 키다(실전 주소에서 토큰 발급). 주문에 절대 쓰지 않는다.
// 모의투자 전용 키(KIS_VTS_APP_KEY · KIS_VTS_APP_SECRET · KIS_VTS_ACCOUNT)를 사용자가 .env 에 직접 넣으면,
// 모의투자 주소에서 토큰이 실제로 발급되는지 확인한다. 실패하면 주문을 켜지 않는다.
// 주문 함수는 이 확인이 통과하고, 시범 주문 1건으로 해외주식 모의 주문 규칙(지정가만·정규장만 등)을 실측한 뒤에 만든다.
const VTS = 'https://openapivts.koreainvestment.com:29443';   // 코드에 고정 — 환경변수로 바꾸지 않는다

async function check() {
  const k = process.env.KIS_VTS_APP_KEY, s = process.env.KIS_VTS_APP_SECRET, a = process.env.KIS_VTS_ACCOUNT;
  if (!k || !s || !a) return { ok: false, reason: '모의투자 전용 키 없음 — 자체 장부로 기록' };
  if (k === process.env.KIS_APP_KEY) return { ok: false, reason: '모의투자 키가 실전 키와 같음 — 주문 끔' };
  try {
    const r = await fetch(`${VTS}/oauth2/tokenP`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', appkey: k, appsecret: s }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return j && j.access_token ? { ok: true, reason: '모의투자 주소에서 토큰 발급 확인' } : { ok: false, reason: `모의투자 주소 토큰 실패 (${r.status}) — 모의투자 키가 아님` };
  } catch (e) { return { ok: false, reason: '모의투자 주소 접속 실패' }; }
}

module.exports = { check, VTS };
