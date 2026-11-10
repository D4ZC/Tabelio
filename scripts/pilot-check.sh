#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

npm run db:deploy
npm test
npm run lint
npm run build

api_url="${API_URL:-http://localhost:4000/api}"
node -e '
  const url = `${process.argv[1].replace(/\/$/, "")}/health/ready`;
  fetch(url).then(async (response) => {
    const body = await response.json();
    if (!response.ok || body.status !== "ready") throw new Error(JSON.stringify(body));
    console.log(`Dependencias listas: ${JSON.stringify(body.checks)}`);
  }).catch((error) => { console.error(error); process.exit(1); });
' "$api_url"

npm run test:smoke
