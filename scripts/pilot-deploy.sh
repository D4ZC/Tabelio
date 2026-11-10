#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env.pilot ]]; then
  echo "Falta .env.pilot. Copia .env.pilot.example y reemplaza todos los valores CHANGE_ME." >&2
  exit 1
fi
if grep -q 'CHANGE_ME' .env.pilot; then
  echo ".env.pilot todavía contiene valores CHANGE_ME." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v podman >/dev/null 2>&1; then
  compose=(podman compose)
else
  echo "No se encontró Docker ni Podman." >&2
  exit 1
fi

compose_args=(--env-file .env.pilot -f compose.pilot.yaml)
"${compose[@]}" "${compose_args[@]}" config >/dev/null
"${compose[@]}" "${compose_args[@]}" build
"${compose[@]}" "${compose_args[@]}" up -d postgres
PILOT_ENV_FILE=.env.pilot PILOT_COMPOSE_FILE=compose.pilot.yaml \
  bash scripts/pilot-backup.sh --database-only
"${compose[@]}" "${compose_args[@]}" run --rm migrate
"${compose[@]}" "${compose_args[@]}" up -d api web

health_url="${PILOT_HEALTH_URL:-http://localhost:4000/api/health/ready}"
ready=false
for _attempt in $(seq 1 24); do
  if node -e '
    fetch(process.argv[1]).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body.status !== "ready") process.exit(1);
    }).catch(() => process.exit(1));
  ' "$health_url"; then
    ready=true
    break
  fi
  sleep 5
done
if [[ "$ready" != true ]]; then
  echo "La API no alcanzó estado ready en $health_url." >&2
  "${compose[@]}" "${compose_args[@]}" ps >&2 || true
  exit 1
fi

echo "Despliegue listo y dependencias verificadas. Termina TLS en el proxy inverso."
