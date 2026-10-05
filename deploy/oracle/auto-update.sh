#!/usr/bin/env bash
# Chạy định kỳ bởi cron: có commit mới trên GitHub thì tự cập nhật (sao lưu → pull → build → khởi động lại).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec 9>/tmp/seller-union-update.lock
flock -n 9 || exit 0  # lần chạy trước chưa xong

export GIT_TERMINAL_PROMPT=0  # không bao giờ đứng chờ nhập mật khẩu
branch=$(git rev-parse --abbrev-ref HEAD)
if ! git fetch -q origin "$branch"; then
  echo "$(date '+%F %T') ❌ Không tải được từ GitHub (repo riêng tư? chạy lại enable-auto-update.sh để lưu token)"
  exit 1
fi
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$branch")" ]] && exit 0

echo "$(date '+%F %T') Có bản mới $(git rev-parse --short "origin/$branch") — đang cập nhật..."
bash deploy/oracle/update.sh
echo "$(date '+%F %T') ✅ Đã cập nhật lên $(git rev-parse --short HEAD)"
