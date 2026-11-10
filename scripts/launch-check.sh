#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

npm run db:deploy
npm test
npm run lint
npm run build

api_url="${API_URL:-http://localhost:4000/api}"
started_api_pid=""
cleanup() {
  if [[ -n "$started_api_pid" ]]; then
    kill "$started_api_pid" >/dev/null 2>&1 || true
    wait "$started_api_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ready_probe() {
  node -e '
    fetch(`${process.argv[1].replace(/\/$/, "")}/health/ready`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.status !== "ready") process.exit(1);
      })
      .catch(() => process.exit(1));
  ' "$api_url"
}

if ! ready_probe; then
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  node apps/api/dist/main.js >/dev/null 2>&1 &
  started_api_pid="$!"
  for _attempt in $(seq 1 30); do
    if ready_probe; then break; fi
    sleep 1
  done
fi

node -e '
  const url = `${process.argv[1].replace(/\/$/, "")}/health/ready`;
  fetch(url).then(async (response) => {
    const body = await response.json();
    if (!response.ok || body.status !== "ready") throw new Error(JSON.stringify(body));
    console.log(`Ambiente local listo: ${JSON.stringify(body.checks)}`);
  }).catch((error) => { console.error(error); process.exit(1); });
' "$api_url"

npm run test:smoke
