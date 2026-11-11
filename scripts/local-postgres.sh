#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

postgres_port="${LOCAL_POSTGRES_PORT:-55432}"
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$postgres_port") >/dev/null 2>&1; }

if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  # Sin contenedores (p. ej. Windows con Git Bash): se usa PostgreSQL instalado localmente.
  if port_open; then
    echo "Usando PostgreSQL local en el puerto $postgres_port."
    exit 0
  fi
  echo "No hay Docker/Podman y PostgreSQL no responde en el puerto $postgres_port." >&2
  echo 'En Windows, inicia el servicio "postgresql-x64-17" (services.msc) o instala PostgreSQL 17 en ese puerto.' >&2
  exit 1
fi

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
