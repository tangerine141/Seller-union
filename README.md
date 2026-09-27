# Seller Union

Phần mềm web quản lý bán hàng đa sàn: **kết nối các shop trên Shopee, Lazada, TikTok Shop, WooCommerce**, rồi **thống kê, xuất file và in phiếu** tại một nơi. Dùng được trên máy tính và điện thoại (cài lên màn hình chính như app — PWA).

Gồm 2 phần chạy chung trên một máy chủ:

| Đường dẫn | Nội dung |
|---|---|
| `/` , `/ket-noi/shopee`, `/ket-noi/lazada`, `/ket-noi/tiktok-shop`, `/ket-noi/woocommerce` | Trang giới thiệu chuẩn SEO (render sẵn HTML, meta/OG, JSON-LD, `sitemap.xml`, `robots.txt`) |
| `/app/` | Ứng dụng quản lý (đăng nhập, tổng quan, đơn hàng, sản phẩm, shop) — responsive, PWA |

## Tính năng

- **Kết nối shop**
  - Shopee, Lazada, TikTok Shop: ủy quyền OAuth qua API chính thức (không lưu mật khẩu sàn), tự gia hạn token.
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

## Chạy thử

Yêu cầu **Node.js ≥ 22.5** (dùng SQLite có sẵn trong Node, không cần cài database).

```bash
npm install
npm start            # http://localhost:3000
npm test             # chạy test
```

Mở `http://localhost:3000/app/`, đăng ký tài khoản, vào **Shop → Tạo shop demo** để xem thử với dữ liệu mẫu.

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

## Kết nối API các sàn thật

Mỗi sàn yêu cầu đăng ký tài khoản nhà phát triển và được duyệt app trước khi kết nối shop thật. Sau khi có key, điền vào `.env` và khai báo Redirect/Callback URL:

| Sàn | Nơi đăng ký | Biến môi trường | Redirect URL |
|---|---|---|---|
| Shopee | open.shopee.com | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | `{SITE_URL}/connect/shopee/callback` |
| Lazada | open.lazada.com | `LAZADA_APP_KEY`, `LAZADA_APP_SECRET` | `{SITE_URL}/connect/lazada/callback` |
| TikTok Shop | partner.tiktokshop.com | `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` | `{SITE_URL}/connect/tiktok/callback` |
| WooCommerce | WooCommerce → Cài đặt → Nâng cao → REST API (quyền Read) | — (nhập trong app) | — |

Khi chưa cấu hình key, nút kết nối sàn đó sẽ báo “chưa cấu hình trên máy chủ”; shop demo và WooCommerce vẫn dùng được.

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
