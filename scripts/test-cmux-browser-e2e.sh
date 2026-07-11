#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-cmux-browser-e2e.XXXXXX")"
server_log="$fixture_dir/server.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM

cat >"$fixture_dir/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Pi cmux browser E2E</title>
<button id="hello">Say hello</button>
<output id="status">Ready</output>
<script>
  hello.addEventListener('click', () => { status.textContent = 'Clicked'; });
</script>
HTML

python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$fixture_dir" >"$server_log" 2>&1 &
server_pid=$!

port=""
for _ in {1..50}; do
  port="$(grep -Eo 'port [0-9]+' "$server_log" | awk '{print $2}' | tail -1 || true)"
  [[ -n "$port" ]] && break
  sleep 0.1
done
if [[ -z "$port" ]]; then
  echo "Local fixture server did not start" >&2
  cat "$server_log" >&2
  exit 1
fi

cmux browser status | grep -qx enabled || {
  echo "cmux browser automation is not enabled; run: cmux browser enable" >&2
  exit 1
}
cmux ping >/dev/null

"$repo_root/node_modules/.bin/tsx" "$repo_root/cmux-browser/e2e.ts" "http://127.0.0.1:$port/" "$fixture_dir"
