#!/usr/bin/env bash
# Bật tự động cập nhật code mỗi 10 phút.   Tắt:  bash deploy/oracle/enable-auto-update.sh --off
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
# Phải chạy trên máy ảo đang chạy website (có Docker Compose), không phải Oracle Cloud Shell.
if ! docker compose version >/dev/null 2>&1 && ! sudo -n docker compose version >/dev/null 2>&1; then
  echo "❌ Máy này không có Docker Compose — có vẻ bạn đang ở Oracle Cloud Shell hoặc sai máy."
  echo "   Hãy đăng nhập vào máy ảo trước:  ssh ubuntu@<IP-máy-ảo>"
  exit 1
fi

if [[ "${1:-}" == "--off" ]]; then
  ( { crontab -l 2>/dev/null || true; } | { grep -v 'deploy/oracle/auto-update.sh' || true; } ) | crontab -
  echo "Đã tắt tự động cập nhật."
  exit 0
fi

# Repo riêng tư: lưu GitHub token một lần để máy tự tải code mà không hỏi mật khẩu.
if ! GIT_TERMINAL_PROMPT=0 git fetch -q origin 2>/dev/null; then
  echo "Máy chưa tải được code từ GitHub mà không cần mật khẩu (repo riêng tư)."
  echo "Tạo token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained,"
  echo "chọn repo này, quyền Contents: Read-only."
  read -rp "Tên đăng nhập GitHub: " gh_user
  read -rsp "Dán token (không hiện ra màn hình): " gh_token; echo
  git config --global credential.helper store
  printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$gh_user" "$gh_token" | git credential approve
  chmod 600 ~/.git-credentials 2>/dev/null || true
  GIT_TERMINAL_PROMPT=0 git fetch -q origin || { echo "❌ Token không đúng hoặc thiếu quyền. Thử lại."; exit 1; }
  echo "✅ Đã lưu token."
fi

mkdir -p backups
LINE="*/10 * * * * cd $ROOT && bash deploy/oracle/auto-update.sh >> $ROOT/backups/auto-update.log 2>&1"
# Cài lại cả lịch sao lưu 3h sáng (bản setup.sh cũ có thể đã bỏ sót).
BACKUP="0 3 * * * cd $ROOT && bash deploy/oracle/backup.sh >> $ROOT/backups/backup.log 2>&1"
( { crontab -l 2>/dev/null || true; } | { grep -v -e 'deploy/oracle/auto-update.sh' -e 'deploy/oracle/backup.sh' || true; }
  echo "$BACKUP"; echo "$LINE" ) | crontab -
echo "✅ Đã bật: cứ 10 phút máy kiểm tra GitHub, có code mới thì tự cập nhật."
echo "✅ Lịch sao lưu dữ liệu 3h sáng mỗi ngày: đã bật."
echo "   Xem nhật ký:  tail -f $ROOT/backups/auto-update.log"
echo "   Tắt:          bash deploy/oracle/enable-auto-update.sh --off"
echo
echo "Kiểm tra ngay lần đầu..."
bash deploy/oracle/auto-update.sh && echo "(Nếu không có dòng nào ở trên nghĩa là đang ở bản mới nhất.)"
