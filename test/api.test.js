'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server;
let base;

test.before(async () => {
  const app = createApp(open(':memory:'));
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

test('trang SEO, sitemap, robots', async () => {
  const c = client();
  const home = await c('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /<title>[^<]*Shopee/);
  assert.match(home.body, /application\/ld\+json/);
  assert.match(home.body, /rel="canonical"/);
  assert.equal((await c('/ket-noi/tiktok-shop')).status, 200);
  const guide = await c('/huong-dan-ket-noi');
  assert.equal(guide.status, 200);
  assert.match(guide.body, /connect\/lazada\/callback/);
  assert.match(guide.body, /"HowTo"/);
  assert.equal((await c('/ket-noi/khong-co')).status, 404);
  assert.match((await c('/sitemap.xml')).body, /ket-noi\/lazada/);
  assert.match((await c('/robots.txt')).body, /Disallow: \/app\//);
  assert.equal((await c('/app/')).status, 200);
});

test('luồng đầy đủ: đăng ký → shop demo → thống kê → đơn → xuất CSV', async () => {
  const c = client();
  assert.equal((await c('/api/shops')).status, 401);
  assert.equal((await c('/api/auth/register', { method: 'POST', body: { email: 'x@y.vn', password: 'short' } })).status, 400);
  const reg = await c('/api/auth/register', { method: 'POST', body: { email: 'X@y.vn', name: 'Chủ shop', password: 'matkhau123' } });
  assert.equal(reg.status, 201);
  assert.equal((await c('/api/me')).body.user.email, 'x@y.vn');

  const created = await c('/api/shops', { method: 'POST', body: { platform: 'demo', name: 'Demo A' } });
  assert.equal(created.status, 201);
  const shops = (await c('/api/shops')).body.shops;
  assert.equal(shops.length, 1);
  assert.ok(shops[0].order_count > 0);
  assert.equal(shops[0].product_count, 10);

  const stats = (await c('/api/stats')).body;
  assert.ok(stats.summary.orders > 0);
  assert.ok(stats.summary.revenue > 0);
  assert.equal(stats.byDay.length >= 30, true);
  assert.equal(stats.byDay.reduce((n, d) => n + d.orders, 0), stats.summary.orders);

  const list = (await c('/api/orders?limit=5&withCounts=1')).body;
  assert.equal(list.orders.length, 5);
  assert.ok(list.orders[0].items.length > 0);
  assert.equal(Object.values(list.statusCounts).reduce((a, b) => a + b, 0), list.total);

  const done = (await c('/api/orders?status=completed&limit=1000')).body;
  assert.ok(done.orders.every((o) => o.status === 'completed'));

  const ids = list.orders.slice(0, 2).map((o) => o.id).join(',');
  const byIds = (await c(`/api/orders?ids=${ids}`)).body;
  assert.equal(byIds.total, 2);

  const csv = await c(`/api/orders/export.csv?ids=${ids}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  // fetch().text() tự bỏ BOM; BOM được kiểm tra trong csv.test.js.
  assert.ok(csv.body.startsWith('Mã đơn,'));

  // Đồng bộ lại không nhân đôi đơn.
  const before = (await c('/api/orders?limit=1')).body.total;
  assert.equal((await c(`/api/shops/${shops[0].id}/sync`, { method: 'POST' })).status, 200);
  assert.equal((await c('/api/orders?limit=1')).body.total, before);

  assert.ok((await c('/api/products?lowStock=200')).body.products.length > 0);
  assert.match((await c('/api/stats/export.csv')).body, /Doanh thu/);
});

test('người dùng khác không xem được shop/đơn của nhau', async () => {
  const a = client();
  const b = client();
  await a('/api/auth/register', { method: 'POST', body: { email: 'a1@y.vn', password: 'matkhau123' } });
  await b('/api/auth/register', { method: 'POST', body: { email: 'b1@y.vn', password: 'matkhau123' } });
  await a('/api/shops', { method: 'POST', body: { platform: 'demo' } });
  const shopId = (await a('/api/shops')).body.shops[0].id;
  assert.equal((await b('/api/orders')).body.total, 0);
  assert.equal((await b(`/api/shops/${shopId}/sync`, { method: 'POST' })).status, 404);
  assert.equal((await b(`/api/shops/${shopId}`, { method: 'DELETE' })).status, 404);
  assert.equal((await a(`/api/shops/${shopId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a('/api/orders')).body.total, 0);
});

test('đăng nhập sai và OAuth thiếu cấu hình/state giả', async () => {
  const c = client();
  await c('/api/auth/register', { method: 'POST', body: { email: 'o@y.vn', password: 'matkhau123' } });
  await c('/api/auth/logout', { method: 'POST' });
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'o@y.vn', password: 'sai-mat-khau' } })).status, 401);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'o@y.vn', password: 'matkhau123' } })).status, 200);
  const auth = await c('/api/connect/shopee/authorize');
  assert.equal(auth.status, 400);
  assert.match(auth.body.error, /Chưa có key/);
  const cb = await c('/connect/shopee/callback?code=x&shop_id=1&state=gia-mao');
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /error=/);
});

test('shop dùng key riêng: lưu key, ủy quyền Lazada, nhận callback, đồng bộ bằng key của chính shop', async (t) => {
  const c = client();
  await c('/api/auth/register', { method: 'POST', body: { email: 'own@y.vn', password: 'matkhau123' } });

  assert.equal((await c('/api/connect/lazada/app', { method: 'PUT', body: { appKey: 'abc', appSecret: 's' } })).status, 400);
  assert.equal((await c('/api/connect/lazada/app', { method: 'PUT', body: { appKey: '123456', appSecret: 'bi-mat' } })).status, 200);
  assert.deepEqual(Object.keys((await c('/api/connect/apps')).body.apps), ['lazada']);

  const auth = await c('/api/connect/lazada/authorize?own=1');
  assert.equal(auth.status, 200);
  const url = new URL(auth.body.url);
  assert.equal(url.searchParams.get('client_id'), '123456');
  assert.ok(!auth.body.url.includes('bi-mat'), 'không lộ App Secret ra URL');
  const state = url.searchParams.get('state');

  // Giả lập API Lazada: kiểm tra request được ký bằng key riêng của shop.
  const realFetch = global.fetch;
  const seenKeys = new Set();
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (input, init) => {
    const u = new URL(String(input));
    if (u.hostname === '127.0.0.1') return realFetch(input, init);
    seenKeys.add(u.searchParams.get('app_key'));
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/auth/token/create')) return json({ code: '0', access_token: 'tok', refresh_token: 'rt', expires_in: 3600, country_user_info: [{ seller_id: 'S1' }] });
    if (u.pathname.endsWith('/seller/get')) return json({ code: '0', data: { name: 'Shop Lazada Của Tôi' } });
    if (u.pathname.endsWith('/orders/get')) return json({ code: '0', data: { orders: [{ order_id: 77, statuses: ['pending'], price: '100000', created_at: '2026-09-01 10:00:00 +0700' }] } });
    if (u.pathname.endsWith('/orders/items/get')) return json({ code: '0', data: [{ order_id: 77, order_items: [{ sku: 'A', name: 'Áo', paid_price: 100000 }] }] });
    if (u.pathname.endsWith('/products/get')) return json({ code: '0', data: { products: [] } });
    return json({ code: 'X', message: 'không mong đợi ' + u.pathname });
  };

  const cb = await c(`/connect/lazada/callback?code=abc&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /connected=/);
  const shop = (await c('/api/shops')).body.shops[0];
  assert.equal(shop.name, 'Shop Lazada Của Tôi');
  assert.equal((await c(`/api/shops/${shop.id}/sync`, { method: 'POST' })).status, 200);
  assert.equal((await c('/api/orders')).body.total, 1);
  assert.deepEqual([...seenKeys], ['123456']);

  assert.equal((await c('/api/connect/lazada/app', { method: 'DELETE' })).status, 200);
  assert.equal((await c('/api/connect/lazada/authorize?own=1')).status, 400);
});
