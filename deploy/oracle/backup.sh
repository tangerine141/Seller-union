#!/usr/bin/env bash
# Sao lưu CSDL SQLite ra thư mục backups/ (giữ 14 bản gần nhất).
# Dùng VACUUM INTO nên an toàn khi app đang chạy.
set -euo pipefail
cd "$(dirname "$0")/../.."
# Phải chạy trên máy ảo đang chạy website (có Docker Compose), không phải Oracle Cloud Shell.
if ! docker compose version >/dev/null 2>&1 && ! sudo -n docker compose version >/dev/null 2>&1; then
  echo "❌ Máy này không có Docker Compose — có vẻ bạn đang ở Oracle Cloud Shell hoặc sai máy."
  echo "   Hãy đăng nhập vào máy ảo trước:  ssh ubuntu@<IP-máy-ảo>"
  echo "   (dòng lệnh phải có dạng ubuntu@...), rồi chạy lại lệnh này trong thư mục ~/seller-union."
  exit 1
fi

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
