#!/usr/bin/env bash
# Sobe o servidor e o painel.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERRO: .env não existe."
  echo "Rode:  cp .env.example .env   e preencha antes de subir."
  exit 1
fi

# Crossplay é uma flag de linha de comando, não uma variável própria.
# Traduzimos aqui pra quem edita o .env não precisar saber disso.
set -a; . ./.env; set +a
if [ "${VALHEIM_CROSSPLAY:-false}" = "true" ]; then
  export VALHEIM_CROSSPLAY_ARG="-crossplay"
else
  export VALHEIM_CROSSPLAY_ARG=""
fi

mkdir -p data/config data/server backups

docker compose up -d

echo
echo "Subindo. A PRIMEIRA vez baixa ~2 GB do Steam e leva alguns minutos."
echo "Painel:  http://localhost:${PANEL_PORT:-8080}"
echo "Log:     docker compose logs -f valheim"
