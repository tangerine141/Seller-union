# Deploy Seller Union lên Oracle Cloud Always Free

Kết quả: website chạy 24/7 tại `https://tenmien-cua-ban.vn`, có HTTPS tự động, tự sao lưu dữ liệu mỗi ngày, không tốn phí máy chủ.

Thời gian: khoảng 30–45 phút cho lần đầu.

Cần chuẩn bị:
- Thẻ Visa/Mastercard (Oracle chỉ dùng để xác minh, không trừ tiền nếu bạn dùng tài nguyên "Always Free").
- Một tên miền (mua ở Mắt Bão, PA Việt Nam, Namecheap, Cloudflare…).
- Mã nguồn đã nằm trên GitHub.

---

## Bước 1 — Tạo tài khoản Oracle Cloud

> **Đã có tài khoản Free Trial?** Bỏ qua bước này. Lưu ý: Free Trial gồm 30 ngày dùng credit **và** các tài nguyên "Always Free". Hết 30 ngày, thứ gì không thuộc Always Free sẽ bị dừng/xóa. Vì vậy khi tạo máy ảo, chỉ chọn cấu hình có nhãn **Always Free-eligible** như hướng dẫn ở bước 2 thì máy sẽ chạy mãi sau khi hết trial.

1. Vào https://www.oracle.com/cloud/free/ → **Start for free**.
2. Điền thông tin, xác minh email và thẻ.
3. **Home Region**: chọn **Singapore** (gần Việt Nam, tốc độ tốt). Không đổi được về sau.

## Bước 2 — Tạo máy ảo

1. Menu ☰ → **Compute → Instances → Create instance**.
2. **Name**: `seller-union`.
3. **Image and shape → Edit**:
   - Image: **Canonical Ubuntu 22.04** (hoặc 24.04).
   - Shape: **Ampere → VM.Standard.A1.Flex**, chọn **2 OCPU, 12 GB RAM** (miễn phí đến 4 OCPU / 24 GB).
   - Nếu báo *Out of capacity*: thử lại sau vài giờ, đổi Availability Domain, hoặc tạm dùng **VM.Standard.E2.1.Micro** (cũng miễn phí, yếu hơn nhưng đủ chạy).
4. **Networking**: để mặc định (tạo VCN mới, **Assign a public IPv4 address** = Yes).
5. **Add SSH keys**: chọn **Generate a key pair** → **Save private key** (lưu file `.key` cẩn thận).
6. **Create**. Đợi trạng thái **Running**, ghi lại **Public IP address**.

### Báo "Out of capacity"?

Vùng đang hết máy miễn phí. Dùng script tự thử lại trong **Cloud Shell** (biểu tượng `>_` góc trên bên phải trang Oracle):

```bash
git clone -b claude/multi-platform-shop-connector-hpo1n8 https://github.com/tangerine141/Seller-union.git seller-union
bash seller-union/deploy/oracle/create-vm.sh
```

Nếu chưa có mạng, script tự tạo VCN + subnet public và mở cổng 22/80/443 (khi đó bỏ qua bước 3). Sau đó script thử A1.Flex (1 OCPU/6GB) và E2.1.Micro mỗi 60 giây cho tới khi tạo được, rồi in ra Public IP. SSH key được tạo sẵn trong Cloud Shell nên đăng nhập bằng `ssh ubuntu@<IP>` ngay trong Cloud Shell (không cần file .key). Nâng tài khoản lên **Pay As You Go** thường giúp tạo được máy A1 dễ hơn.

## Bước 3 — Mở cổng 80 và 443 trên Oracle

1. Trong trang instance → mục **Primary VNIC** → bấm vào **Subnet**.
2. **Security Lists** → **Default Security List** → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `80,443` → **Add**.

(Tường lửa bên trong máy ảo sẽ được script tự mở ở bước 6.)

## Bước 4 — Trỏ tên miền về máy chủ

> **Chưa có tên miền?** Bỏ qua bước này. Ở bước 6, khi được hỏi tên miền thì cứ nhấn Enter: app sẽ chạy tạm tại `http://<PUBLIC_IP>` (chưa có HTTPS). Khi mua tên miền, xem mục **Gắn tên miền sau** ở cuối trang.

Tại nơi quản lý DNS của tên miền, tạo bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `@` | Public IP ở bước 2 |

Nếu dùng Cloudflare: để **DNS only** (đám mây xám) trong lần cài đầu để lấy chứng chỉ HTTPS; sau đó mới bật proxy nếu muốn (SSL mode chọn **Full (strict)**).

Kiểm tra: `ping tenmien-cua-ban.vn` ra đúng IP (có thể mất 5–30 phút).

## Bước 5 — Đăng nhập vào máy chủ

macOS / Linux:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC_IP>
```

Windows: dùng PowerShell với lệnh `ssh` như trên, hoặc MobaXterm/PuTTY (user: `ubuntu`).

## Bước 6 — Cài đặt

```bash
git clone -b claude/multi-platform-shop-connector-hpo1n8 https://github.com/tangerine141/Seller-union.git seller-union
cd seller-union
bash deploy/oracle/setup.sh
```

- Code hiện nằm ở nhánh `claude/multi-platform-shop-connector-hpo1n8`. Sau khi bạn merge vào nhánh chính thì bỏ phần `-b ...`.
- Repo riêng tư (private): GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained**, tạo token quyền **Contents: Read-only** cho repo này; khi `git clone` hỏi mật khẩu thì dán token.
- Script sẽ hỏi **tên miền** (vd `seller-union.vn`), rồi tự động: cài Docker, mở tường lửa, tạo `.env` với khóa bí mật ngẫu nhiên, build và chạy app + Caddy (HTTPS), đặt lịch sao lưu 3h sáng mỗi ngày.

Xong! Mở:
- `https://tenmien-cua-ban.vn` — trang chủ
- `https://tenmien-cua-ban.vn/app/` — ứng dụng (đăng ký tài khoản đầu tiên)

## Bước 7 — Kết nối shop

Mỗi shop (kể cả shop của bạn) kết nối bằng **key app người bán của chính mình**, ngay trong ứng dụng, không cần sửa máy chủ:

1. Làm theo `https://tenmien-cua-ban.vn/huong-dan-ket-noi` để tạo app người bán miễn phí trên Shopee / Lazada / TikTok Shop và lấy key.
2. Vào `https://tenmien-cua-ban.vn/app/` → **Shop → Thêm shop → chọn sàn → dán key → Lưu key & kết nối** → đăng nhập sàn và bấm đồng ý.

Gửi link `/huong-dan-ket-noi` cho các shop khác để họ tự làm.

> Tùy chọn: khi đã có đăng ký kinh doanh và được sàn duyệt **app dành cho bên thứ ba**, chạy `bash deploy/oracle/set-keys.sh` để đặt key chung cho cả hệ thống.

## Bước 8 — SEO

1. Vào https://search.google.com/search-console → thêm tên miền → xác minh (bản ghi TXT DNS).
2. **Sitemaps** → nhập `sitemap.xml` → Submit.

---

## Tự động cập nhật code (khuyên dùng)

Bật một lần, sau đó mỗi khi có code mới trên GitHub, máy tự sao lưu → tải code → build → khởi động lại (kiểm tra mỗi 10 phút):

```bash
cd ~/seller-union
git pull
bash deploy/oracle/enable-auto-update.sh
```

- Repo riêng tư: script hỏi tên GitHub và token (quyền Contents: Read-only) một lần rồi lưu lại.
- Lệnh này cũng bật lại lịch sao lưu 3h sáng.
- Xem nhật ký: `tail -f ~/seller-union/backups/auto-update.log` · Tắt: `bash deploy/oracle/enable-auto-update.sh --off`

## Vận hành hằng ngày

Tất cả lệnh chạy trong thư mục `~/seller-union`:

| Việc | Lệnh |
|---|---|
| Cập nhật code mới (tự sao lưu trước) | `bash deploy/oracle/update.sh` |
| Xem log | `docker compose -f deploy/oracle/docker-compose.yml --env-file .env logs -f app` |
| Khởi động lại | `docker compose -f deploy/oracle/docker-compose.yml --env-file .env restart` |
| Sao lưu ngay | `bash deploy/oracle/backup.sh` |
| Tải bản sao lưu về máy | (chạy trên máy bạn) `scp -i <key> ubuntu@<IP>:~/seller-union/backups/*.gz .` |

Bản sao lưu nằm trong `~/seller-union/backups/` (giữ 14 bản gần nhất). Nên tải về máy hoặc Google Drive định kỳ, vì nếu máy ảo bị xóa thì bản sao lưu trên đó cũng mất.

### Khôi phục từ bản sao lưu

```bash
cd ~/seller-union
C="docker compose -f deploy/oracle/docker-compose.yml --env-file .env"
gunzip -k backups/seller-union-YYYYMMDD-HHMMSS.db.gz
$C stop app
$C run --rm --no-deps -v "$PWD/backups:/b:ro" --entrypoint sh app -c \
  'rm -f /app/data/seller-union.db-wal /app/data/seller-union.db-shm && cp /b/seller-union-YYYYMMDD-HHMMSS.db /app/data/seller-union.db'
$C start app
```

## Gắn tên miền sau

Khi đã chạy tạm bằng IP và giờ có tên miền (ví dụ `banhang-dakenh.com`):

1. Tại trang quản lý DNS của tên miền, tạo 2 bản ghi:

   | Loại | Tên | Giá trị |
   |---|---|---|
   | A | `@` | Public IP của máy chủ |
   | CNAME | `www` | `banhang-dakenh.com` |

2. Trên máy chủ:

   ```bash
   cd ~/seller-union
   git pull
   bash deploy/oracle/set-domain.sh banhang-dakenh.com
   ```

   Script kiểm tra DNS đã trỏ đúng chưa, cập nhật `.env`, khởi động lại và chờ Caddy lấy chứng chỉ HTTPS. `www.` tự chuyển về tên miền chính. Dữ liệu giữ nguyên; cần đăng nhập lại một lần.

## Gặp lỗi?

| Hiện tượng | Cách xử lý |
|---|---|
| Trình duyệt không vào được (timeout) | Kiểm tra bước 3 (Security List có cổng 80, 443) và DNS trỏ đúng IP. |
| Báo lỗi chứng chỉ / không có HTTPS | DNS chưa trỏ đúng lúc khởi động. Đợi DNS cập nhật rồi chạy `docker compose ... restart caddy`. Xem `docker compose ... logs caddy`. |
| `permission denied ... docker.sock` | Thoát SSH rồi đăng nhập lại (để nhận quyền nhóm docker), hoặc thêm `sudo` trước lệnh. |
| Oracle gửi mail "idle instance" | Oracle có thể thu hồi máy Always Free nếu dùng quá ít CPU trong 7 ngày. Nâng tài khoản lên **Pay As You Go** (vẫn không mất tiền nếu chỉ dùng tài nguyên Always Free) để tránh bị thu hồi. |
