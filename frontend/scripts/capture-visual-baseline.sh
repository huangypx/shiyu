#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$ROOT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$PROJECT_DIR/docs/visual-baseline}"
PORT="${PORT:-4173}"
CHROMIUM_BIN="${CHROMIUM_BIN:-}"
PREVIEW_LOG="${TMPDIR:-/tmp}/shiyu-visual-baseline-${PORT}.log"
PROFILE_DIR="${TMPDIR:-/tmp}/shiyu-chromium-$$"

if [[ -z "$CHROMIUM_BIN" ]]; then
  CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
fi
if [[ -z "$CHROMIUM_BIN" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [[ -x "$candidate" ]]; then
      CHROMIUM_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$CHROMIUM_BIN" ]]; then
  echo "未找到 Chromium/Chrome。请设置 CHROMIUM_BIN 后重试。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
npm --prefix "$ROOT_DIR" run build
npm --prefix "$ROOT_DIR" run preview -- --host 127.0.0.1 --port "$PORT" >"$PREVIEW_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$PREVIEW_LOG"
  rm -rf "$PROFILE_DIR"
}
trap cleanup EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

URL="http://127.0.0.1:$PORT/?baseline=1"
COMMON_FLAGS=(
  --headless
  --no-sandbox
  --disable-gpu
  --disable-software-rasterizer
  --disable-dev-shm-usage
  --hide-scrollbars
  --run-all-compositor-stages-before-draw
  --user-data-dir="$PROFILE_DIR"
)

"$CHROMIUM_BIN" "${COMMON_FLAGS[@]}" --window-size=1280,820 \
  --screenshot="$OUTPUT_DIR/idle-1280.png" "$URL"
"$CHROMIUM_BIN" "${COMMON_FLAGS[@]}" --window-size=390,844 \
  --screenshot="$OUTPUT_DIR/idle-390.png" "$URL"

for screenshot in "$OUTPUT_DIR/idle-1280.png" "$OUTPUT_DIR/idle-390.png"; do
  if [[ ! -s "$screenshot" ]]; then
    echo "截图未生成或为空：$screenshot" >&2
    exit 1
  fi
done

echo "视觉基线已生成：$OUTPUT_DIR/idle-1280.png"
echo "视觉基线已生成：$OUTPUT_DIR/idle-390.png"
