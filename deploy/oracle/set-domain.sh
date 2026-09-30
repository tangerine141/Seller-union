#!/usr/bin/env bash
# Gắn tên miền + bật HTTPS tự động.
#   bash deploy/oracle/set-domain.sh banhang-dakenh.com
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo "Chưa có .env — chạy deploy/oracle/setup.sh trước."; exit 1; }

get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_var() {
  local k=$1 v=$2
  if grep -qE "^$k=" .env; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
  chmod 600 .env
}

DOMAIN=${1:-}
[[ -n "$DOMAIN" ]] || read -rp "Tên miền (vd: banhang-dakenh.com): " DOMAIN
DOMAIN=$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Tên miền không hợp lệ: $DOMAIN"; exit 1; }

PUBLIC_IP=$(curl -fsS --max-time 5 https://ifconfig.me || true)
resolve() { getent ahostsv4 "$1" | awk 'NR==1 {print $1}' || true; }

echo "IP máy chủ: ${PUBLIC_IP:-không rõ}"
ok=1
for h in "$DOMAIN" "www.$DOMAIN"; do
  ip=$(resolve "$h")
  if [[ "$ip" == "$PUBLIC_IP" ]]; then echo "  ✅ $h → $ip"
  else echo "  ❌ $h → ${ip:-chưa trỏ}"; [[ "$h" == "$DOMAIN" ]] && ok=0; fi
done
if (( ok == 0 )) && curl -fsSI --max-time 8 "http://$DOMAIN/" 2>/dev/null | grep -qi '^server: cloudflare'; then
  echo
  echo "Tên miền đang bật Proxy của Cloudflare (đám mây cam) nên chưa lấy được chứng chỉ HTTPS."
  echo "  1. Cloudflare → DNS: bấm vào đám mây cam của '@' và 'www' → chuyển thành 'DNS only' (xám) → Save."
  echo "  2. Đợi 1–2 phút rồi chạy lại lệnh này."
  echo "  3. Khi báo ✅ Xong: bật lại Proxied (cam) và vào SSL/TLS → Overview → chọn 'Full (strict)'."
  exit 1
fi
if (( ok == 0 )); then
  echo
  echo "Tên miền chính chưa trỏ về máy này. Vào trang quản lý DNS và tạo:"
  echo "   A      @     $PUBLIC_IP"
  echo "   CNAME  www   $DOMAIN"
  echo "Đợi vài phút rồi chạy lại. (Dùng Cloudflare: để 'DNS only' – đám mây xám.)"
  exit 1
fi

WWW=""
[[ "$(resolve "www.$DOMAIN")" == "$PUBLIC_IP" ]] && WWW="www.$DOMAIN"

set_var DOMAIN "$DOMAIN"
set_var WWW_DOMAIN "$WWW"
set_var SITE_URL "https://$DOMAIN"

COMPOSE=(docker compose -f deploy/oracle/docker-compose.yml --env-file .env)
docker info >/dev/null 2>&1 || COMPOSE=(sudo "${COMPOSE[@]}")
"${COMPOSE[@]}" up -d

echo
echo "Đang lấy chứng chỉ HTTPS (tối đa ~2 phút)..."
for _ in $(seq 1 24); do
  if curl -fsS -o /dev/null --max-time 5 "https://$DOMAIN/"; then
    echo "✅ Xong! Trang chủ: https://$DOMAIN   Ứng dụng: https://$DOMAIN/app/"
    [[ -n "$WWW" ]] && echo "   https://$WWW tự chuyển về https://$DOMAIN"
    echo "   Đăng nhập lại một lần vì địa chỉ đã đổi."
    echo "   Dùng Cloudflare: giờ có thể bật lại Proxied (cam), SSL/TLS chọn 'Full (strict)' (đừng chọn Flexible)."
    exit 0
  fi
  sleep 5
done
echo "Chưa truy cập được qua HTTPS. Xem log:  ${COMPOSE[*]} logs caddy | tail -30"
exit 1
