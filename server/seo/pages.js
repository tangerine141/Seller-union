'use strict';

// Trang giới thiệu render phía server (HTML tĩnh) để máy tìm kiếm đọc được đầy đủ nội dung.
const config = require('../config');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FEATURES = [
  ['🔗', 'Kết nối đa sàn', 'Shopee, Lazada, TikTok Shop, WooCommerce… gom về một tài khoản duy nhất. Không cần đăng nhập từng sàn.'],
  ['🔄', 'Đồng bộ tự động', 'Đơn hàng, trạng thái giao hàng và tồn kho được cập nhật định kỳ mỗi 15 phút hoặc bấm đồng bộ ngay.'],
  ['📊', 'Thống kê doanh thu', 'Doanh thu theo ngày, theo sàn, theo shop; tỉ lệ hủy/hoàn; sản phẩm bán chạy; cảnh báo sắp hết hàng.'],
  ['🖨️', 'In phiếu hàng loạt', 'In phiếu giao hàng có mã vạch, danh sách lấy hàng gộp theo SKU và bảng kê bàn giao ĐVVC. Hỗ trợ A4, A5, A6 và máy in nhiệt 80mm.'],
  ['📥', 'Xuất Excel/CSV', 'Xuất đơn hàng chi tiết từng sản phẩm, doanh thu theo ngày và tồn kho sang file mở được bằng Excel, Google Sheets.'],
  ['📱', 'Dùng trên điện thoại', 'Giao diện tối ưu cho di động, cài được lên màn hình chính như một ứng dụng (PWA), không cần tải từ App Store.'],
];

const PLATFORMS = {
  shopee: {
    slug: 'shopee',
    name: 'Shopee',
    auth: 'Đăng nhập tài khoản người bán Shopee và bấm “Xác nhận ủy quyền”. Seller Union dùng Shopee Open Platform API chính thức, không lưu mật khẩu của bạn.',
    points: ['Đồng bộ đơn Chờ xác nhận, Chờ lấy hàng, Đang giao, Hoàn thành, Hủy, Trả hàng', 'Lấy tên sản phẩm, phân loại, SKU, số lượng và giá sau giảm', 'Tồn kho sản phẩm đang bán', 'Tự động gia hạn token truy cập'],
  },
  lazada: {
    slug: 'lazada',
    name: 'Lazada',
    auth: 'Đăng nhập Lazada Seller Center và cấp quyền cho ứng dụng qua Lazada Open Platform (OAuth).',
    points: ['Đồng bộ đơn hàng và trạng thái vận chuyển', 'Gộp các dòng sản phẩm trùng SKU thành số lượng', 'Mã vận đơn, đơn vị vận chuyển', 'Tồn kho theo từng SKU'],
  },
  'tiktok-shop': {
    slug: 'tiktok-shop',
    name: 'TikTok Shop',
    auth: 'Ủy quyền qua TikTok Shop Partner Center. Mỗi lần ủy quyền kết nối shop gắn với tài khoản người bán.',
    points: ['Đồng bộ đơn từ livestream và video bán hàng', 'Trạng thái Chờ giao, Đang vận chuyển, Đã giao, Hủy', 'Thông tin người nhận và mã vận đơn', 'Tồn kho theo SKU'],
  },
  woocommerce: {
    slug: 'woocommerce',
    name: 'WooCommerce',
    auth: 'Tạo REST API key (quyền Read) trong WooCommerce → Cài đặt → Nâng cao → REST API, rồi dán vào Seller Union.',
    points: ['Đồng bộ đơn từ website bán hàng riêng', 'Sản phẩm, giá và tồn kho', 'Kết hợp số liệu website với các sàn TMĐT', 'Kết nối qua HTTPS an toàn'],
  },
};

const FAQ = [
  ['Seller Union có miễn phí không?', 'Bạn có thể tự cài đặt mã nguồn lên máy chủ riêng và dùng miễn phí. Bản dùng thử có sẵn shop demo để trải nghiệm không cần tài khoản sàn.'],
  ['Có an toàn khi kết nối shop không?', 'Seller Union dùng API chính thức và cơ chế ủy quyền (OAuth) của từng sàn, không yêu cầu mật khẩu đăng nhập sàn. Token truy cập được mã hóa AES-256 trước khi lưu.'],
  ['Tôi có thể dùng trên điện thoại không?', 'Có. Mở trang web trên điện thoại rồi chọn “Thêm vào màn hình chính” để dùng như một ứng dụng, xem đơn và thống kê mọi lúc.'],
  ['Có in được phiếu giao hàng hàng loạt không?', 'Có. Chọn nhiều đơn rồi bấm In: phiếu giao hàng có mã vạch, danh sách lấy hàng gộp theo SKU, bảng kê bàn giao cho đơn vị vận chuyển.'],
  ['Xuất file báo cáo ra Excel được không?', 'Được. Mọi danh sách đơn hàng, sản phẩm, doanh thu theo ngày đều xuất ra CSV (UTF-8) mở trực tiếp bằng Excel hoặc Google Sheets.'],
  ['Có kết nối được nhiều shop trên cùng một sàn không?', 'Có. Không giới hạn số shop trên mỗi sàn; bạn có thể lọc thống kê theo từng shop hoặc xem tổng hợp.'],
];

function layout({ path, title, description, body, jsonLd = [] }) {
  const url = `${config.siteUrl}${path}`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#4f46e5">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(config.siteUrl)}/assets/og.png">
<meta property="og:locale" content="vi_VN">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
<link rel="stylesheet" href="/assets/site.css">
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="/"><img src="/assets/icon.svg" alt="" width="28" height="28">${esc(config.siteName)}</a>
    <nav aria-label="Chính">
      <a href="/#tinh-nang">Tính năng</a>
      <a href="/#san-ho-tro">Sàn hỗ trợ</a>
      <a href="/#hoi-dap">Hỏi đáp</a>
    </nav>
    <a class="btn btn-primary" href="/app/">Vào ứng dụng</a>
  </div>
</header>
<main>
${body}
</main>
<footer class="footer">
  <div class="wrap footer-inner">
    <div>
      <a class="brand" href="/"><img src="/assets/icon.svg" alt="" width="24" height="24">${esc(config.siteName)}</a>
      <p>Quản lý bán hàng đa sàn: kết nối, thống kê, xuất file và in phiếu tại một nơi.</p>
    </div>
    <div>
      <h3>Kết nối sàn</h3>
      ${Object.values(PLATFORMS).map((p) => `<a href="/ket-noi/${p.slug}">Kết nối ${esc(p.name)}</a>`).join('')}
    </div>
    <div>
      <h3>Ứng dụng</h3>
      <a href="/app/#/register">Đăng ký</a>
      <a href="/app/#/login">Đăng nhập</a>
    </div>
  </div>
  <p class="wrap copy">© ${new Date().getFullYear()} ${esc(config.siteName)}</p>
</footer>
</body>
</html>`;
}

function platformCards() {
  return Object.values(PLATFORMS)
    .map((p) => `<a class="card platform-card" href="/ket-noi/${p.slug}"><span class="plat plat-${p.slug}">${esc(p.name)}</span><span>Xem cách kết nối →</span></a>`)
    .join('');
}

function home() {
  const title = `${config.siteName} – Quản lý bán hàng đa sàn Shopee, Lazada, TikTok Shop tại một nơi`;
  const description =
    'Kết nối tất cả shop Shopee, Lazada, TikTok Shop, WooCommerce về một nơi. Thống kê doanh thu, in phiếu giao hàng hàng loạt, xuất Excel. Dùng trên máy tính và điện thoại.';
  const body = `
<section class="hero">
  <div class="wrap hero-inner">
    <div>
      <p class="eyebrow">Phần mềm quản lý bán hàng đa sàn</p>
      <h1>Mọi shop, mọi sàn — <span class="grad">một màn hình</span></h1>
      <p class="lead">Kết nối Shopee, Lazada, TikTok Shop và website WooCommerce. Xem đơn hàng tập trung, thống kê doanh thu, in phiếu và xuất báo cáo chỉ với vài lần chạm — trên máy tính lẫn điện thoại.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="/app/#/register">Dùng thử miễn phí</a>
        <a class="btn btn-ghost btn-lg" href="#tinh-nang">Xem tính năng</a>
      </div>
      <p class="muted small">Có sẵn shop demo để trải nghiệm ngay, không cần tài khoản sàn.</p>
    </div>
    <div class="mock" aria-hidden="true">
      <div class="mock-bar"><i></i><i></i><i></i></div>
      <div class="mock-kpis">
        <div><small>Doanh thu 30 ngày</small><b>128.450.000đ</b></div>
        <div><small>Đơn hàng</small><b>1.284</b></div>
        <div><small>Chờ xử lý</small><b>37</b></div>
      </div>
      <div class="mock-chart">${Array.from({ length: 14 }, (_, i) => `<span style="height:${30 + ((i * 37) % 60)}%"></span>`).join('')}</div>
      <div class="mock-rows">
        <div><span class="plat plat-shopee">Shopee</span><span>#240915001</span><b>389.000đ</b></div>
        <div><span class="plat plat-tiktok-shop">TikTok</span><span>#578201934</span><b>245.000đ</b></div>
        <div><span class="plat plat-lazada">Lazada</span><span>#310045872</span><b>519.000đ</b></div>
      </div>
    </div>
  </div>
</section>

<section id="tinh-nang" class="section">
  <div class="wrap">
    <h2>Tất cả những gì nhà bán hàng đa sàn cần</h2>
    <div class="grid">
      ${FEATURES.map(([icon, t, d]) => `<article class="card"><div class="icon">${icon}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('')}
    </div>
  </div>
</section>

<section id="san-ho-tro" class="section alt">
  <div class="wrap">
    <h2>Sàn thương mại điện tử được hỗ trợ</h2>
    <p class="lead center">Kết nối qua API chính thức. Có thể mở rộng thêm sàn mới.</p>
    <div class="grid grid-4">${platformCards()}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Bắt đầu trong 3 bước</h2>
    <ol class="steps">
      <li><b>Tạo tài khoản</b><span>Đăng ký bằng email, miễn phí.</span></li>
      <li><b>Kết nối shop</b><span>Chọn sàn và ủy quyền. Dữ liệu 30 ngày gần nhất được đồng bộ ngay.</span></li>
      <li><b>Quản lý tập trung</b><span>Xem thống kê, lọc đơn, in phiếu và xuất báo cáo tại một nơi.</span></li>
    </ol>
  </div>
</section>

<section class="section alt">
  <div class="wrap two-col">
    <div>
      <h2>Cài lên điện thoại như một ứng dụng</h2>
      <p>Mở <b>${esc(config.siteUrl.replace(/^https?:\/\//, ''))}/app</b> trên điện thoại, chọn <b>Chia sẻ → Thêm vào màn hình chính</b> (iPhone) hoặc <b>Cài đặt ứng dụng</b> (Android). Ứng dụng mở toàn màn hình, tải nhanh và vẫn xem được dữ liệu đã tải khi mất mạng.</p>
      <a class="btn btn-primary" href="/app/">Mở ứng dụng</a>
    </div>
    <div class="phone" aria-hidden="true"><div class="phone-screen"><b>Hôm nay</b><span>42 đơn · 11.280.000đ</span><i></i><i></i><i></i></div></div>
  </div>
</section>

<section id="hoi-dap" class="section">
  <div class="wrap narrow">
    <h2>Câu hỏi thường gặp</h2>
    ${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
  </div>
</section>

<section class="section cta-band">
  <div class="wrap center">
    <h2>Gom tất cả shop về một nơi ngay hôm nay</h2>
    <a class="btn btn-light btn-lg" href="/app/#/register">Tạo tài khoản miễn phí</a>
  </div>
</section>`;

  return layout({
    path: '/',
    title,
    description,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: config.siteName,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, Android, iOS',
        url: `${config.siteUrl}/`,
        description,
        inLanguage: 'vi',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'VND' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  });
}

function platformPage(p) {
  const title = `Kết nối ${p.name} – Quản lý đơn hàng ${p.name} cùng các sàn khác | ${config.siteName}`;
  const description = `Hướng dẫn kết nối shop ${p.name} với ${config.siteName}: đồng bộ đơn hàng, tồn kho, thống kê doanh thu, in phiếu giao hàng và xuất Excel cùng Shopee, Lazada, TikTok Shop.`;
  const body = `
<section class="hero small-hero">
  <div class="wrap narrow">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Trang chủ</a> › <span>Kết nối ${esc(p.name)}</span></nav>
    <h1>Kết nối <span class="grad">${esc(p.name)}</span> với ${esc(config.siteName)}</h1>
    <p class="lead">Quản lý đơn hàng ${esc(p.name)} cùng các sàn khác trên một màn hình: thống kê, in phiếu, xuất báo cáo.</p>
    <a class="btn btn-primary btn-lg" href="/app/#/shops">Kết nối ${esc(p.name)} ngay</a>
  </div>
</section>
<section class="section">
  <div class="wrap narrow">
    <h2>Dữ liệu được đồng bộ</h2>
    <ul class="checks">${p.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h2>Cách kết nối</h2>
    <ol class="steps">
      <li><b>Đăng nhập ${esc(config.siteName)}</b><span>Vào mục <i>Shop</i> → <i>Thêm shop</i>.</span></li>
      <li><b>Chọn ${esc(p.name)}</b><span>${esc(p.auth)}</span></li>
      <li><b>Hoàn tất</b><span>Đơn hàng 30 ngày gần nhất được tải về ngay, sau đó tự đồng bộ mỗi 15 phút.</span></li>
    </ol>
    <h2>Sàn khác</h2>
    <div class="grid grid-4">${platformCards()}</div>
  </div>
</section>`;
  return layout({
    path: `/ket-noi/${p.slug}`,
    title,
    description,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: `${config.siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: `Kết nối ${p.name}`, item: `${config.siteUrl}/ket-noi/${p.slug}` },
        ],
      },
    ],
  });
}

function notFound() {
  return layout({
    path: '/404',
    title: `Không tìm thấy trang | ${config.siteName}`,
    description: 'Trang không tồn tại.',
    body: `<section class="section"><div class="wrap narrow center"><h1>404</h1><p>Không tìm thấy trang bạn cần.</p><a class="btn btn-primary" href="/">Về trang chủ</a></div></section>`,
  }).replace('index, follow', 'noindex');
}

function register(app) {
  const html = (fn) => (req, res) => res.type('html').set('cache-control', 'public, max-age=300').send(fn(req));
  app.get('/', html(home));
  app.get('/ket-noi/:slug', (req, res, next) => {
    const p = PLATFORMS[req.params.slug];
    if (!p) return next();
    html(() => platformPage(p))(req, res);
  });
  app.get('/robots.txt', (req, res) =>
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\nDisallow: /connect/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`)
  );
  app.get('/sitemap.xml', (req, res) => {
    const urls = ['/', ...Object.values(PLATFORMS).map((p) => `/ket-noi/${p.slug}`)];
    const today = new Date().toISOString().slice(0, 10);
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${esc(config.siteUrl + u)}</loc><lastmod>${today}</lastmod><priority>${u === '/' ? '1.0' : '0.8'}</priority></url>`)
        .join('\n')}\n</urlset>\n`
    );
  });
}

module.exports = { register, notFound, home, platformPage, PLATFORMS };
