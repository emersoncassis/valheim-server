#!/usr/bin/env bash
# Restaura um backup. Uso:  ./scripts/restore.sh [nome-do-backup.tar.gz]
# Sem argumento, lista os disponíveis.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a

WORLD="${VALHEIM_WORLD_NAME:-Dedicated}"
WORLDS_DIR="data/config/worlds_local"
BACKUP_DIR="backups"

if [ $# -eq 0 ]; then
  echo "Backups disponíveis:"
  ls -1t "$BACKUP_DIR"/valheim-*.tar.gz 2>/dev/null | sed 's|.*/|  |' || echo "  (nenhum)"
  echo
  echo "Uso: $0 <nome-do-arquivo.tar.gz>"
  exit 0
fi

NAME="$(basename "$1")"   # basename corta qualquer ../ no caminho
SRC="$BACKUP_DIR/$NAME"

if [ ! -f "$SRC" ]; then
  echo "ERRO: $SRC não existe."
  exit 1
fi

echo "Isso vai SOBRESCREVER o mundo '$WORLD' com $NAME."
read -rp "Confirma? (digite: sim) " ans
[ "$ans" = "sim" ] || { echo "Cancelado."; exit 0; }

echo "Parando o servidor..."
docker compose stop -t 120 valheim

# Rede de segurança: se o backup escolhido for o errado, dá pra voltar.
SAFETY=""
if [ -d "$WORLDS_DIR/$WORLD" ]; then
  SAFETY="$BACKUP_DIR/pre-restore-${WORLD}-$(date +%Y%m%dT%H%M%S).tar.gz"
  tar -czf "$SAFETY" -C "$WORLDS_DIR" "$WORLD"
  echo "Mundo atual salvo em: $SAFETY"
elif [ -f "$WORLDS_DIR/$WORLD.db" ]; then
  SAFETY="$BACKUP_DIR/pre-restore-${WORLD}-$(date +%Y%m%dT%H%M%S).tar.gz"
  tar -czf "$SAFETY" -C "$WORLDS_DIR" "$WORLD.db" "$WORLD.fwl"
  echo "Mundo atual salvo em: $SAFETY"
fi

# Mundo em pasta: apaga a atual antes de extrair, senão chunks do mundo
# antigo que não existem no backup sobrevivem e se misturam com os novos.
if [ -d "$WORLDS_DIR/$WORLD" ]; then
  if [ -z "$SAFETY" ]; then
    echo "ERRO: sem backup de segurança, não vou apagar o mundo atual."
    exit 1
  fi
  rm -rf "${WORLDS_DIR:?}/${WORLD:?}"
fi

mkdir -p "$WORLDS_DIR"
tar -xzf "$SRC" -C "$WORLDS_DIR"
echo "Restaurado: $NAME"

echo "Subindo o servidor..."
docker compose start valheim
echo "Pronto. Leva ~1-2 min pra aceitar conexões."
