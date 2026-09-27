#!/usr/bin/env bash
# Cập nhật mã nguồn mới nhất và khởi động lại. Dữ liệu được giữ nguyên.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f deploy/oracle/docker-compose.yml --env-file .env)
docker info >/dev/null 2>&1 || COMPOSE=(sudo "${COMPOSE[@]}")

bash deploy/oracle/backup.sh
git pull --ff-only
"${COMPOSE[@]}" up -d --build
docker image prune -f >/dev/null 2>&1 || true
echo "Đã cập nhật."
