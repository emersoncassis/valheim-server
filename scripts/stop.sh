#!/usr/bin/env bash
# Para tudo, dando tempo do Valheim salvar o mundo.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Parando (até 2 min — o servidor salva o mundo antes de sair)..."
docker compose stop -t 120
echo "Parado."
