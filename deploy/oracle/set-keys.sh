#!/usr/bin/env bash
# TÙY CHỌN: đặt key app CHUNG của hệ thống (chỉ khi đã được sàn duyệt app dành cho bên thứ ba).
# Bình thường mỗi shop tự dán key riêng trong app (Shop → Thêm shop), không cần script này.
# Chạy trên máy chủ:  bash deploy/oracle/set-keys.sh
# Bỏ trống một ô = giữ nguyên giá trị cũ.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo "Chưa có .env — chạy deploy/oracle/setup.sh trước."; exit 1; }

get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_var() { # tên giá_trị
  local k=$1 v=$2
  if grep -qE "^$k=" .env; then
    # Dùng awk để giá trị chứa ký tự đặc biệt (/, &, #) không làm hỏng lệnh thay thế.
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
  chmod 600 .env
}
mask() { local v=$1; [[ -z "$v" ]] && echo "(chưa có)" || echo "${v:0:4}…${v: -2}"; }

ask() { # tên nhãn bí_mật?
  local k=$1 label=$2 secret=${3:-} cur val
  cur=$(get "$k")
  if [[ -n "$secret" ]]; then
    read -rsp "  $label [$(mask "$cur")]: " val; echo
  else
    read -rp "  $label [${cur:-(chưa có)}]: " val
  fi
  val=$(echo "$val" | tr -d '[:space:]')
  [[ -n "$val" ]] && set_var "$k" "$val"
  return 0
}

SITE_URL=$(get SITE_URL)
echo "Địa chỉ website: $SITE_URL"
if [[ "$SITE_URL" != https://* ]]; then
  echo "⚠️  Website chưa có HTTPS. Shopee/Lazada/TikTok thường yêu cầu Redirect URL dạng https://"
  echo "    → Gắn tên miền trước (xem 'Gắn tên miền sau' trong deploy/oracle/README.md)."
fi

echo
echo "Khai báo các Redirect/Callback URL sau trên trang nhà phát triển của từng sàn:"
echo "  Shopee:      $SITE_URL/connect/shopee/callback"
echo "  Lazada:      $SITE_URL/connect/lazada/callback"
echo "  TikTok Shop: $SITE_URL/connect/tiktok/callback"

echo
read -rp "Nhập key Shopee? (y/N) " a
if [[ $a =~ ^[yY] ]]; then
  ask SHOPEE_PARTNER_ID "Partner ID"
  ask SHOPEE_PARTNER_KEY "Partner Key" secret
  read -rp "  Dùng môi trường TEST (sandbox) của Shopee? (y/N) " t
  if [[ $t =~ ^[yY] ]]; then set_var SHOPEE_HOST https://partner.test-stable.shopeemobile.com
  else set_var SHOPEE_HOST https://partner.shopeemobile.com; fi
fi

read -rp "Nhập key Lazada? (y/N) " a
if [[ $a =~ ^[yY] ]]; then
  ask LAZADA_APP_KEY "App Key"
  ask LAZADA_APP_SECRET "App Secret" secret
fi

read -rp "Nhập key TikTok Shop? (y/N) " a
if [[ $a =~ ^[yY] ]]; then
  ask TIKTOK_APP_KEY "App Key"
  ask TIKTOK_APP_SECRET "App Secret" secret
  ask TIKTOK_SERVICE_ID "Service ID"
fi

echo
echo "Khởi động lại app..."
COMPOSE=(docker compose -f deploy/oracle/docker-compose.yml --env-file .env)
docker info >/dev/null 2>&1 || COMPOSE=(sudo "${COMPOSE[@]}")
"${COMPOSE[@]}" up -d app

echo
echo "Trạng thái:"
for p in "Shopee:SHOPEE_PARTNER_ID:SHOPEE_PARTNER_KEY" "Lazada:LAZADA_APP_KEY:LAZADA_APP_SECRET" "TikTok Shop:TIKTOK_APP_KEY:TIKTOK_APP_SECRET"; do
  IFS=: read -r name k1 k2 <<<"$p"
  if [[ -n "$(get "$k1")" && -n "$(get "$k2")" ]]; then echo "  ✅ $name đã có key"; else echo "  ·  $name chưa có key"; fi
done
echo
echo "Xong. Vào $SITE_URL/app/#/shops → Thêm shop → chọn sàn để ủy quyền."
