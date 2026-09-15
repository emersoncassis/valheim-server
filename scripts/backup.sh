#!/usr/bin/env bash
# Backup manual do mundo, com a mesma rotação do painel.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a

WORLD="${VALHEIM_WORLD_NAME:-Dedicated}"
WORLDS_DIR="data/config/worlds_local"
BACKUP_DIR="backups"
KEEP="${BACKUP_KEEP:-14}"
MAX_AGE="${BACKUP_MAX_AGE_DAYS:-30}"

# Valheim 1.0+ guarda o mundo como PASTA (worlds_local/<Mundo>/) cheia de
# .chunk mais os metadados _main.<n>.db2/.fwl2/.chunks/.ok. Antes da 1.0
# eram dois arquivos soltos. Detectamos os dois formatos.
if [ -d "$WORLDS_DIR/$WORLD" ]; then
  ENTRIES=("$WORLD")
elif [ -f "$WORLDS_DIR/$WORLD.db" ]; then
  ENTRIES=("$WORLD.db" "$WORLD.fwl")
else
  echo "ERRO: mundo '$WORLD' não encontrado em $WORLDS_DIR"
  echo "Esperava a pasta $WORLD/ (Valheim 1.0+) ou $WORLD.db (formato antigo)."
  echo "O servidor já rodou pelo menos uma vez?"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)
NAME="valheim-${WORLD}-${STAMP}.tar.gz"

# Escreve em .tmp primeiro pra não deixar tar truncado se morrer no meio.
tar -czf "$BACKUP_DIR/$NAME.tmp" -C "$WORLDS_DIR" "${ENTRIES[@]}"
mv "$BACKUP_DIR/$NAME.tmp" "$BACKUP_DIR/$NAME"
echo "Criado: $BACKUP_DIR/$NAME"

# --- Rotação ---
# Mantém os $KEEP mais recentes; depois apaga os mais velhos que $MAX_AGE dias.
cd "$BACKUP_DIR"
ls -1t valheim-${WORLD}-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f -- "$old"
  echo "Removido (cota): $old"
done

if [ "$MAX_AGE" -gt 0 ]; then
  # -mtime respeita a cota acima porque os recentes já sobreviveram.
  find . -maxdepth 1 -name "valheim-${WORLD}-*.tar.gz" -mtime +"$MAX_AGE" -print -delete \
    | sed 's|^\./|Removido (idade): |'
fi

REMAINING=$(ls -1 valheim-${WORLD}-*.tar.gz 2>/dev/null | wc -l)
echo "Backups mantidos: $REMAINING"
