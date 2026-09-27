'use strict';

const config = require('../config');
const connectors = require('../connectors');
const { tx } = require('../db');
const { encryptJson, decryptJson } = require('../crypto');

const DAY = 24 * 3600 * 1000;
const running = new Set();

function upsertOrders(db, shopId, orders) {
  const upsert = db.prepare(`
    INSERT INTO orders (shop_id, external_id, status, raw_status, total, shipping_fee, currency, customer_name,
      customer_phone, shipping_address, tracking_number, carrier, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (shop_id, external_id) DO UPDATE SET
      status = excluded.status, raw_status = excluded.raw_status, total = excluded.total,
      shipping_fee = excluded.shipping_fee, currency = excluded.currency, customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone, shipping_address = excluded.shipping_address,
      tracking_number = excluded.tracking_number, carrier = excluded.carrier, note = excluded.note,
      created_at = excluded.created_at, updated_at = excluded.updated_at
    RETURNING id`);
  const delItems = db.prepare('DELETE FROM order_items WHERE order_id = ?');
  const addItem = db.prepare('INSERT INTO order_items (order_id, sku, name, variant, quantity, price) VALUES (?, ?, ?, ?, ?, ?)');

  tx(db, () => {
    for (const o of orders) {
      const { id } = upsert.get(
        shopId, o.externalId, o.status, o.rawStatus || '', o.total || 0, o.shippingFee || 0, o.currency || 'VND',
        o.customerName || '', o.customerPhone || '', o.shippingAddress || '', o.trackingNumber || '', o.carrier || '',
        o.note || '', o.createdAt || Date.now(), o.updatedAt || o.createdAt || Date.now()
      );
      delItems.run(id);
      for (const it of o.items || []) addItem.run(id, it.sku || '', it.name || '(không tên)', it.variant || '', it.quantity || 1, it.price || 0);
    }
  });
}

function upsertProducts(db, shopId, products) {
  const upsert = db.prepare(`
    INSERT INTO products (shop_id, external_id, sku, name, price, stock, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (shop_id, external_id) DO UPDATE SET
      sku = excluded.sku, name = excluded.name, price = excluded.price, stock = excluded.stock,
      status = excluded.status, updated_at = excluded.updated_at`);
  const now = Date.now();
  tx(db, () => {
    for (const p of products) upsert.run(shopId, p.externalId, p.sku || '', p.name || '(không tên)', p.price || 0, p.stock || 0, p.status || '', now);
  });
}

async function syncShop(db, shop) {
  if (running.has(shop.id)) return { skipped: true };
  const connector = connectors.get(shop.platform);
  if (!connector) throw new Error(`Không hỗ trợ sàn ${shop.platform}`);
  running.add(shop.id);
  const startedAt = Date.now();
  try {
    const ctx = {
      credentials: decryptJson(config.appSecret, shop.credentials),
      saveCredentials(next) {
        ctx.credentials = next;
        db.prepare('UPDATE shops SET credentials = ? WHERE id = ?').run(encryptJson(config.appSecret, next), shop.id);
      },
    };
    // Lùi 1 giờ so với lần trước để không sót đơn cập nhật sát thời điểm đồng bộ.
    const since = shop.last_sync_at ? shop.last_sync_at - 3600 * 1000 : startedAt - config.initialSyncDays * DAY;
    const orders = await connector.fetchOrders(ctx, { since });
    upsertOrders(db, shop.id, orders);
    const products = await connector.fetchProducts(ctx);
    upsertProducts(db, shop.id, products);
    db.prepare("UPDATE shops SET last_sync_at = ?, last_sync_error = NULL, status = 'active' WHERE id = ?").run(startedAt, shop.id);
    return { orders: orders.length, products: products.length };
  } catch (err) {
    db.prepare("UPDATE shops SET last_sync_error = ?, status = 'error' WHERE id = ?").run(String(err.message || err).slice(0, 500), shop.id);
    throw err;
  } finally {
    running.delete(shop.id);
  }
}

async function syncAll(db, userId) {
  const shops = userId
    ? db.prepare('SELECT * FROM shops WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM shops').all();
  const results = [];
  for (const shop of shops) {
    try {
      results.push({ shopId: shop.id, ok: true, ...(await syncShop(db, shop)) });
    } catch (err) {
      results.push({ shopId: shop.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { syncShop, syncAll, upsertOrders, upsertProducts };
