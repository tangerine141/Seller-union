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

INGRESS_PORTS=(22 80 443)

# Mở cổng 22/80/443 trong security list (giữ nguyên các rule sẵn có).
open_ports() { # security-list-id
  local sl=$1 rules
  rules=$(oci network security-list get --security-list-id "$sl" --query 'data."ingress-security-rules"')
  for port in "${INGRESS_PORTS[@]}"; do
    # Rule TCP không giới hạn cổng (tcp-options rỗng) cũng tính là đã mở.
    if ! jq -e --argjson p "$port" 'any(.[]; .protocol=="6" and .source=="0.0.0.0/0"
        and ((."tcp-options" // .tcpOptions // {}) | (."destination-port-range" // .destinationPortRange // {min:0,max:65535})
             | .min <= $p and .max >= $p))' <<<"$rules" >/dev/null; then
      rules=$(jq --argjson p "$port" '. + [{"source":"0.0.0.0/0","protocol":"6","isStateless":false,
        "tcpOptions":{"destinationPortRange":{"min":$p,"max":$p}}}]' <<<"$rules")
    fi
  done
  # CLI trả về khóa dạng kebab-case, còn khi cập nhật cần camelCase.
  rules=$(jq '[.[] | {source, protocol, isStateless:(."is-stateless" // .isStateless // false), sourceType:(."source-type" // .sourceType // "CIDR_BLOCK"),
    tcpOptions:(."tcp-options" // .tcpOptions | if . then {destinationPortRange:(."destination-port-range" // .destinationPortRange | if . then {min, max} else null end)} else null end),
    icmpOptions:(."icmp-options" // .icmpOptions)} | with_entries(select(.value != null))]' <<<"$rules")
  oci network security-list update --security-list-id "$sl" --ingress-security-rules "$rules" --force >/dev/null
}

# Tìm subnet public ở mọi compartment.
find_public_subnet() {
  local c
  for c in "$COMPARTMENT" $(oci iam compartment list --compartment-id "$COMPARTMENT" --compartment-id-in-subtree true --all \
      --query 'data[?"lifecycle-state"==`ACTIVE`].id' --raw-output 2>/dev/null | jq -r '.[]?'); do
    local id
    id=$(oci network subnet list --compartment-id "$c" --all \
      --query 'data[?"prohibit-public-ip-on-vnic"==`false` && "lifecycle-state"==`AVAILABLE`].id | [0]' --raw-output 2>/dev/null)
    if [[ -n "$id" && "$id" != "null" ]]; then echo "$id"; return; fi
  done
}

create_network() {
  echo "Chưa có mạng public — đang tạo VCN, Internet Gateway và subnet public..." >&2
  local vcn igw rt sl
  vcn=$(oci network vcn create --compartment-id "$COMPARTMENT" --cidr-blocks '["10.0.0.0/16"]' \
    --display-name seller-union-vcn --dns-label sellerunion --wait-for-state AVAILABLE)
  rt=$(jq -r '.data."default-route-table-id"' <<<"$vcn")
  sl=$(jq -r '.data."default-security-list-id"' <<<"$vcn")
  vcn=$(jq -r '.data.id' <<<"$vcn")
  igw=$(oci network internet-gateway create --compartment-id "$COMPARTMENT" --vcn-id "$vcn" --is-enabled true \
    --display-name seller-union-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)
  oci network route-table update --rt-id "$rt" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$igw\"}]" >/dev/null
  oci network subnet create --compartment-id "$COMPARTMENT" --vcn-id "$vcn" --cidr-block 10.0.0.0/24 \
    --display-name seller-union-public --dns-label public --prohibit-public-ip-on-vnic false \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output
}

SUBNET=$(find_public_subnet)
[[ -n "$SUBNET" ]] || SUBNET=$(create_network)
if [[ -z "$SUBNET" || "$SUBNET" == "null" ]]; then
  echo "Không tạo được subnet public."
  exit 1
fi
echo "Dùng subnet: $SUBNET"
for sl in $(oci network subnet get --subnet-id "$SUBNET" --query 'data."security-list-ids"' --raw-output | jq -r '.[]'); do
  open_ports "$sl" && echo "Đã mở cổng ${INGRESS_PORTS[*]} (security list $sl)"
done

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
