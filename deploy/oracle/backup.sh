#!/usr/bin/env bash
# Sao lưu CSDL SQLite ra thư mục backups/ (giữ 14 bản gần nhất).
# Dùng VACUUM INTO nên an toàn khi app đang chạy.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f deploy/oracle/docker-compose.yml --env-file .env)
docker info >/dev/null 2>&1 || COMPOSE=(sudo "${COMPOSE[@]}")

mkdir -p backups
name="seller-union-$(date +%Y%m%d-%H%M%S).db"
"${COMPOSE[@]}" exec -T app node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  require('node:fs').rmSync('/app/data/backup.tmp', { force: true });
  const db = new DatabaseSync('/app/data/seller-union.db');
  db.exec(\"VACUUM INTO '/app/data/backup.tmp'\");
"
"${COMPOSE[@]}" cp app:/app/data/backup.tmp "backups/$name"
"${COMPOSE[@]}" exec -T app rm -f /app/data/backup.tmp
gzip "backups/$name"
ls -1t backups/seller-union-*.db.gz | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') Đã sao lưu backups/$name.gz"
