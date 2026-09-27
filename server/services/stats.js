'use strict';

const config = require('../config');

const DAY = 24 * 3600 * 1000;
// Đơn hủy/hoàn không tính vào doanh thu.
const REVENUE_FILTER = "o.status NOT IN ('cancelled', 'returned')";

function tzModifier() {
  return `${config.tzOffsetMinutes >= 0 ? '+' : ''}${config.tzOffsetMinutes} minutes`;
}

// Dựng mệnh đề WHERE dùng chung cho đơn hàng của một người dùng.
function orderFilter(userId, f = {}) {
  const where = ['s.user_id = ?'];
  const args = [userId];
  if (f.from) where.push('o.created_at >= ?'), args.push(Number(f.from));
  if (f.to) where.push('o.created_at < ?'), args.push(Number(f.to));
  if (f.shopId) where.push('o.shop_id = ?'), args.push(Number(f.shopId));
  if (f.platform) where.push('s.platform = ?'), args.push(String(f.platform));
  if (f.status) {
    const statuses = String(f.status).split(',').filter(Boolean);
    where.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }
  if (f.ids) {
    const ids = String(f.ids).split(',').map(Number).filter(Number.isFinite);
    where.push(`o.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    args.push(...ids);
  }
  if (f.q) {
    where.push('(o.external_id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.tracking_number LIKE ? OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND (i.name LIKE ? OR i.sku LIKE ?)))');
    const like = `%${String(f.q).trim()}%`;
    args.push(like, like, like, like, like, like);
  }
  return { sql: `FROM orders o JOIN shops s ON s.id = o.shop_id WHERE ${where.join(' AND ')}`, args };
}

function attachItems(db, orders) {
  if (!orders.length) return orders;
  const items = db
    .prepare(`SELECT order_id, sku, name, variant, quantity, price FROM order_items WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`)
    .all(...orders.map((o) => o.id));
  const byOrder = new Map(orders.map((o) => [o.id, (o.items = [])]));
  for (const it of items) {
    const { order_id: orderId, ...rest } = it;
    byOrder.get(orderId).push({ ...rest });
  }
  return orders;
}

function listOrders(db, userId, f = {}) {
  const { sql, args } = orderFilter(userId, f);
  const limit = Math.min(Math.max(parseInt(f.limit, 10) || 50, 1), 5000);
  const offset = Math.max(parseInt(f.offset, 10) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
  const rows = db
    .prepare(`SELECT o.*, s.name AS shop_name, s.platform ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map((r) => ({ ...r }));
  const result = { total, orders: attachItems(db, rows) };
  if (f.withCounts) {
    // Số đơn theo từng trạng thái (bỏ qua bộ lọc trạng thái) cho các tab.
    const c = orderFilter(userId, { ...f, status: undefined });
    result.statusCounts = Object.fromEntries(
      db.prepare(`SELECT o.status, COUNT(*) AS n ${c.sql} GROUP BY o.status`).all(...c.args).map((r) => [r.status, r.n])
    );
  }
  return result;
}

function getStats(db, userId, f = {}) {
  const to = Number(f.to) || Date.now();
  const from = Number(f.from) || to - 30 * DAY;
  const { sql, args } = orderFilter(userId, { ...f, from, to, status: undefined, q: undefined });

  const summary = { ...db
    .prepare(`SELECT COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN ${REVENUE_FILTER} THEN o.total END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total END), 0) AS completedRevenue,
        SUM(o.status = 'cancelled') AS cancelled,
        SUM(o.status = 'returned') AS returned,
        SUM(o.status IN ('pending', 'to_ship')) AS toProcess
      ${sql}`)
    .get(...args) };
  const valid = summary.orders - summary.cancelled - summary.returned;
  summary.avgOrderValue = valid > 0 ? Math.round(summary.revenue / valid) : 0;
  summary.cancelRate = summary.orders ? (summary.cancelled + summary.returned) / summary.orders : 0;
  summary.itemsSold = db
    .prepare(`SELECT COALESCE(SUM(i.quantity), 0) AS n ${sql.replace('FROM orders o', 'FROM order_items i JOIN orders o ON o.id = i.order_id')} AND ${REVENUE_FILTER}`)
    .get(...args).n;

  const tz = tzModifier();
  const dayRows = db
    .prepare(`SELECT strftime('%Y-%m-%d', o.created_at / 1000, 'unixepoch', '${tz}') AS day,
        COUNT(*) AS orders, COALESCE(SUM(CASE WHEN ${REVENUE_FILTER} THEN o.total END), 0) AS revenue
      ${sql} GROUP BY day ORDER BY day`)
    .all(...args);
  // Điền đủ các ngày không có đơn để biểu đồ liền mạch.
  const byDayMap = new Map(dayRows.map((r) => [r.day, r]));
  const byDay = [];
  const offset = config.tzOffsetMinutes * 60 * 1000;
  for (let t = Math.floor((from + offset) / DAY) * DAY; t < to + offset; t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.push({ day, orders: byDayMap.get(day)?.orders || 0, revenue: byDayMap.get(day)?.revenue || 0 });
  }

  const byStatus = db.prepare(`SELECT o.status, COUNT(*) AS orders ${sql} GROUP BY o.status`).all(...args).map((r) => ({ ...r }));

  const byShop = db
    .prepare(`SELECT s.id AS shopId, s.name, s.platform, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN ${REVENUE_FILTER} THEN o.total END), 0) AS revenue
      ${sql} GROUP BY s.id ORDER BY revenue DESC`)
    .all(...args)
    .map((r) => ({ ...r }));

  const byPlatform = [];
  for (const s of byShop) {
    const p = byPlatform.find((x) => x.platform === s.platform);
    if (p) (p.orders += s.orders), (p.revenue += s.revenue);
    else byPlatform.push({ platform: s.platform, orders: s.orders, revenue: s.revenue });
  }

  const topProducts = db
    .prepare(`SELECT COALESCE(NULLIF(i.sku, ''), i.name) AS sku, MAX(i.name) AS name, SUM(i.quantity) AS quantity,
        SUM(i.quantity * i.price) AS revenue
      ${sql.replace('FROM orders o', 'FROM order_items i JOIN orders o ON o.id = i.order_id')} AND ${REVENUE_FILTER}
      GROUP BY 1 ORDER BY quantity DESC LIMIT 10`)
    .all(...args)
    .map((r) => ({ ...r }));

  const lowStock = db
    .prepare(`SELECT p.id, p.sku, p.name, p.stock, s.name AS shop_name, s.platform
      FROM products p JOIN shops s ON s.id = p.shop_id
      WHERE s.user_id = ? AND p.stock <= 5 ${f.shopId ? 'AND s.id = ?' : ''} ${f.platform ? 'AND s.platform = ?' : ''}
      ORDER BY p.stock ASC LIMIT 10`)
    .all(userId, ...(f.shopId ? [Number(f.shopId)] : []), ...(f.platform ? [String(f.platform)] : []))
    .map((r) => ({ ...r }));

  return { from, to, summary, byDay, byStatus, byShop, byPlatform, topProducts, lowStock };
}

module.exports = { listOrders, getStats, orderFilter };
