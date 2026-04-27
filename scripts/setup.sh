#!/usr/bin/env bash
set -euo pipefail

echo "==> Email Agent Setup"

# ── Check Node ────────────────────────────────────────────────────────────────
node_version=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$node_version" || "$node_version" -lt 20 ]]; then
  echo "ERROR: Node.js 20+ required (found: $(node -v 2>/dev/null || echo 'none'))"
  exit 1
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> Installing dependencies..."
npm install

# ── Copy .env ─────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — please edit it before starting"
fi

# ── Create data directory ─────────────────────────────────────────────────────
mkdir -p data

# ── Determine storage backend ─────────────────────────────────────────────────
BACKEND="${STORAGE_BACKEND:-sqlite}"
echo "==> Storage backend: $BACKEND"

if [[ "$BACKEND" == "sqlite" ]]; then
  echo "==> Running SQLite migrations..."
  node --loader ts-node/esm scripts/migrate.ts
fi

if [[ "$BACKEND" == "postgres" ]]; then
  if [[ -z "${POSTGRES_URL:-}" ]]; then
    echo "ERROR: POSTGRES_URL must be set for postgres backend"
    exit 1
  fi
  echo "==> PostgreSQL backend detected — migrations run on first app start"
fi

echo ""
echo "✅  Setup complete!"
echo ""
echo "   Start (lite/SQLite):   npm start"
echo "   Start (full/Docker):   docker compose --profile full up -d"
echo "   Start (no-DB/memory):  STORAGE_BACKEND=memory npm start"
