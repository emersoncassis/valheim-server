#!/usr/bin/env bash
# Reinicia só o servidor de Valheim (o painel continua no ar).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
echo "Reiniciando o servidor..."
docker compose restart -t 120 valheim
echo "OK. Leva ~1-2 min pra aceitar conexões."
