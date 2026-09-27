'use strict';

// TikTok Shop Partner API (phiên bản 202309) — https://partner.tiktokshop.com/docv2
const crypto = require('node:crypto');
const config = require('../config');
const { ConnectorError, fetchJson, toNumber } = require('./util');

const STATUS_MAP = {
  UNPAID: 'pending',
  ON_HOLD: 'pending',
  AWAITING_SHIPMENT: 'to_ship',
  PARTIALLY_SHIPPING: 'to_ship',
  AWAITING_COLLECTION: 'to_ship',
  IN_TRANSIT: 'shipping',
  DELIVERED: 'completed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// sign = HEX(HMAC-SHA256(secret, secret + path + k1v1k2v2... + body + secret))
function sign(secret, path, params, body = '') {
  const base =
    path +
    Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'access_token')
      .sort()
      .map((k) => k + params[k])
      .join('') +
    body;
  return crypto.createHmac('sha256', secret).update(secret + base + secret).digest('hex');
}

function cfg() {
  return config.tiktok;
}

async function call(path, { params = {}, body, accessToken } = {}) {
  const { appKey, appSecret, apiHost } = cfg();
  const all = { app_key: appKey, timestamp: String(Math.floor(Date.now() / 1000)), ...params };
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  all.sign = sign(appSecret, path, all, bodyStr);
  const data = await fetchJson(`${apiHost}${path}?${new URLSearchParams(all)}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: accessToken ? { 'x-tts-access-token': accessToken } : {},
    body: body === undefined ? undefined : bodyStr,
  });
  if (data.code !== 0) throw new ConnectorError(`TikTok Shop: ${data.message || data.code}`, { code: data.code });
  return data.data || {};
}

async function tokenCall(path, params) {
  const { appKey, appSecret, authHost } = cfg();
  const data = await fetchJson(`${authHost}${path}?${new URLSearchParams({ app_key: appKey, app_secret: appSecret, ...params })}`);
  if (data.code !== 0) throw new ConnectorError(`TikTok Shop: ${data.message || data.code}`, { code: data.code });
  const d = data.data;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: d.access_token_expire_in * 1000,
    sellerName: d.seller_name,
  };
}

async function ensureToken(ctx) {
  const c = ctx.credentials;
  if (c.expiresAt - Date.now() > 10 * 60 * 1000) return c;
  const t = await tokenCall('/api/v2/token/refresh', { refresh_token: c.refreshToken, grant_type: 'refresh_token' });
  const next = { ...c, ...t };
  await ctx.saveCredentials(next);
  return next;
}

async function shopCall(ctx, path, params, body) {
  const c = await ensureToken(ctx);
  return call(path, { params: { shop_cipher: c.shopCipher, ...params }, body, accessToken: c.accessToken });
}

function mapOrder(o) {
  const a = o.recipient_address || {};
  const pay = o.payment || {};
  // TikTok trả mỗi đơn vị sản phẩm là 1 line_item -> gộp theo SKU.
  const grouped = new Map();
  for (const it of o.line_items || []) {
    const key = it.sku_id || `${it.seller_sku}|${it.sku_name}`;
    const g = grouped.get(key);
    if (g) g.quantity += 1;
    else grouped.set(key, { sku: it.seller_sku || '', name: it.product_name, variant: it.sku_name || '', quantity: 1, price: toNumber(it.sale_price) });
  }
  const line = (o.line_items || [])[0] || {};
  return {
    externalId: String(o.id),
    status: STATUS_MAP[o.status] || 'pending',
    rawStatus: o.status,
    total: toNumber(pay.total_amount),
    shippingFee: toNumber(pay.shipping_fee),
    currency: pay.currency || 'VND',
    customerName: a.name || '',
    customerPhone: a.phone_number || '',
    shippingAddress: a.full_address || '',
    trackingNumber: o.tracking_number || line.tracking_number || '',
    carrier: o.shipping_provider || line.shipping_provider_name || '',
    note: o.buyer_message || '',
    createdAt: (o.create_time || 0) * 1000,
    updatedAt: (o.update_time || o.create_time || 0) * 1000,
    items: [...grouped.values()],
  };
}

module.exports = {
  id: 'tiktok',
  name: 'TikTok Shop',
  color: '#111111',
  authType: 'oauth',
  sign,
  mapOrder,
  STATUS_MAP,

  isConfigured() {
    return Boolean(cfg().appKey && cfg().appSecret && cfg().serviceId);
  },

  // Redirect URL được cấu hình trong Partner Center, không truyền qua tham số.
  getAuthUrl({ state }) {
    return `${cfg().authorizeUrl}?${new URLSearchParams({ service_id: cfg().serviceId, state })}`;
  },

  async handleCallback({ query }) {
    if (!query.code) throw new ConnectorError('TikTok Shop không trả về code');
    const token = await tokenCall('/api/v2/token/get', { auth_code: query.code, grant_type: 'authorized_code' });
    const data = await call('/authorization/202309/shops', { accessToken: token.accessToken });
    const shop = (data.shops || [])[0];
    if (!shop) throw new ConnectorError('Tài khoản TikTok Shop chưa có shop nào được ủy quyền');
    return {
      externalId: String(shop.id),
      name: shop.name || token.sellerName || 'TikTok Shop',
      credentials: { ...token, shopId: String(shop.id), shopCipher: shop.cipher },
    };
  },

  async fetchOrders(ctx, { since }) {
    const orders = [];
    let pageToken = '';
    do {
      const data = await shopCall(
        ctx,
        '/order/202309/orders/search',
        { page_size: '50', sort_field: 'update_time', sort_order: 'ASC', ...(pageToken ? { page_token: pageToken } : {}) },
        { update_time_ge: Math.floor(since / 1000) }
      );
      for (const o of data.orders || []) orders.push(mapOrder(o));
      pageToken = data.next_page_token || '';
    } while (pageToken);
    return orders;
  },

  async fetchProducts(ctx) {
    const products = [];
    let pageToken = '';
    do {
      const data = await shopCall(ctx, '/product/202309/products/search', { page_size: '100', ...(pageToken ? { page_token: pageToken } : {}) }, {});
      for (const p of data.products || []) {
        for (const s of p.skus || []) {
          products.push({
            externalId: `${p.id}:${s.id}`,
            sku: s.seller_sku || '',
            name: p.title,
            price: toNumber(s.price?.sale_price ?? s.price?.tax_exclusive_price),
            stock: (s.inventory || []).reduce((n, i) => n + toNumber(i.quantity), 0),
            status: p.status || '',
          });
        }
      }
      pageToken = data.next_page_token || '';
    } while (pageToken);
    return products;
  },
};
