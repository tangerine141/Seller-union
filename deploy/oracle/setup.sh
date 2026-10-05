#!/usr/bin/env bash
# Cài Seller Union lên máy ảo Oracle Cloud (Ubuntu 22.04/24.04, ARM hoặc x86).
# Chạy từ thư mục gốc của mã nguồn:  bash deploy/oracle/setup.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)
COMPOSE=(docker compose -f deploy/oracle/docker-compose.yml --env-file .env)

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

# 0. Máy RAM thấp (vd VM.Standard.E2.1.Micro 1GB): thêm 2GB swap để build không bị thiếu bộ nhớ.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 2000000 )) && ! swapon --show | grep -q .; then
  say "RAM thấp — tạo 2GB swap"
  $SUDO fallocate -l 2G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Cài Docker"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "${SUDO_USER:-$USER}" || true
fi
if ! docker info >/dev/null 2>&1; then
  # Người dùng vừa được thêm vào nhóm docker nhưng phiên hiện tại chưa nhận -> dùng sudo.
  COMPOSE=($SUDO "${COMPOSE[@]}")
fi

# 2. Tường lửa trong máy ảo: ảnh Ubuntu của Oracle chặn mọi cổng trừ 22 bằng iptables.
say "Mở cổng 80 và 443 trong iptables"
for port in 80 443; do
  if ! $SUDO iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    pos=$($SUDO iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    $SUDO iptables -I INPUT "${pos:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
if ! $SUDO iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null; then
  pos=$($SUDO iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  $SUDO iptables -I INPUT "${pos:-1}" -p udp --dport 443 -j ACCEPT
fi
if command -v netfilter-persistent >/dev/null 2>&1; then
  $SUDO netfilter-persistent save >/dev/null
else
  $SUDO apt-get update -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null
  $SUDO netfilter-persistent save >/dev/null
fi

# 3. File cấu hình .env
if [[ ! -f .env ]]; then
  say "Tạo file cấu hình .env"
  read -rp "Tên miền của bạn (vd: seller-union.vn) — để trống nếu chưa có, sẽ chạy tạm bằng IP: " DOMAIN
  DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%/}
  if [[ -z "$DOMAIN" ]]; then
    IP=$(curl -fsS --max-time 5 https://ifconfig.me || true)
    [[ -n "$IP" ]] || { echo "Không lấy được IP công khai của máy."; exit 1; }
    DOMAIN=":80"
    SITE_URL="http://$IP"
  else
    SITE_URL="https://$DOMAIN"
  fi
  cp .env.example .env
  sed -i "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -hex 32)#" .env
  sed -i "s#^SITE_URL=.*#SITE_URL=${SITE_URL}#" .env
  sed -i "s#^DB_FILE=.*#DB_FILE=/app/data/seller-union.db#" .env
  printf '\n# Tên miền cho Caddy (HTTPS). ":80" = chạy tạm bằng IP, chưa có HTTPS.\nDOMAIN=%s\n' "$DOMAIN" >> .env
  chmod 600 .env
else
  say "Dùng file .env có sẵn"
  grep -q '^DOMAIN=' .env || { echo "Thêm dòng DOMAIN=tenmien.vn vào .env rồi chạy lại."; exit 1; }
fi
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)

# 4. Kiểm tra DNS trỏ đúng về máy này (Let's Encrypt cần điều này để cấp HTTPS)
PUBLIC_IP=$(curl -fsS --max-time 5 https://ifconfig.me || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)
if [[ "$DOMAIN" != :* && -n "$PUBLIC_IP" && "$DNS_IP" != "$PUBLIC_IP" ]]; then
  echo "⚠️  $DOMAIN đang trỏ về '${DNS_IP:-chưa có}', nhưng IP máy này là $PUBLIC_IP."
  echo "    Tạo bản ghi A: $DOMAIN -> $PUBLIC_IP. HTTPS sẽ tự cấp khi DNS cập nhật xong."
fi

# 5. Build và chạy
say "Build và khởi động (lần đầu mất vài phút)"
"${COMPOSE[@]}" up -d --build

# 6. Sao lưu CSDL hằng ngày lúc 3h sáng, giữ 14 bản
say "Cài lịch sao lưu hằng ngày"
CRON_LINE="0 3 * * * cd $ROOT && bash deploy/oracle/backup.sh >> $ROOT/backups/backup.log 2>&1"
mkdir -p backups
# "|| true": crontab trống thì grep trả mã 1, không được để set -e dừng script.
( { crontab -l 2>/dev/null || true; } | { grep -v 'deploy/oracle/backup.sh' || true; }; echo "$CRON_LINE" ) | crontab -

SITE_URL=$(grep '^SITE_URL=' .env | cut -d= -f2)
say "Xong! Mở $SITE_URL (trang chủ) và $SITE_URL/app/ (ứng dụng)"
[[ "$DOMAIN" == :* ]] && echo "Đang chạy tạm bằng IP (chưa HTTPS). Khi có tên miền: xem mục \"Gắn tên miền sau\" trong deploy/oracle/README.md"
echo "Xem log:   ${COMPOSE[*]} logs -f"
echo "Cập nhật:  bash deploy/oracle/update.sh"
