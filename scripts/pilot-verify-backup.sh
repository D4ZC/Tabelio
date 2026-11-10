#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ $# -ne 1 ]]; then
  echo "Uso: bash scripts/pilot-verify-backup.sh /ruta/al/respaldo" >&2
  exit 1
fi

backup_dir="$(cd "$1" && pwd)"
for required in database.dump backup-metadata.json manifest.sha256; do
  if [[ ! -f "$backup_dir/$required" ]]; then
    echo "Falta $required en $backup_dir" >&2
    exit 1
  fi
done

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

container_engine=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  container_engine="docker"
  compose=(docker compose)
elif command -v podman >/dev/null 2>&1; then
  container_engine="podman"
  compose=(podman compose)
else
  echo "No se encontró Docker ni Podman para verificar PostgreSQL." >&2
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

(
  cd "$backup_dir"
  shasum -a 256 -c manifest.sha256
)

if [[ -f "$backup_dir/object-storage.tar.gz" ]]; then
  tar -tzf "$backup_dir/object-storage.tar.gz" >/dev/null
fi

postgres_user="${POSTGRES_USER:-despacho}"
verification_database="pilot_verify_$(date -u +%Y%m%d%H%M%S)_$$"
container_dump_path="/tmp/${verification_database}.dump"
cleanup() {
  if [[ "$container_engine" == "podman" ]]; then
    podman exec "$postgres_container_id" dropdb --username "$postgres_user" --if-exists "$verification_database" >/dev/null 2>&1 || true
    podman exec "$postgres_container_id" rm -f "$container_dump_path" >/dev/null 2>&1 || true
  else
    "${compose[@]}" "${compose_args[@]}" exec -T postgres dropdb --username "$postgres_user" --if-exists "$verification_database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "$container_engine" == "podman" ]]; then
  podman cp "$backup_dir/database.dump" "$postgres_container_id:$container_dump_path"
  podman exec "$postgres_container_id" createdb --username "$postgres_user" "$verification_database"
  podman exec "$postgres_container_id" pg_restore --list "$container_dump_path" >/dev/null
  podman exec "$postgres_container_id" pg_restore \
    --username "$postgres_user" \
    --dbname "$verification_database" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$container_dump_path"

  counts="$(podman exec "$postgres_container_id" psql --username "$postgres_user" --dbname "$verification_database" --tuples-only --no-align --command \
    'SELECT (SELECT COUNT(*) FROM "Organization"), (SELECT COUNT(*) FROM "Matter"), (SELECT COUNT(*) FROM "Document");')"
else
  "${compose[@]}" "${compose_args[@]}" exec -T postgres createdb --username "$postgres_user" "$verification_database"
  "${compose[@]}" "${compose_args[@]}" exec -T postgres pg_restore --list < "$backup_dir/database.dump" >/dev/null
  "${compose[@]}" "${compose_args[@]}" exec -T postgres pg_restore \
    --username "$postgres_user" \
    --dbname "$verification_database" \
    --no-owner \
    --no-privileges \
    --exit-on-error < "$backup_dir/database.dump"

  counts="$("${compose[@]}" "${compose_args[@]}" exec -T postgres psql --username "$postgres_user" --dbname "$verification_database" --tuples-only --no-align --command \
    'SELECT (SELECT COUNT(*) FROM "Organization"), (SELECT COUNT(*) FROM "Matter"), (SELECT COUNT(*) FROM "Document");')"
fi

node -e '
  const fs = require("node:fs");
  const [organizations, matters, documents] = process.argv[3].trim().split("|").map(Number);
  const evidence = {
    formatVersion: 1,
    verifiedAt: new Date().toISOString(),
    sourceBackup: process.argv[2],
    checksumVerified: true,
    databaseRestoreVerified: true,
    objectArchiveVerified: process.argv[4] === "true",
    restoredCounts: { organizations, matters, documents },
  };
  fs.writeFileSync(process.argv[1], `${JSON.stringify(evidence, null, 2)}\n`);
' "$backup_dir/verification.json" "$backup_dir" "$counts" "$([[ -f "$backup_dir/object-storage.tar.gz" ]] && echo true || echo false)"

cleanup
trap - EXIT
echo "Restauración verificada: $backup_dir/verification.json"
