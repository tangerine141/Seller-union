# Seller Union

Phần mềm web quản lý bán hàng đa sàn: **kết nối các shop trên Shopee, Lazada, TikTok Shop, WooCommerce**, rồi **thống kê, xuất file và in phiếu** tại một nơi. Dùng được trên máy tính và điện thoại (cài lên màn hình chính như app — PWA).

Gồm 2 phần chạy chung trên một máy chủ:

| Đường dẫn | Nội dung |
|---|---|
| `/` , `/ket-noi/shopee`, `/ket-noi/lazada`, `/ket-noi/tiktok-shop`, `/ket-noi/woocommerce` | Trang giới thiệu chuẩn SEO (render sẵn HTML, meta/OG, JSON-LD, `sitemap.xml`, `robots.txt`) |
| `/app/` | Ứng dụng quản lý (đăng nhập, tổng quan, đơn hàng, sản phẩm, shop) — responsive, PWA |

## Tính năng

- **Kết nối shop**
  - Shopee, Lazada, TikTok Shop: mỗi shop dán **key app người bán của chính mình** (tạo miễn phí trên sàn), rồi đồng ý ủy quyền trên trang của sàn. Không cần mật khẩu sàn, tự gia hạn token.
  - WooCommerce: dán REST API key (bắt buộc HTTPS).
  - **Shop demo**: sinh dữ liệu mẫu 30 ngày để dùng thử ngay.
  - Không giới hạn số shop mỗi sàn. Token/API key được mã hóa AES‑256‑GCM trong DB.
- **Đồng bộ**: tự động mỗi 15 phút (cấu hình được) hoặc bấm “Đồng bộ”. Trạng thái đơn của mọi sàn được chuẩn hóa về: Chờ xác nhận, Chờ lấy hàng, Đang giao, Hoàn thành, Đã hủy, Trả hàng/Hoàn.
- **Thống kê**: doanh thu (không tính đơn hủy/hoàn), số đơn, giá trị TB/đơn, tỉ lệ hủy/hoàn, đơn cần xử lý; biểu đồ doanh thu theo ngày; doanh thu theo shop và theo sàn; sản phẩm bán chạy; cảnh báo sắp hết hàng. Lọc theo khoảng thời gian và shop.
- **Đơn hàng**: danh sách gộp mọi sàn, tìm theo mã đơn/khách/SĐT/sản phẩm/SKU/mã vận đơn, lọc theo trạng thái (có số đếm), shop, thời gian; chọn nhiều đơn.
- **In** (chọn khổ A4 / A5 / A6 tem 10×15 / máy in nhiệt 80mm):
  - Phiếu giao hàng có **mã vạch Code 128** (mã đơn + mã vận đơn).
  - Danh sách lấy hàng gộp theo SKU (có ô tick).
  - Bảng kê bàn giao theo đơn vị vận chuyển, có chỗ ký.
- **Xuất CSV** (UTF‑8 có BOM, mở thẳng bằng Excel/Google Sheets): đơn hàng chi tiết từng sản phẩm, doanh thu theo ngày, sản phẩm & tồn kho.

## Chạy thử trên máy tính của bạn

1. Cài **Node.js bản LTS** (22.5 trở lên) tại https://nodejs.org. Cứ bấm Next đến hết.
2. Tải mã nguồn: trên GitHub chọn nhánh `claude/multi-platform-shop-connector-hpo1n8` → **Code → Download ZIP**, rồi giải nén.
   (Hoặc dùng git: `git clone -b claude/multi-platform-shop-connector-hpo1n8 https://github.com/tangerine141/Seller-union.git`)
3. Mở thư mục vừa giải nén và bấm đúp:
   - **Windows:** `start-windows.bat`
   - **macOS:** `start-mac.command` (lần đầu nếu bị chặn: chuột phải → **Open** → **Open**)

   Lần đầu sẽ mất 1–2 phút để cài đặt. Sau đó trình duyệt tự mở `http://localhost:3000/app/`.
4. Đăng ký tài khoản (chỉ lưu trên máy bạn) → **Shop → Tạo shop demo** để xem với dữ liệu mẫu.
5. Trang chủ giới thiệu: `http://localhost:3000`. Tắt phần mềm: đóng cửa sổ đen (hoặc nhấn Ctrl+C).

Dữ liệu nằm trong thư mục `data/`. Xóa thư mục này để làm lại từ đầu.

**Xem trên điện thoại** (cùng Wi‑Fi với máy tính): mở `http://<IP-máy-tính>:3000/app/` trên điện thoại. IP xem bằng lệnh `ipconfig` (Windows, dòng IPv4) hoặc *Cài đặt hệ thống → Wi‑Fi → Chi tiết* (macOS). Nếu Windows hỏi tường lửa, chọn **Allow**. Nút "Thêm vào màn hình chính" dạng app chỉ hoạt động khi đã đưa lên mạng có HTTPS.

Dành cho lập trình viên:

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # tự khởi động lại khi sửa code
npm test
```

## Đưa lên mạng (homepage)

**Miễn phí trên Oracle Cloud Always Free:** xem hướng dẫn từng bước và script cài đặt một lệnh tại [`deploy/oracle/README.md`](deploy/oracle/README.md).

Hoặc tự cài trên máy chủ bất kỳ:


1. Thuê VPS / dịch vụ chạy Node (hoặc Docker), trỏ tên miền về máy chủ, bật HTTPS (Nginx/Caddy/Cloudflare).
2. Sao chép `.env.example` → `.env`, điền `APP_SECRET` (chuỗi ngẫu nhiên) và `SITE_URL` là tên miền thật.
3. Chạy:

   ```bash
   # Cách 1: Node trực tiếp
   set -a; source .env; set +a; npm start

   # Cách 2: Docker
   docker build -t seller-union .
   docker run -d --env-file .env -p 3000:3000 -v seller-union-data:/app/data seller-union
   ```

4. Khai báo `https://<tên-miền>/sitemap.xml` trong Google Search Console.
5. Trên điện thoại: mở `https://<tên-miền>/app/` → **Thêm vào màn hình chính** (iPhone: nút Chia sẻ; Android: menu ⋮ → Cài đặt ứng dụng).

Dữ liệu nằm trong file SQLite `data/seller-union.db` — nhớ sao lưu định kỳ.

## Kết nối shop trên sàn

**Cách chính – mỗi shop dùng key riêng (không cần đăng ký kinh doanh):**

1. Chủ shop tạo app người bán miễn phí trên sàn bằng tài khoản của mình, khai báo Redirect URL `{SITE_URL}/connect/<sàn>/callback`:

   | Sàn | Nơi tạo app | Loại app | Key cần lấy |
   |---|---|---|---|
   | Shopee | open.shopee.com | Tài khoản **Shopee Seller** | Partner ID, Partner Key |
   | Lazada | open.lazada.com | **Seller In‑house APP** | App Key, App Secret |
   | TikTok Shop | partner.tiktokshop.com | **Custom App** | App Key, App Secret, Service ID |
   | WooCommerce | WordPress → WooCommerce → Cài đặt → Nâng cao → REST API | Key quyền Read | Consumer key/secret |

2. Trong app: **Shop → Thêm shop → chọn sàn → dán key → Lưu key & kết nối**, rồi đăng nhập sàn và bấm đồng ý.

Key được mã hóa AES‑256, chỉ dùng cho shop của người đó. Hướng dẫn từng bước để gửi cho chủ shop: **`/huong-dan-ket-noi`**.

**Tùy chọn – app chung của hệ thống:** khi đã có đăng ký kinh doanh và được sàn duyệt app dành cho bên thứ ba (Shopee Third‑party Partner, Lazada ISV, TikTok Public App), điền key vào `.env` (`SHOPEE_PARTNER_ID/KEY`, `LAZADA_APP_KEY/SECRET`, `TIKTOK_APP_KEY/SECRET/SERVICE_ID`, hoặc chạy `deploy/oracle/set-keys.sh`). Khi đó form Thêm shop có thêm nút "Kết nối bằng app chung".

> Lưu ý: phần gọi API sàn được viết theo tài liệu công khai (Shopee v2, Lazada Open Platform, TikTok Shop API 202309) và đã có test cho thuật toán ký và ánh xạ dữ liệu, nhưng chưa chạy với tài khoản sàn thật. Khi có key, nên thử trên môi trường sandbox của từng sàn trước.

## Cấu trúc mã nguồn

```
server/
  index.js            khởi động + đồng bộ tự động
  app.js              API (tài khoản, shop, đơn, thống kê, xuất CSV, OAuth)
  db.js               SQLite schema
  crypto.js           băm mật khẩu (scrypt), mã hóa token, ký state OAuth
  connectors/         mỗi sàn một file: shopee, lazada, tiktok, woocommerce, demo
  services/           sync (đồng bộ), stats (thống kê/truy vấn), csv
  seo/pages.js        trang giới thiệu + sitemap/robots
public/
  assets/             CSS trang chủ, icon, ảnh OG
  app/                ứng dụng (app.js, app.css, print.html/print.js, barcode.js, sw.js, manifest)
test/                 node:test
```

### Thêm sàn mới (Tiki, Sendo, Haravan, Sapo…)

Tạo `server/connectors/<san>.js` với cùng giao diện (`id`, `name`, `authType`, `isConfigured()`, `getAuthUrl`/`handleCallback` cho OAuth hoặc `connect` cho API key, `fetchOrders(ctx, { since })`, `fetchProducts(ctx)`), trả đơn theo định dạng chuẩn rồi đăng ký trong `server/connectors/index.js`.
