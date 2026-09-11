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

if [ ! -f "$WORLDS_DIR/$WORLD.db" ]; then
  echo "ERRO: mundo '$WORLD' não encontrado em $WORLDS_DIR"
  echo "O servidor já rodou pelo menos uma vez?"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)
NAME="valheim-${WORLD}-${STAMP}.tar.gz"

# .db e .fwl: sem o .fwl o mundo não abre.
# Escreve em .tmp primeiro pra não deixar tar truncado se morrer no meio.
tar -czf "$BACKUP_DIR/$NAME.tmp" -C "$WORLDS_DIR" "$WORLD.db" "$WORLD.fwl"
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
