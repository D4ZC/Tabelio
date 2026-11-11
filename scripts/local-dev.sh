#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo 'Se creó .env a partir de .env.example'
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Puerto dedicado para no interferir con PostgreSQL ya instalado.
export DATABASE_URL='postgresql://despacho:despacho@localhost:55432/despacho?schema=public'
export STORAGE_DRIVER='local'
# Respeta rutas definidas en .env (p. ej. documentos importados en otra unidad).
export LOCAL_STORAGE_PATH="${LOCAL_STORAGE_PATH:-$project_dir/storage}"
export TEMPLATE_ROOT="${TEMPLATE_ROOT:-$project_dir/apps/api/templates}"

if [[ -z "${LIBREOFFICE_BIN:-}" ]]; then
  if command -v soffice >/dev/null 2>&1; then
    export LIBREOFFICE_BIN="$(command -v soffice)"
  elif [[ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]]; then
    export LIBREOFFICE_BIN='/Applications/LibreOffice.app/Contents/MacOS/soffice'
  elif [[ -f '/c/Program Files/LibreOffice/program/soffice.exe' ]]; then
    export LIBREOFFICE_BIN='C:/Program Files/LibreOffice/program/soffice.exe'
  else
    user_home="${HOME:?No se pudo determinar el directorio del usuario}"
    codex_soffice="$user_home/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice"
    if [[ -x "$codex_soffice" ]]; then
      export LIBREOFFICE_BIN="$codex_soffice"
    else
      echo 'Aviso: LibreOffice no está disponible; instala LibreOffice o configura LIBREOFFICE_BIN para generar PDF.' >&2
    fi
  fi
fi

bash scripts/local-postgres.sh

echo 'Generando cliente y verificando migraciones de la base local...'
npm run db:generate
npm run db:deploy

if [[ "${DESPACHO_MOBILE_HTTPS:-false}" == 'true' ]]; then
  node scripts/mobile-certificates.mjs
  export NEXT_PUBLIC_API_URL='/api'
  export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:${API_PORT:-4000}/api}"
  npm run dev:apps:mobile
else
  npm run dev:apps
fi
