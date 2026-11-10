#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

pilot_env_file="${PILOT_ENV_FILE:-.env}"
pilot_compose_file="${PILOT_COMPOSE_FILE:-compose.yaml}"
if [[ -n "${PILOT_ENV_FILE:-}" && ! -f "$pilot_env_file" ]]; then
  echo "No existe el archivo de entorno solicitado: $pilot_env_file" >&2
  exit 1
fi
if [[ ! -f "$pilot_compose_file" ]]; then
  echo "No existe el archivo Compose: $pilot_compose_file" >&2
  exit 1
fi
if [[ -f "$pilot_env_file" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$pilot_env_file"
  set +a
fi

backup_root="${PILOT_BACKUP_ROOT:-$project_dir/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$backup_root/$timestamp"
database_only=false
if [[ "${1:-}" == "--database-only" ]]; then
  database_only=true
elif [[ $# -gt 0 ]]; then
  echo "Uso: bash scripts/pilot-backup.sh [--database-only]" >&2
  exit 1
fi

container_engine=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  container_engine="docker"
  compose=(docker compose)
elif command -v podman >/dev/null 2>&1; then
  container_engine="podman"
  compose=(podman compose)
else
  echo "No se encontró Docker ni Podman para acceder a PostgreSQL." >&2
  exit 1
fi

postgres_container_id=""
if [[ "$container_engine" == "podman" ]]; then
  postgres_container_count=0
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    postgres_container_id="$candidate"
    ((postgres_container_count += 1))
  done < <(podman ps \
    --filter "label=com.docker.compose.service=postgres" \
    --filter "label=com.docker.compose.project.working_dir=$project_dir" \
    --filter "label=com.docker.compose.project.config_files=$pilot_compose_file" \
    --format '{{.ID}}')

  if [[ "$postgres_container_count" -ne 1 ]]; then
    echo "Se esperaba un contenedor PostgreSQL activo para $project_dir; se encontraron $postgres_container_count." >&2
    exit 1
  fi
fi

compose_args=(-f "$pilot_compose_file")
if [[ -f "$pilot_env_file" ]]; then
  compose_args=(--env-file "$pilot_env_file" -f "$pilot_compose_file")
fi

mkdir -p "$backup_dir"
postgres_user="${POSTGRES_USER:-despacho}"
postgres_database="${POSTGRES_DB:-despacho}"

if [[ "$container_engine" == "podman" ]]; then
  podman exec "$postgres_container_id" pg_dump \
    --username "$postgres_user" \
    --dbname "$postgres_database" \
    --format custom \
    --no-owner \
    --no-privileges > "$backup_dir/database.dump"
else
  "${compose[@]}" "${compose_args[@]}" exec -T postgres pg_dump \
    --username "$postgres_user" \
    --dbname "$postgres_database" \
    --format custom \
    --no-owner \
    --no-privileges > "$backup_dir/database.dump"
fi

object_count=0
if [[ "$database_only" == false && "${STORAGE_DRIVER:-local}" == "local" ]]; then
  storage_path="${LOCAL_STORAGE_PATH:-$project_dir/storage}"
  if [[ "$storage_path" != /* ]]; then storage_path="$project_dir/${storage_path#./}"; fi
  if [[ ! -d "$storage_path" ]]; then
    echo "No existe el directorio de documentos: $storage_path" >&2
    exit 1
  fi
  object_count="$(find "$storage_path" -type f | wc -l | tr -d ' ')"
  tar -C "$storage_path" -czf "$backup_dir/object-storage.tar.gz" .
fi

node -e '
  const fs = require("node:fs");
  const output = process.argv[1];
  const metadata = {
    formatVersion: 1,
    createdAt: process.argv[2],
    database: process.argv[3],
    storageDriver: process.argv[4],
    objectCount: Number(process.argv[5]),
    databaseOnly: process.argv[6] === "true",
  };
  fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
' "$backup_dir/backup-metadata.json" "$timestamp" "$postgres_database" "${STORAGE_DRIVER:-local}" "$object_count" "$database_only"

(
  cd "$backup_dir"
  files=(database.dump backup-metadata.json)
  if [[ -f object-storage.tar.gz ]]; then files+=(object-storage.tar.gz); fi
  shasum -a 256 "${files[@]}" > manifest.sha256
)

echo "Respaldo creado: $backup_dir"
echo "Siguiente paso: bash scripts/pilot-verify-backup.sh '$backup_dir'"
