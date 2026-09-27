'use strict';

// Shop giả lập: sinh dữ liệu ổn định (cùng ngày luôn ra cùng đơn) để dùng thử mà không cần tài khoản sàn.
const crypto = require('node:crypto');

const DAY = 24 * 3600 * 1000;

const CATALOG = [
  ['AO-THUN-01', 'Áo thun cotton basic', 129000],
  ['AO-SOMI-02', 'Áo sơ mi linen tay dài', 289000],
  ['QUAN-JEAN-03', 'Quần jean ống suông', 359000],
  ['VAY-HOA-04', 'Váy hoa nhí dáng xòe', 245000],
  ['TUI-TOTE-05', 'Túi tote canvas', 99000],
  ['NON-BH-06', 'Nón bucket', 79000],
  ['SON-MOI-07', 'Son kem lì', 159000],
  ['KEM-CN-08', 'Kem chống nắng SPF50', 219000],
  ['DEP-09', 'Dép quai ngang', 119000],
  ['BINH-NUOC-10', 'Bình giữ nhiệt 500ml', 189000],
];
const SIZES = ['S', 'M', 'L', 'XL'];
const NAMES = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thu Dung', 'Hoàng Minh Đức', 'Vũ Ngọc Hà', 'Đặng Quốc Huy', 'Bùi Thanh Lan', 'Đỗ Mai Linh', 'Ngô Gia Phúc'];
const CITIES = ['Quận 1, TP. Hồ Chí Minh', 'Quận Cầu Giấy, Hà Nội', 'Quận Hải Châu, Đà Nẵng', 'TP. Biên Hòa, Đồng Nai', 'Quận Ninh Kiều, Cần Thơ', 'TP. Thủ Đức, TP. Hồ Chí Minh'];
const CARRIERS = ['GHN', 'GHTK', 'J&T Express', 'SPX Express', 'Viettel Post'];

function rng(seed) {
  let a = crypto.createHash('md5').update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function ordersForDay(seed, dayStart, now) {
  const r = rng(`${seed}:${dayStart}`);
  const weekend = [0, 6].includes(new Date(dayStart).getDay());
  const count = Math.floor(r() * 6) + (weekend ? 5 : 2);
  const orders = [];
  for (let i = 0; i < count; i++) {
    const createdAt = dayStart + Math.floor(r() * DAY);
    if (createdAt > now) continue;
    const ageDays = (now - createdAt) / DAY;
    const lines = Math.floor(r() * 3) + 1;
    const items = [];
    for (let j = 0; j < lines; j++) {
      const [sku, name, price] = pick(r, CATALOG);
      const size = sku.startsWith('AO') || sku.startsWith('QUAN') || sku.startsWith('VAY') ? pick(r, SIZES) : '';
      if (items.some((it) => it.sku === sku && it.variant === size)) continue;
      items.push({ sku, name, variant: size, quantity: Math.floor(r() * 2) + 1, price });
    }
    const roll = r();
    let status;
    if (ageDays < 0.5) status = roll < 0.3 ? 'pending' : 'to_ship';
    else if (ageDays < 2) status = roll < 0.1 ? 'cancelled' : roll < 0.6 ? 'to_ship' : 'shipping';
    else if (ageDays < 5) status = roll < 0.08 ? 'cancelled' : roll < 0.5 ? 'shipping' : 'completed';
    else status = roll < 0.07 ? 'cancelled' : roll < 0.1 ? 'returned' : 'completed';
    const shippingFee = pick(r, [0, 15000, 22000, 30000]);
    const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const id = `${seed.slice(0, 4).toUpperCase()}${new Date(createdAt).toISOString().slice(2, 10).replace(/-/g, '')}${String(i + 1).padStart(3, '0')}`;
    orders.push({
      externalId: id,
      status,
      rawStatus: status.toUpperCase(),
      total: subtotal + shippingFee,
      shippingFee,
      currency: 'VND',
      customerName: pick(r, NAMES),
      customerPhone: `09${Math.floor(r() * 1e8).toString().padStart(8, '0')}`,
      shippingAddress: `${Math.floor(r() * 300) + 1} Đường số ${Math.floor(r() * 30) + 1}, ${pick(r, CITIES)}`,
      trackingNumber: status === 'pending' ? '' : `VN${Math.floor(r() * 1e10).toString().padStart(10, '0')}`,
      carrier: pick(r, CARRIERS),
      note: r() < 0.15 ? 'Giao giờ hành chính' : '',
      createdAt,
      updatedAt: Math.min(now, createdAt + Math.floor(ageDays) * DAY),
      items,
    });
  }
  return orders;
}

module.exports = {
  id: 'demo',
  name: 'Shop demo',
  color: '#10b981',
  authType: 'apikey',
  credentialFields: [{ key: 'name', label: 'Tên shop demo', type: 'text', placeholder: 'Shop thời trang demo' }],

  isConfigured() {
    return true;
  },

  async connect(input) {
    const name = String(input.name || 'Shop demo').trim().slice(0, 80) || 'Shop demo';
    const seed = crypto.randomBytes(6).toString('hex');
    return { externalId: seed, name, credentials: { seed } };
  },

  async fetchOrders(ctx, { since }) {
    const now = Date.now();
    const seed = ctx.credentials.seed;
    const orders = [];
    // Đơn trong vài ngày gần đây vẫn đổi trạng thái -> luôn lấy lại ít nhất 7 ngày.
    const start = Math.floor(Math.min(since, now - 7 * DAY) / DAY) * DAY;
    for (let day = start; day <= now; day += DAY) orders.push(...ordersForDay(seed, day, now));
    return orders;
  },

  async fetchProducts(ctx) {
    const r = rng(`${ctx.credentials.seed}:stock`);
    return CATALOG.map(([sku, name, price]) => ({
      externalId: sku,
      sku,
      name,
      price,
      stock: Math.floor(r() * 120),
      status: 'active',
    }));
  },
};
