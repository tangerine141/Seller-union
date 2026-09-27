'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const connectors = require('./connectors');
const { hashPassword, verifyPassword, encryptJson, signToken, verifyToken } = require('./crypto');
const { syncShop, syncAll } = require('./services/sync');
const { listOrders, getStats } = require('./services/stats');
const { toCsv } = require('./services/csv');
const seo = require('./seo/pages');

const SESSION_DAYS = 30;
const STATUS_LABELS = {
  pending: 'Chờ xác nhận',
  to_ship: 'Chờ lấy hàng',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  returned: 'Trả hàng/Hoàn',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms + config.tzOffsetMinutes * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

// Giới hạn số lần thử đăng nhập theo IP.
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return next(new HttpError(429, 'Thử quá nhiều lần, vui lòng đợi ít phút.'));
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'SAMEORIGIN',
    });
    next();
  });

  // ---------- Phiên đăng nhập ----------
  function createSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + SESSION_DAYS * 86400000;
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, expires: new Date(expires), path: '/' });
  }

  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      const row = db
        .prepare('SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
        .get(sha256(token));
      if (row && row.expires_at > Date.now()) req.user = { id: row.id, email: row.email, name: row.name };
    }
    next();
  });

  function requireAuth(req, res, next) {
    if (!req.user) return next(new HttpError(401, 'Vui lòng đăng nhập'));
    next();
  }

  function ownShop(req) {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!shop) throw new HttpError(404, 'Không tìm thấy shop');
    return shop;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------- Tài khoản ----------
  const loginLimit = rateLimiter(20, 15 * 60 * 1000);

  app.post('/api/auth/register', loginLimit, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 100);
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
    if (password.length < 8) throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email đã được đăng ký');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, name || email.split('@')[0], hashPassword(password), Date.now());
    createSession(res, Number(lastInsertRowid));
    res.status(201).json({ ok: true });
  });

  app.post('/api/auth/login', loginLimit, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
      throw new HttpError(401, 'Sai email hoặc mật khẩu');
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(user.id, Date.now());
    createSession(res, user.id);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------- Sàn & shop ----------
  app.get('/api/platforms', (req, res) => res.json({ platforms: connectors.list(), statuses: STATUS_LABELS }));

  app.get('/api/shops', requireAuth, (req, res) => {
    const shops = db
      .prepare(`SELECT s.id, s.platform, s.name, s.status, s.last_sync_at, s.last_sync_error, s.created_at,
          (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.id) AS order_count,
          (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id) AS product_count
        FROM shops s WHERE s.user_id = ? ORDER BY s.created_at`)
      .all(req.user.id);
    res.json({ shops });
  });

  function saveShop(userId, platform, { externalId, name, credentials }) {
    const enc = encryptJson(config.appSecret, credentials);
    const existing = db.prepare('SELECT id FROM shops WHERE user_id = ? AND platform = ? AND external_id = ?').get(userId, platform, externalId);
    if (existing) {
      db.prepare("UPDATE shops SET credentials = ?, name = ?, status = 'active', last_sync_error = NULL WHERE id = ?").run(enc, name, existing.id);
      return existing.id;
    }
    return Number(
      db
        .prepare('INSERT INTO shops (user_id, platform, name, external_id, credentials, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, platform, name, externalId, enc, Date.now()).lastInsertRowid
    );
  }

  function syncInBackground(shopId) {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
    syncShop(db, shop).catch((err) => console.error(`[sync] shop ${shopId}:`, err.message));
  }

  // Kết nối bằng API key (WooCommerce, shop demo).
  app.post('/api/shops', requireAuth, wrap(async (req, res) => {
    const connector = connectors.get(req.body.platform);
    if (!connector || connector.authType !== 'apikey') throw new HttpError(400, 'Sàn không hỗ trợ kết nối bằng API key');
    let result;
    try {
      result = await connector.connect(req.body);
    } catch (err) {
      throw new HttpError(400, `Không kết nối được: ${err.message}`);
    }
    const id = saveShop(req.user.id, connector.id, result);
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(id);
    // Chờ đồng bộ lần đầu để người dùng thấy dữ liệu ngay.
    try {
      await syncShop(db, shop);
    } catch {
      // Lỗi đã được lưu vào shop.last_sync_error.
    }
    res.status(201).json({ id });
  }));

  app.patch('/api/shops/:id', requireAuth, (req, res) => {
    const shop = ownShop(req);
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Tên shop không được để trống');
    db.prepare('UPDATE shops SET name = ? WHERE id = ?').run(name, shop.id);
    res.json({ ok: true });
  });

  app.delete('/api/shops/:id', requireAuth, (req, res) => {
    const shop = ownShop(req);
    db.prepare('DELETE FROM shops WHERE id = ?').run(shop.id);
    res.json({ ok: true });
  });

  app.post('/api/shops/:id/sync', requireAuth, wrap(async (req, res) => {
    const shop = ownShop(req);
    try {
      res.json({ ok: true, ...(await syncShop(db, shop)) });
    } catch (err) {
      throw new HttpError(502, `Đồng bộ thất bại: ${err.message}`);
    }
  }));

  app.post('/api/sync', requireAuth, wrap(async (req, res) => {
    res.json({ results: await syncAll(db, req.user.id) });
  }));

  // OAuth: Shopee, Lazada, TikTok Shop.
  const callbackUrl = (platform) => `${config.siteUrl}/connect/${platform}/callback`;

  app.get('/api/connect/:platform/authorize', requireAuth, (req, res) => {
    const connector = connectors.get(req.params.platform);
    if (!connector || connector.authType !== 'oauth') throw new HttpError(404, 'Sàn không hỗ trợ');
    if (!connector.isConfigured()) {
      throw new HttpError(400, `Máy chủ chưa cấu hình App key của ${connector.name}. Xem hướng dẫn trong README.`);
    }
    const state = signToken(config.appSecret, { uid: req.user.id, p: connector.id }, 15 * 60);
    res.json({ url: connector.getAuthUrl({ redirectUri: callbackUrl(connector.id), state }) });
  });

  app.get('/connect/:platform/callback', wrap(async (req, res) => {
    const connector = connectors.get(req.params.platform);
    const state = verifyToken(config.appSecret, req.query.state);
    const fail = (msg) => res.redirect(`/app/#/shops?error=${encodeURIComponent(msg)}`);
    if (!connector || connector.authType !== 'oauth') return fail('Sàn không hỗ trợ');
    if (!state || state.p !== connector.id) return fail('Phiên kết nối hết hạn, vui lòng thử lại');
    try {
      const result = await connector.handleCallback({ query: req.query, redirectUri: callbackUrl(connector.id) });
      const id = saveShop(state.uid, connector.id, result);
      syncInBackground(id);
      res.redirect(`/app/#/shops?connected=${encodeURIComponent(result.name)}`);
    } catch (err) {
      fail(`Kết nối ${connector.name} thất bại: ${err.message}`);
    }
  }));

  // ---------- Đơn hàng ----------
  app.get('/api/orders', requireAuth, (req, res) => res.json(listOrders(db, req.user.id, req.query)));

  const PLATFORM_NAMES = Object.fromEntries(connectors.list().map((c) => [c.id, c.name]));

  app.get('/api/orders/export.csv', requireAuth, (req, res) => {
    const { orders } = listOrders(db, req.user.id, { ...req.query, limit: 5000, offset: 0 });
    // Mỗi dòng là một sản phẩm trong đơn để dễ lọc/pivot trên Excel.
    const rows = orders.flatMap((o) => (o.items.length ? o.items : [{}]).map((it, i) => ({ o, it, first: i === 0 })));
    const csv = toCsv(
      [
        { label: 'Mã đơn', value: (r) => r.o.external_id },
        { label: 'Sàn', value: (r) => PLATFORM_NAMES[r.o.platform] || r.o.platform },
        { label: 'Shop', value: (r) => r.o.shop_name },
        { label: 'Ngày đặt', value: (r) => fmtDate(r.o.created_at) },
        { label: 'Trạng thái', value: (r) => STATUS_LABELS[r.o.status] || r.o.status },
        { label: 'Khách hàng', value: (r) => r.o.customer_name },
        { label: 'SĐT', value: (r) => r.o.customer_phone },
        { label: 'Địa chỉ', value: (r) => r.o.shipping_address },
        { label: 'ĐVVC', value: (r) => r.o.carrier },
        { label: 'Mã vận đơn', value: (r) => r.o.tracking_number },
        { label: 'SKU', value: (r) => r.it.sku },
        { label: 'Sản phẩm', value: (r) => r.it.name },
        { label: 'Phân loại', value: (r) => r.it.variant },
        { label: 'Số lượng', value: (r) => r.it.quantity },
        { label: 'Đơn giá', value: (r) => r.it.price },
        { label: 'Phí ship', value: (r) => (r.first ? r.o.shipping_fee : '') },
        { label: 'Tổng đơn', value: (r) => (r.first ? r.o.total : '') },
        { label: 'Ghi chú', value: (r) => r.o.note },
      ],
      rows
    );
    sendCsv(res, 'don-hang', csv);
  });

  // ---------- Thống kê ----------
  app.get('/api/stats', requireAuth, (req, res) => res.json(getStats(db, req.user.id, req.query)));

  app.get('/api/stats/export.csv', requireAuth, (req, res) => {
    const stats = getStats(db, req.user.id, req.query);
    const csv = toCsv(
      [
        { label: 'Ngày', value: 'day' },
        { label: 'Số đơn', value: 'orders' },
        { label: 'Doanh thu (không gồm hủy/hoàn)', value: 'revenue' },
      ],
      stats.byDay
    );
    sendCsv(res, 'doanh-thu-theo-ngay', csv);
  });

  // ---------- Sản phẩm / tồn kho ----------
  function queryProducts(userId, q) {
    const where = ['s.user_id = ?'];
    const args = [userId];
    if (q.shopId) where.push('p.shop_id = ?'), args.push(Number(q.shopId));
    if (q.platform) where.push('s.platform = ?'), args.push(String(q.platform));
    if (q.lowStock) where.push('p.stock <= ?'), args.push(Number(q.lowStock) || 5);
    if (q.q) where.push('(p.name LIKE ? OR p.sku LIKE ?)'), args.push(`%${q.q}%`, `%${q.q}%`);
    return db
      .prepare(`SELECT p.id, p.sku, p.name, p.price, p.stock, p.status, p.updated_at, s.id AS shop_id, s.name AS shop_name, s.platform
        FROM products p JOIN shops s ON s.id = p.shop_id WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 5000`)
      .all(...args);
  }

  app.get('/api/products', requireAuth, (req, res) => res.json({ products: queryProducts(req.user.id, req.query) }));

  app.get('/api/products/export.csv', requireAuth, (req, res) => {
    const csv = toCsv(
      [
        { label: 'SKU', value: 'sku' },
        { label: 'Sản phẩm', value: 'name' },
        { label: 'Sàn', value: (p) => PLATFORM_NAMES[p.platform] || p.platform },
        { label: 'Shop', value: 'shop_name' },
        { label: 'Giá', value: 'price' },
        { label: 'Tồn kho', value: 'stock' },
        { label: 'Trạng thái', value: 'status' },
      ],
      queryProducts(req.user.id, req.query)
    );
    sendCsv(res, 'san-pham-ton-kho', csv);
  });

  function sendCsv(res, name, csv) {
    const date = new Date().toISOString().slice(0, 10);
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}-${date}.csv"` });
    res.send(csv);
  }

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Không tìm thấy API')));

  // ---------- Trang SEO + app ----------
  seo.register(app);

  const publicDir = path.join(__dirname, '..', 'public');
  app.get('/app/sw.js', (req, res) => {
    res.set({ 'service-worker-allowed': '/app/', 'cache-control': 'no-cache' });
    res.sendFile(path.join(publicDir, 'app', 'sw.js'));
  });
  app.use(express.static(publicDir, { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

  app.use((req, res) => res.status(404).type('html').send(seo.notFound()));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Lỗi máy chủ' : err.message });
  });

  return app;
}

module.exports = { createApp, STATUS_LABELS };
