#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  compose=(docker compose -f compose.yaml)
elif command -v podman >/dev/null 2>&1; then
  if ! podman info >/dev/null 2>&1; then
    echo 'Podman no está disponible. En macOS, ejecuta: podman machine start' >&2
    exit 1
  fi
  compose=(podman compose -f compose.yaml)
else
  echo 'Se necesita Docker activo con Compose, o Podman con una máquina activa, para iniciar PostgreSQL.' >&2
  exit 1
fi

echo "Levantando PostgreSQL con ${compose[*]}..."
"${compose[@]}" up -d postgres

echo 'Esperando a PostgreSQL...'
attempt=0
until "${compose[@]}" exec -T postgres pg_isready -U despacho -d despacho >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [[ "$attempt" -ge 30 ]]; then
    echo 'PostgreSQL no estuvo listo después de 60 segundos. Revisa los logs del servicio postgres.' >&2
    "${compose[@]}" ps
    exit 1
  fi
  sleep 2
done
