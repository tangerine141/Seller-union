'use strict';

// Shopee Open Platform API v2 — https://open.shopee.com/documents
const crypto = require('node:crypto');
const config = require('../config');
const { ConnectorError, fetchJson, toNumber, chunk } = require('./util');

const STATUS_MAP = {
  UNPAID: 'pending',
  READY_TO_SHIP: 'to_ship',
  PROCESSED: 'to_ship',
  RETRY_SHIP: 'to_ship',
  SHIPPED: 'shipping',
  TO_CONFIRM_RECEIVE: 'shipping',
  IN_CANCEL: 'cancelled',
  CANCELLED: 'cancelled',
  TO_RETURN: 'returned',
  COMPLETED: 'completed',
};

const FIFTEEN_DAYS = 15 * 24 * 3600;

// sign = HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id])
function sign(partnerKey, parts) {
  return crypto.createHmac('sha256', partnerKey).update(parts.join('')).digest('hex');
}

function cfg() {
  return config.shopee;
}

function buildUrl(path, { accessToken, shopId, params = {} } = {}) {
  const { partnerId, partnerKey, host } = cfg();
  const timestamp = Math.floor(Date.now() / 1000);
  const base = [partnerId, path, timestamp];
  if (accessToken) base.push(accessToken, shopId);
  const qs = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    sign: sign(partnerKey, base),
    ...(accessToken ? { access_token: accessToken, shop_id: String(shopId) } : {}),
    ...params,
  });
  return `${host}${path}?${qs}`;
}

async function call(path, opts = {}) {
  const data = await fetchJson(buildUrl(path, opts), { method: opts.body ? 'POST' : 'GET', body: opts.body });
  if (data.error) throw new ConnectorError(`Shopee: ${data.message || data.error}`, { code: data.error });
  return data;
}

function tokenFrom(data, shopId) {
  return {
    shopId: Number(shopId),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expire_in || 14400) * 1000,
  };
}

async function ensureToken(ctx) {
  const c = ctx.credentials;
  if (c.expiresAt - Date.now() > 5 * 60 * 1000) return c;
  const { partnerId } = cfg();
  const data = await call('/api/v2/auth/access_token/get', {
    body: { refresh_token: c.refreshToken, shop_id: c.shopId, partner_id: Number(partnerId) },
  });
  const next = tokenFrom(data, c.shopId);
  await ctx.saveCredentials(next);
  return next;
}

function shopCall(ctx, path, params) {
  return ensureToken(ctx).then((c) => call(path, { accessToken: c.accessToken, shopId: c.shopId, params }));
}

function mapOrder(o) {
  const addr = o.recipient_address || {};
  return {
    externalId: o.order_sn,
    status: STATUS_MAP[o.order_status] || 'pending',
    rawStatus: o.order_status,
    total: toNumber(o.total_amount),
    shippingFee: toNumber(o.estimated_shipping_fee),
    currency: o.currency || 'VND',
    customerName: addr.name || o.buyer_username || '',
    customerPhone: addr.phone || '',
    shippingAddress: addr.full_address || '',
    trackingNumber: '',
    carrier: o.shipping_carrier || '',
    note: o.message_to_seller || o.note || '',
    createdAt: (o.create_time || 0) * 1000,
    updatedAt: (o.update_time || o.create_time || 0) * 1000,
    items: (o.item_list || []).map((it) => ({
      sku: it.model_sku || it.item_sku || '',
      name: it.item_name,
      variant: it.model_name || '',
      quantity: toNumber(it.model_quantity_purchased) || 1,
      price: toNumber(it.model_discounted_price ?? it.model_original_price),
    })),
  };
}

module.exports = {
  id: 'shopee',
  name: 'Shopee',
  color: '#ee4d2d',
  authType: 'oauth',
  sign,
  mapOrder,
  STATUS_MAP,

  isConfigured() {
    return Boolean(cfg().partnerId && cfg().partnerKey);
  },

  getAuthUrl({ redirectUri, state }) {
    const redirect = `${redirectUri}?state=${encodeURIComponent(state)}`;
    return buildUrl('/api/v2/shop/auth_partner', { params: { redirect } });
  },

  async handleCallback({ query }) {
    const { code, shop_id: shopId } = query;
    if (!code || !shopId) throw new ConnectorError('Shopee không trả về code/shop_id');
    const data = await call('/api/v2/auth/token/get', {
      body: { code, shop_id: Number(shopId), partner_id: Number(cfg().partnerId) },
    });
    const credentials = tokenFrom(data, shopId);
    let name = `Shopee ${shopId}`;
    try {
      const info = await call('/api/v2/shop/get_shop_info', { accessToken: credentials.accessToken, shopId });
      name = info.shop_name || name;
    } catch {
      // Không lấy được tên shop thì dùng tên mặc định.
    }
    return { externalId: String(shopId), name, credentials };
  },

  async fetchOrders(ctx, { since }) {
    const now = Math.floor(Date.now() / 1000);
    const sns = [];
    for (let from = Math.floor(since / 1000); from < now; from += FIFTEEN_DAYS) {
      const to = Math.min(from + FIFTEEN_DAYS, now);
      let cursor = '';
      do {
        const data = await shopCall(ctx, '/api/v2/order/get_order_list', {
          time_range_field: 'update_time',
          time_from: String(from),
          time_to: String(to),
          page_size: '100',
          cursor,
        });
        const r = data.response || {};
        for (const o of r.order_list || []) sns.push(o.order_sn);
        cursor = r.more ? r.next_cursor : '';
      } while (cursor);
    }
    const orders = [];
    for (const batch of chunk([...new Set(sns)], 50)) {
      const data = await shopCall(ctx, '/api/v2/order/get_order_detail', {
        order_sn_list: batch.join(','),
        response_optional_fields:
          'buyer_username,recipient_address,item_list,total_amount,shipping_carrier,estimated_shipping_fee,message_to_seller,currency',
      });
      for (const o of data.response?.order_list || []) orders.push(mapOrder(o));
    }
    return orders;
  },

  async fetchProducts(ctx) {
    const ids = [];
    let offset = 0;
    for (;;) {
      const data = await shopCall(ctx, '/api/v2/product/get_item_list', {
        offset: String(offset),
        page_size: '100',
        item_status: 'NORMAL',
      });
      const r = data.response || {};
      for (const it of r.item || []) ids.push(it.item_id);
      if (!r.has_next_page) break;
      offset = r.next_offset;
    }
    const products = [];
    for (const batch of chunk(ids, 50)) {
      const data = await shopCall(ctx, '/api/v2/product/get_item_base_info', { item_id_list: batch.join(',') });
      for (const it of data.response?.item_list || []) {
        products.push({
          externalId: String(it.item_id),
          sku: it.item_sku || '',
          name: it.item_name,
          price: toNumber(it.price_info?.[0]?.current_price),
          stock: toNumber(it.stock_info_v2?.summary_info?.total_available_stock),
          status: it.item_status,
        });
      }
    }
    return products;
  },
};
