'use strict';

// WooCommerce REST API v3 — https://woocommerce.github.io/woocommerce-rest-api-docs/
const { ConnectorError, fetchJson, toNumber, joinAddress } = require('./util');

const STATUS_MAP = {
  pending: 'pending',
  'on-hold': 'pending',
  processing: 'to_ship',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'cancelled',
  refunded: 'returned',
};

function normalizeUrl(url) {
  const u = new URL(String(url || '').trim());
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
    throw new ConnectorError('Website phải dùng HTTPS để bảo vệ API key');
  }
  return u.origin + u.pathname.replace(/\/$/, '');
}

function api(credentials, path, params = {}) {
  const auth = Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString('base64');
  return fetchJson(`${credentials.url}/wp-json/wc/v3${path}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Basic ${auth}` },
  });
}

function mapOrder(o) {
  const s = o.shipping || {};
  const b = o.billing || {};
  const name = [s.first_name || b.first_name, s.last_name || b.last_name].filter(Boolean).join(' ');
  return {
    externalId: String(o.id),
    status: STATUS_MAP[o.status] || 'pending',
    rawStatus: o.status,
    total: toNumber(o.total),
    shippingFee: toNumber(o.shipping_total),
    currency: o.currency || 'VND',
    customerName: name,
    customerPhone: s.phone || b.phone || '',
    shippingAddress: joinAddress([s.address_1 || b.address_1, s.address_2 || b.address_2, s.city || b.city, s.state || b.state]),
    trackingNumber: '',
    carrier: (o.shipping_lines || [])[0]?.method_title || '',
    note: o.customer_note || '',
    createdAt: Date.parse(`${o.date_created_gmt}Z`) || Date.parse(o.date_created) || 0,
    updatedAt: Date.parse(`${o.date_modified_gmt}Z`) || Date.parse(o.date_modified) || 0,
    items: (o.line_items || []).map((it) => ({
      sku: it.sku || '',
      name: it.name,
      variant: (it.meta_data || []).map((m) => m.display_value).filter((v) => typeof v === 'string').join(' / '),
      quantity: toNumber(it.quantity) || 1,
      price: toNumber(it.price),
    })),
  };
}

async function paginate(credentials, path, params) {
  const out = [];
  for (let page = 1; ; page++) {
    const list = await api(credentials, path, { ...params, per_page: '100', page: String(page) });
    if (!Array.isArray(list)) throw new ConnectorError('WooCommerce trả về dữ liệu không hợp lệ');
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

module.exports = {
  id: 'woocommerce',
  name: 'WooCommerce',
  color: '#7f54b3',
  authType: 'apikey',
  mapOrder,
  STATUS_MAP,
  credentialFields: [
    { key: 'url', label: 'Địa chỉ website', type: 'url', placeholder: 'https://shopcuaban.vn' },
    { key: 'consumerKey', label: 'Consumer key', type: 'text', placeholder: 'ck_...' },
    { key: 'consumerSecret', label: 'Consumer secret', type: 'password', placeholder: 'cs_...' },
  ],

  isConfigured() {
    return true;
  },

  async connect(input) {
    if (!input.consumerKey || !input.consumerSecret) throw new ConnectorError('Thiếu Consumer key/secret');
    const credentials = { url: normalizeUrl(input.url), consumerKey: input.consumerKey.trim(), consumerSecret: input.consumerSecret.trim() };
    // Kiểm tra key hợp lệ.
    await api(credentials, '/orders', { per_page: '1' });
    const host = new URL(credentials.url).hostname;
    return { externalId: host, name: input.name || host, credentials };
  },

  async fetchOrders(ctx, { since }) {
    const list = await paginate(ctx.credentials, '/orders', { modified_after: new Date(since).toISOString(), orderby: 'modified', order: 'asc' });
    return list.map(mapOrder);
  },

  async fetchProducts(ctx) {
    const list = await paginate(ctx.credentials, '/products', {});
    return list.map((p) => ({
      externalId: String(p.id),
      sku: p.sku || '',
      name: p.name,
      price: toNumber(p.price),
      stock: toNumber(p.stock_quantity),
      status: p.status,
    }));
  },
};
