팀2 촉매 등급 판정. 입력 `state/grade-input.json`, 기준 `docs/catalysts-v3.md`, 출력 `state/grades-new.json`.

## 할 일
1. `docs/catalysts-v3.md`를 끝까지 읽는다. 등급표(S1·S2·A1·A2·A3·B1·B2·C·D1·D2), 등급 조정 규칙, 가산·감점 신호가 기준이다.
2. `state/grade-input.json`의 종목마다 다음을 한다.
   - 입력에 있는 분기 재무(`quarters`), 전망치(`estimates`), 뉴스 목록(`news`)을 먼저 본다.
   - 등급 근거가 될 만한 원문을 **직접 연다**(WebFetch). 회사 실적 발표, SEC 8-K, 나스닥·CNBC 기사가 우선이다. 유료(`paywall: true`) 기사는 제목만 단서로 쓰고, 열리는 원문으로 확인한다.
   - 입력에 없는 최근 재료가 있을 수 있으니 WebSearch를 한두 번 한다("<티커> earnings guidance", "<티커> stock news").
   - 최근 60일 안의 재료로 등급을 매긴다. 여러 개 가능하다. 재료가 없으면 빈 배열이다.
3. `state/grades-new.json`에 아래 모양으로 쓴다(Write 도구). 다른 파일은 건드리지 않는다.

```json
{ "session": "<입력의 session>", "items": { "<티커>": {
  "grades": ["S1"],
  "summary": "한 줄 결론 (한국어, 40자 안팎)",
  "evidence": [ { "claim": "무슨 일이 있었나 — 숫자 포함", "url": "실제로 연 원문 주소", "date": "YYYY-MM-DD" } ],
  "plus": ["가산 신호"], "minus": ["감점 신호"],
  "next": ["다음에 확인할 것"],
  "eventDate": null
} } }
```

## 지킬 것
- **지어내지 않는다.** 숫자·날짜·인용은 직접 연 원문에 있어야 한다. 근거를 열 수 없으면 `grades: []`, `summary: "근거 없음"`.
- `evidence`의 `url`은 직접 열어 본 주소만 쓴다. 최대 3개.
- 가이던스가 하나라도 컨센서스에 못 미치면 S 등급을 주지 않는다(v3 규칙).
- 액면분할·지수 편입·인수설은 C, 증권사 의견만 있으면 D1, 업종이 같이 오른 것뿐이면 D2.
- C 유형이면 `eventDate`에 이벤트 날짜를 쓴다.
- 차트 모양("돌파 실패", "리테스트" 등)은 판단하지 않는다. 등급은 재료만 본다.
- 매수·매도 권유 문장을 쓰지 않는다. 금액·수량을 쓰지 않는다.
- 마지막에 한 줄로 "등급 N종목 완료"만 출력한다.
