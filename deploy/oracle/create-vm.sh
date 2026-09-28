#!/usr/bin/env bash
# Tự động thử tạo máy ảo Always Free cho tới khi Oracle còn chỗ ("Out of capacity").
# Chạy trong Oracle Cloud Shell (biểu tượng >_ góc trên bên phải trang Oracle):
#   bash create-vm.sh
# Thử lần lượt A1.Flex (1 OCPU / 6GB) và E2.1.Micro ở mọi Availability Domain, lặp lại mỗi 60 giây.
set -uo pipefail
LAST_ERROR=

NAME=seller-union
WAIT=60
COMPARTMENT=${OCI_TENANCY:-}
if [[ -z "$COMPARTMENT" ]]; then
  echo "Không tìm thấy OCI_TENANCY. Hãy chạy script này trong Oracle Cloud Shell."
  exit 1
fi

# SSH key: tạo trong Cloud Shell để SSH thẳng từ Cloud Shell vào máy ảo.
if [[ ! -f ~/.ssh/id_rsa.pub ]]; then
  mkdir -p ~/.ssh && ssh-keygen -t rsa -b 4096 -N '' -f ~/.ssh/id_rsa -q
fi

existing=$(oci compute instance list --compartment-id "$COMPARTMENT" --display-name "$NAME" \
  --lifecycle-state RUNNING --query 'data[0].id' --raw-output 2>/dev/null)
if [[ -n "$existing" && "$existing" != "null" ]]; then
  echo "Đã có máy '$NAME' đang chạy. Không tạo thêm."
  exit 0
fi

# Subnet public đầu tiên (cho phép gắn IP công khai).
SUBNET=$(oci network subnet list --compartment-id "$COMPARTMENT" --all \
  --query 'data[?"prohibit-public-ip-on-vnic"==`false`].id | [0]' --raw-output)
if [[ -z "$SUBNET" || "$SUBNET" == "null" ]]; then
  echo "Chưa có subnet public. Tạo VCN: Networking → Virtual cloud networks → Start VCN Wizard → Create VCN with Internet Connectivity, rồi chạy lại."
  exit 1
fi

mapfile -t ADS < <(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[].name' --raw-output | jq -r '.[]')

image_for() {
  oci compute image list --compartment-id "$COMPARTMENT" --operating-system "Canonical Ubuntu" \
    --operating-system-version "22.04" --shape "$1" --sort-by TIMECREATED --sort-order DESC \
    --limit 1 --query 'data[0].id' --raw-output
}
IMG_A1=$(image_for VM.Standard.A1.Flex)
IMG_MICRO=$(image_for VM.Standard.E2.1.Micro)

try_launch() { # shape image [shape-config]
  local shape=$1 image=$2 cfg=${3:-} out
  local args=(--compartment-id "$COMPARTMENT" --availability-domain "$AD" --shape "$shape"
    --image-id "$image" --subnet-id "$SUBNET" --assign-public-ip true --display-name "$NAME"
    --ssh-authorized-keys-file ~/.ssh/id_rsa.pub --wait-for-state RUNNING --max-wait-seconds 600)
  [[ -n "$cfg" ]] && args+=(--shape-config "$cfg")
  if out=$(oci compute instance launch "${args[@]}" 2>&1); then
    local id ip
    id=$(echo "$out" | jq -r '.data.id')
    ip=$(oci compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output)
    echo
    echo "✅ Đã tạo máy $shape tại $AD"
    echo "   Public IP: $ip"
    echo "   Đăng nhập ngay từ Cloud Shell:  ssh ubuntu@$ip"
    exit 0
  fi
  if grep -qiE 'capacity|TooManyRequests' <<<"$out"; then
    return 1
  fi
  LAST_ERROR=$out
  return 2
}

echo "Bắt đầu thử tạo máy. Để tab Cloud Shell mở; nhấn Ctrl+C để dừng."
attempt=0
while true; do
  attempt=$((attempt + 1))
  busy=0
  for AD in "${ADS[@]}"; do
    if [[ -n "$IMG_A1" && "$IMG_A1" != "null" ]]; then
      try_launch VM.Standard.A1.Flex "$IMG_A1" '{"ocpus":1,"memoryInGBs":6}'; [[ $? -eq 1 ]] && busy=1
    fi
    if [[ -n "$IMG_MICRO" && "$IMG_MICRO" != "null" ]]; then
      try_launch VM.Standard.E2.1.Micro "$IMG_MICRO"; [[ $? -eq 1 ]] && busy=1
    fi
  done
  # Không lần nào báo "hết chỗ" mà toàn lỗi khác -> thử lại cũng vô ích.
  if (( busy == 0 )); then
    echo "Tạo máy thất bại vì lỗi khác (không phải hết chỗ):"
    echo "${LAST_ERROR:-không rõ}"
    exit 1
  fi
  echo "$(date '+%H:%M:%S') Lần $attempt: vẫn hết chỗ, thử lại sau ${WAIT}s..."
  sleep "$WAIT"
done
