'use strict';

// Lazada Open Platform — https://open.lazada.com/apps/doc/doc
const crypto = require('node:crypto');
const config = require('../config');
const { ConnectorError, fetchJson, toNumber, chunk, joinAddress } = require('./util');

const STATUS_MAP = {
  unpaid: 'pending',
  pending: 'to_ship',
  topack: 'to_ship',
  packed: 'to_ship',
  repacked: 'to_ship',
  ready_to_ship: 'to_ship',
  ready_to_ship_pending: 'to_ship',
  shipped: 'shipping',
  delivered: 'completed',
  confirmed: 'completed',
  canceled: 'cancelled',
  returned: 'returned',
  shipped_back: 'returned',
  shipped_back_success: 'returned',
  failed_delivery: 'returned',
  lost_by_3pl: 'cancelled',
  damaged_by_3pl: 'cancelled',
};

// sign = HEX_UPPER(HMAC-SHA256(app_secret, apiPath + k1v1k2v2... (khóa sắp xếp tăng dần)))
function sign(secret, apiPath, params) {
  const base =
    apiPath +
    Object.keys(params)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => k + params[k])
      .join('');
  return crypto.createHmac('sha256', secret).update(base).digest('hex').toUpperCase();
}

function cfg() {
  return config.lazada;
}

async function call(host, apiPath, params = {}, accessToken) {
  const { appKey, appSecret } = cfg();
  const all = { app_key: appKey, timestamp: String(Date.now()), sign_method: 'sha256', ...params };
  if (accessToken) all.access_token = accessToken;
  all.sign = sign(appSecret, apiPath, all);
  const data = await fetchJson(`${host}${apiPath}?${new URLSearchParams(all)}`);
  if (data.code && data.code !== '0') throw new ConnectorError(`Lazada: ${data.message || data.code}`, { code: data.code });
  return data;
}

function tokenFrom(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 0) * 1000,
    sellerId: String(data.country_user_info?.[0]?.seller_id || data.account || ''),
  };
}

async function ensureToken(ctx) {
  const c = ctx.credentials;
  if (c.expiresAt - Date.now() > 10 * 60 * 1000) return c;
  const data = await call(`${cfg().authHost}/rest`, '/auth/token/refresh', { refresh_token: c.refreshToken });
  const next = { ...tokenFrom(data), sellerId: c.sellerId };
  await ctx.saveCredentials(next);
  return next;
}

async function shopCall(ctx, apiPath, params) {
  const c = await ensureToken(ctx);
  return call(cfg().apiHost, apiPath, params, c.accessToken);
}

// "2024-01-15 10:23:45 +0700" -> epoch ms
function parseDate(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  const t = Date.parse(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : s);
  return Number.isFinite(t) ? t : 0;
}

function mapOrder(o, orderItems = []) {
  const a = o.address_shipping || {};
  const raw = (o.statuses || [])[0] || '';
  // Lazada trả mỗi đơn vị sản phẩm là 1 dòng -> gộp theo SKU.
  const grouped = new Map();
  for (const it of orderItems) {
    const key = `${it.sku}|${it.variation || ''}`;
    const g = grouped.get(key);
    if (g) g.quantity += 1;
    else grouped.set(key, { sku: it.sku || '', name: it.name, variant: it.variation || '', quantity: 1, price: toNumber(it.paid_price ?? it.item_price) });
  }
  const first = orderItems[0] || {};
  return {
    externalId: String(o.order_id),
    status: STATUS_MAP[raw] || 'pending',
    rawStatus: raw,
    total: toNumber(o.price) + toNumber(o.shipping_fee) - toNumber(o.voucher),
    shippingFee: toNumber(o.shipping_fee),
    currency: 'VND',
    customerName: [a.first_name, a.last_name].filter(Boolean).join(' ') || o.customer_first_name || '',
    customerPhone: a.phone || '',
    shippingAddress: joinAddress([a.address1, a.address5, a.address4, a.address3, a.city]),
    trackingNumber: first.tracking_code || '',
    carrier: first.shipment_provider || '',
    note: o.remarks || '',
    createdAt: parseDate(o.created_at),
    updatedAt: parseDate(o.updated_at || o.created_at),
    items: [...grouped.values()],
  };
}

module.exports = {
  id: 'lazada',
  name: 'Lazada',
  color: '#0f146d',
  authType: 'oauth',
  sign,
  parseDate,
  mapOrder,
  STATUS_MAP,

  isConfigured() {
    return Boolean(cfg().appKey && cfg().appSecret);
  },

  getAuthUrl({ redirectUri, state }) {
    const qs = new URLSearchParams({
      response_type: 'code',
      force_auth: 'true',
      redirect_uri: redirectUri,
      client_id: cfg().appKey,
      state,
    });
    return `${cfg().authHost}/oauth/authorize?${qs}`;
  },

  async handleCallback({ query }) {
    if (!query.code) throw new ConnectorError('Lazada không trả về code');
    const data = await call(`${cfg().authHost}/rest`, '/auth/token/create', { code: query.code });
    const credentials = tokenFrom(data);
    let name = `Lazada ${credentials.sellerId || ''}`.trim();
    try {
      const info = await call(cfg().apiHost, '/seller/get', {}, credentials.accessToken);
      name = info.data?.name || name;
    } catch {
      // Giữ tên mặc định.
    }
    return { externalId: credentials.sellerId || data.account, name, credentials };
  },

  async fetchOrders(ctx, { since }) {
    const raw = [];
    for (let offset = 0; ; offset += 100) {
      const data = await shopCall(ctx, '/orders/get', {
        update_after: new Date(since).toISOString(),
        sort_by: 'updated_at',
        sort_direction: 'ASC',
        offset: String(offset),
        limit: '100',
      });
      const list = data.data?.orders || [];
      raw.push(...list);
      if (list.length < 100) break;
    }
    const itemsByOrder = new Map();
    for (const batch of chunk(raw.map((o) => o.order_id), 50)) {
      const data = await shopCall(ctx, '/orders/items/get', { order_ids: JSON.stringify(batch) });
      for (const row of data.data || []) itemsByOrder.set(String(row.order_id), row.order_items || []);
    }
    return raw.map((o) => mapOrder(o, itemsByOrder.get(String(o.order_id))));
  },

  async fetchProducts(ctx) {
    const products = [];
    for (let offset = 0; ; offset += 50) {
      const data = await shopCall(ctx, '/products/get', { filter: 'all', offset: String(offset), limit: '50' });
      const list = data.data?.products || [];
      for (const p of list) {
        for (const s of p.skus || [p]) {
          products.push({
            externalId: `${p.item_id}:${s.SellerSku || s.SkuId || ''}`,
            sku: s.SellerSku || '',
            name: p.attributes?.name || String(p.item_id),
            price: toNumber(s.special_price || s.price),
            stock: toNumber(s.quantity),
            status: s.Status || p.status || '',
          });
        }
      }
      if (list.length < 50) break;
    }
    return products;
  },
};
