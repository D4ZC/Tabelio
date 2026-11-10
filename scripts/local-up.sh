#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Se creó .env a partir de .env.example"
fi

bash scripts/local-postgres.sh

export DATABASE_URL='postgresql://despacho:despacho@localhost:55432/despacho?schema=public'

echo "Generando cliente y aplicando migraciones..."
npm run db:generate
npm run db:deploy
npm run db:seed

echo
echo "Infraestructura lista. Ejecuta: npm run dev"
echo "Acceso demo: admin@demo.local / Demo123!"
