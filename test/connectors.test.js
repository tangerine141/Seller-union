'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const shopee = require('../server/connectors/shopee');
const lazada = require('../server/connectors/lazada');
const tiktok = require('../server/connectors/tiktok');
const woocommerce = require('../server/connectors/woocommerce');
const demo = require('../server/connectors/demo');
const { STATUSES } = require('../server/connectors/util');

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');

test('chữ ký Shopee = HMAC(partner_id + path + timestamp + token + shop_id)', () => {
  assert.equal(shopee.sign('key', [1001, '/api/v2/order/get_order_list', 1700000000, 'tok', 55]), hmac('key', '1001/api/v2/order/get_order_list1700000000tok55'));
});

test('chữ ký Lazada sắp xếp tham số, bỏ sign, viết hoa', () => {
  const sig = lazada.sign('sec', '/orders/get', { timestamp: '1', app_key: 'k', sign: 'x', limit: '10' });
  assert.equal(sig, hmac('sec', '/orders/getapp_keyklimit10timestamp1').toUpperCase());
});

test('chữ ký TikTok bọc app_secret hai đầu, bỏ access_token, nối body', () => {
  const sig = tiktok.sign('s', '/order/202309/orders/search', { timestamp: '2', app_key: 'k', access_token: 'a' }, '{"x":1}');
  assert.equal(sig, hmac('s', 's/order/202309/orders/searchapp_keyktimestamp2{"x":1}s'));
});

test('bảng trạng thái chỉ ánh xạ về trạng thái chuẩn', () => {
  for (const c of [shopee, lazada, tiktok, woocommerce]) {
    for (const v of Object.values(c.STATUS_MAP)) assert.ok(STATUSES.includes(v), `${c.id}: ${v}`);
  }
});

test('Shopee mapOrder', () => {
  const o = shopee.mapOrder({
    order_sn: '2401ABC', order_status: 'READY_TO_SHIP', create_time: 1700000000, total_amount: 250000, currency: 'VND',
    recipient_address: { name: 'An', phone: '09', full_address: 'HN' },
    item_list: [{ item_name: 'Áo', model_name: 'M', model_sku: 'A-M', model_quantity_purchased: 2, model_discounted_price: 100000 }],
  });
  assert.equal(o.status, 'to_ship');
  assert.equal(o.createdAt, 1700000000000);
  assert.deepEqual(o.items[0], { sku: 'A-M', name: 'Áo', variant: 'M', quantity: 2, price: 100000 });
});

test('Lazada gộp dòng sản phẩm trùng SKU và đọc ngày có múi giờ', () => {
  assert.equal(lazada.parseDate('2024-01-15 10:00:00 +0700'), Date.parse('2024-01-15T03:00:00Z'));
  const o = lazada.mapOrder({ order_id: 9, statuses: ['shipped'], price: '200,000.00', shipping_fee: '15000', address_shipping: { first_name: 'Bình' } }, [
    { sku: 'X', name: 'Quần', paid_price: 100000, tracking_code: 'LZ1', shipment_provider: 'GHN' },
    { sku: 'X', name: 'Quần', paid_price: 100000 },
  ]);
  assert.equal(o.status, 'shipping');
  assert.equal(o.total, 215000);
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].quantity, 2);
  assert.equal(o.trackingNumber, 'LZ1');
  assert.equal(o.customerName, 'Bình');
});

test('TikTok gộp line_items theo sku_id', () => {
  const o = tiktok.mapOrder({
    id: '5', status: 'AWAITING_SHIPMENT', create_time: 1, payment: { total_amount: '300000', currency: 'VND' },
    line_items: [{ sku_id: 'a', product_name: 'Son', sale_price: '150000' }, { sku_id: 'a', product_name: 'Son', sale_price: '150000' }],
  });
  assert.equal(o.status, 'to_ship');
  assert.equal(o.items[0].quantity, 2);
  assert.equal(o.total, 300000);
});

test('WooCommerce mapOrder', () => {
  const o = woocommerce.mapOrder({
    id: 12, status: 'processing', total: '99000', shipping_total: '0', date_created_gmt: '2024-05-01T02:00:00',
    billing: { first_name: 'Cường', last_name: 'Lê', phone: '09' }, shipping: {}, line_items: [{ name: 'Túi', sku: 'T', quantity: 1, price: 99000 }],
  });
  assert.equal(o.status, 'to_ship');
  assert.equal(o.customerName, 'Cường Lê');
  assert.equal(o.createdAt, Date.parse('2024-05-01T02:00:00Z'));
});

test('WooCommerce từ chối website không dùng HTTPS', async () => {
  await assert.rejects(woocommerce.connect({ url: 'http://example.com', consumerKey: 'a', consumerSecret: 'b' }), /HTTPS/);
});

test('shop demo sinh dữ liệu ổn định giữa các lần đồng bộ', async () => {
  const ctx = { credentials: { seed: 'abc123' } };
  const since = Date.now() - 10 * 86400000;
  const a = await demo.fetchOrders(ctx, { since });
  const b = await demo.fetchOrders(ctx, { since });
  assert.ok(a.length > 10);
  assert.deepEqual(a.map((o) => o.externalId), b.map((o) => o.externalId));
  for (const o of a) assert.ok(STATUSES.includes(o.status));
});

test('mã vạch Code128: bảng mẫu hợp lệ và checksum đúng', async () => {
  // barcode.js là ES module cho trình duyệt -> nạp qua data URL.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/app/barcode.js'), 'utf8');
  const { PATTERNS, encode128B } = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  assert.equal(PATTERNS.length, 107);
  PATTERNS.slice(0, 106).forEach((p) => assert.equal([...p].reduce((s, d) => s + Number(d), 0), 11));
  assert.equal(new Set(PATTERNS).size, 107);
  // "PJJ123C": (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 879 mod 103 = 55.
  const codes = encode128B('PJJ123C');
  assert.equal(codes.at(-2), 55);
  assert.equal(codes[0], 104);
  assert.equal(codes.at(-1), 106);
});
