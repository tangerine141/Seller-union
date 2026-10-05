#!/usr/bin/env bash
# Cập nhật mã nguồn mới nhất và khởi động lại. Dữ liệu được giữ nguyên.
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

bash deploy/oracle/backup.sh
git pull --ff-only
"${COMPOSE[@]}" up -d --build
docker image prune -f >/dev/null 2>&1 || true
echo "Đã cập nhật."
