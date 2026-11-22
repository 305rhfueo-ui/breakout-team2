#!/bin/bash
# 브레이크아웃팀2 하루 작업 — 1팀 morning.sh 맨 끝에서 부른다 (무거운 작업은 하나씩).
#   bash deploy/run-job.sh daily
# 순서: 스캔(코드) → 뉴스(코드) → AI 등급(대상 있을 때만) → 과거 성적(월요일) → 실장(후보 있을 때만) → 마무리(장부·화면·텔레그램·깃)
# AI 는 claude CLI 비대화 실행 · 허용 도구 목록만 · 작업당 최대 MAX_MIN 분. 키·시크릿은 어디에도 찍지 않는다.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$HOME/Library/Logs/breakout-team2"; mkdir -p "$LOGS"
OUT="$LOGS/daily-$(date +%F).log"
cd "$REPO"
BT="${BT_ROOT:-$HOME/AI/breakout-team}"
tg() { (cd "$BT" && node -e 'require("./scripts/lib/util").loadEnv(); require("./scripts/lib/notify").notify(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1));' "$1" >/dev/null 2>&1); }

CLAUDE="$(command -v claude 2>/dev/null || true)"
for c in /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.local/bin/claude"; do [ -z "$CLAUDE" ] && [ -x "$c" ] && CLAUDE="$c"; done
ALLOWED=("Read" "Write" "Glob" "Grep" "WebFetch" "WebSearch" "Bash(node *)" "Bash(cat *)" "Bash(ls *)")

ai() {   # ai <프롬프트> <분>
  [ -z "$CLAUDE" ] && { echo "claude CLI 없음 — $1 건너뜀" >> "$OUT"; return 1; }
  local RUN; RUN="$(mktemp)"
  "$CLAUDE" -p "$1" --model claude-opus-5 --allowedTools "${ALLOWED[@]}" > "$RUN" 2>&1 &
  local PID=$!
  ( sleep $(( $2 * 60 )); kill "$PID" 2>/dev/null && touch "$RUN.timeout" ) & local W=$!
  wait "$PID"; local RC=$?; kill "$W" 2>/dev/null; wait "$W" 2>/dev/null
  cat "$RUN" >> "$OUT"; [ -f "$RUN.timeout" ] && { echo "=== $1 시간 초과" >> "$OUT"; rm -f "$RUN.timeout"; RC=124; }
  rm -f "$RUN"; return $RC
}

echo "=== 팀2 daily $(date '+%F %T')" >> "$OUT"
node scripts/scan.js >> "$OUT" 2>&1 || { tg "⚠️ 브레이크아웃팀2 스캔 실패 — 로그: $OUT"; exit 1; }
node scripts/news.js >> "$OUT" 2>&1 || true
N=$(node scripts/prepare.js grade 2>>"$OUT" | tail -1)
[ "${N:-0}" -gt 0 ] 2>/dev/null && { ai "/grade" 40 || tg "⚠️ 팀2 AI 등급 판정 실패 — 등급 없이 진행합니다"; }
[ "$(date +%u)" = 1 ] || [ ! -f state/odds.json ] && node scripts/odds.js >> "$OUT" 2>&1
node scripts/finish.js --no-git --no-tg >> "$OUT" 2>&1   # 등급을 합쳐 후보·추적을 갱신
C=$(node scripts/prepare.js chief 2>>"$OUT" | tail -1)
[ "${C:-0}" -gt 0 ] 2>/dev/null && { ai "/chief" 20 || tg "⚠️ 팀2 실장 실패 — 추천 없이 진행합니다"; }
node scripts/finish.js >> "$OUT" 2>&1 || tg "⚠️ 브레이크아웃팀2 마무리 실패 — 로그: $OUT"
echo "=== 끝 $(date '+%T')" >> "$OUT"
