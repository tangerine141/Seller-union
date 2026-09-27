import { barcodeSvg } from './barcode.js';

const PAPERS = {
  a4: { size: 'A4', w: '210mm', h: '297mm', pad: '10mm', margin: '10mm' },
  a5: { size: 'A5', w: '148mm', h: '210mm', pad: '8mm', margin: '8mm' },
  a6: { size: 'A6', w: '105mm', h: '148mm', pad: '4mm', margin: '4mm' },
  '80mm': { size: '80mm 200mm', w: '80mm', h: 'auto', pad: '3mm', margin: '2mm' },
};
const DEFAULT_PAPER = { invoice: 'a6', picklist: 'a4', manifest: 'a4' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('vi-VN');
const money = (v) => `${nf.format(Math.round(v || 0))}đ`;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
let orders = [];
let platforms = {};

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

function invoice(o) {
  const qty = o.items.reduce((n, it) => n + it.quantity, 0);
  // Đơn đã thanh toán qua sàn thì COD = 0 nhưng không biết chắc -> hiển thị tổng tiền đơn.
  return `<section class="sheet">
    <div class="row"><div><div class="label">${esc(platforms[o.platform] || o.platform)}</div><h2>${esc(o.shop_name)}</h2></div>
      <div style="text-align:right"><div class="label">Ngày đặt</div>${fmt(o.created_at)}</div></div>
    <div class="box"><div class="label">Mã đơn hàng</div>${barcodeSvg(o.external_id)}<div class="code">${esc(o.external_id)}</div></div>
    ${o.tracking_number ? `<div class="box"><div class="row"><span class="label">Mã vận đơn</span><b>${esc(o.carrier)}</b></div>${barcodeSvg(o.tracking_number)}<div class="code">${esc(o.tracking_number)}</div></div>` : o.carrier ? `<div class="box"><span class="label">ĐVVC:</span> <b>${esc(o.carrier)}</b></div>` : ''}
    <div class="box"><div class="label">Người nhận</div><div class="big">${esc(o.customer_name)}</div><div>${esc(o.customer_phone)}</div><div>${esc(o.shipping_address)}</div></div>
    <table><thead><tr><th>Sản phẩm</th><th class="c">SL</th><th class="r">Tiền</th></tr></thead><tbody>
      ${o.items.map((it) => `<tr><td>${esc(it.name)}${it.variant || it.sku ? `<div class="muted">${esc([it.sku, it.variant].filter(Boolean).join(' · '))}</div>` : ''}</td><td class="c">${it.quantity}</td><td class="r">${money(it.price * it.quantity)}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:6px"><span>Tổng ${qty} sản phẩm · Phí ship ${money(o.shipping_fee)}</span><span class="total">${money(o.total)}</span></div>
    ${o.note ? `<div class="box"><span class="label">Ghi chú:</span> ${esc(o.note)}</div>` : ''}
  </section>`;
}

function picklist() {
  const map = new Map();
  for (const o of orders) {
    for (const it of o.items) {
      const key = `${it.sku}|${it.name}|${it.variant}`;
      const row = map.get(key) || { ...it, quantity: 0, orders: 0 };
      row.quantity += it.quantity;
      row.orders += 1;
      map.set(key, row);
    }
  }
  const rows = [...map.values()].sort((a, b) => (a.sku || a.name).localeCompare(b.sku || b.name, 'vi'));
  const total = rows.reduce((n, r) => n + r.quantity, 0);
  return `<section class="sheet">
    <div class="row"><h1>Danh sách lấy hàng</h1><div>${fmt(Date.now())}</div></div>
    <p>${orders.length} đơn · ${rows.length} mã hàng · <b>${total} sản phẩm</b></p>
    <table><thead><tr><th class="c">✓</th><th>SKU</th><th>Sản phẩm</th><th>Phân loại</th><th class="c">Số đơn</th><th class="c">SL lấy</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="c" style="width:28px">☐</td><td>${esc(r.sku)}</td><td>${esc(r.name)}</td><td>${esc(r.variant)}</td><td class="c">${r.orders}</td><td class="c"><b>${r.quantity}</b></td></tr>`).join('')}
    </tbody></table>
  </section>`;
}

function manifest() {
  const groups = new Map();
  for (const o of orders) {
    const k = o.carrier || 'Chưa có ĐVVC';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  return [...groups.entries()]
    .map(([carrier, list]) => {
      const cod = list.reduce((n, o) => n + o.total, 0);
      return `<section class="sheet">
      <div class="row"><h1>Bảng kê bàn giao</h1><div>${fmt(Date.now())}</div></div>
      <p>Đơn vị vận chuyển: <b>${esc(carrier)}</b> · ${list.length} kiện · Tổng giá trị ${money(cod)}</p>
      <table><thead><tr><th class="c">STT</th><th>Mã đơn</th><th>Mã vận đơn</th><th>Shop</th><th>Người nhận</th><th class="c">SL</th><th class="r">Giá trị</th></tr></thead><tbody>
        ${list.map((o, i) => `<tr><td class="c">${i + 1}</td><td>${esc(o.external_id)}</td><td>${esc(o.tracking_number)}</td><td>${esc(o.shop_name)}</td><td>${esc(o.customer_name)}<div class="muted">${esc(o.customer_phone)}</div></td><td class="c">${o.items.reduce((n, it) => n + it.quantity, 0)}</td><td class="r">${money(o.total)}</td></tr>`).join('')}
      </tbody></table>
      <div class="sign"><div><b>Bên giao</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>Bên nhận (${esc(carrier)})</b><br><i>(Ký, ghi rõ họ tên)</i></div></div>
    </section>`;
    })
    .join('');
}

function render() {
  const type = $('type').value;
  const paper = PAPERS[$('paper').value];
  $('pageSize').textContent = `@page { size: ${paper.size}; margin: ${paper.margin}; }`;
  document.body.className = `paper-${$('paper').value}`;
  document.body.style.setProperty('--w', paper.w);
  document.body.style.setProperty('--h', paper.h);
  document.body.style.setProperty('--pad', paper.pad);
  const pages = $('pages');
  if (!orders.length) {
    pages.innerHTML = '<div class="empty">Không có đơn nào để in.</div>';
    return;
  }
  pages.innerHTML = type === 'picklist' ? picklist() : type === 'manifest' ? manifest() : orders.map(invoice).join('');
}

async function main() {
  const type = ['invoice', 'picklist', 'manifest'].includes(params.get('type')) ? params.get('type') : 'invoice';
  $('type').value = type;
  $('paper').value = params.get('paper') || store(`su-paper-${type}`) || DEFAULT_PAPER[type];

  const query = new URLSearchParams(params);
  ['type', 'paper'].forEach((k) => query.delete(k));
  query.set('limit', '5000');
  const [ordersRes, metaRes] = await Promise.all([fetch(`/api/orders?${query}`, { credentials: 'same-origin' }), fetch('/api/platforms')]);
  if (ordersRes.status === 401) {
    location.href = '/app/#/login';
    return;
  }
  const data = await ordersRes.json();
  if (!ordersRes.ok) throw new Error(data.error || 'Không tải được đơn hàng');
  orders = data.orders.sort((a, b) => a.created_at - b.created_at);
  platforms = Object.fromEntries((await metaRes.json()).platforms.map((p) => [p.id, p.name]));
  $('info').textContent = `${orders.length} đơn${data.total > orders.length ? ` (giới hạn ${orders.length}/${data.total})` : ''}`;
  render();

  $('type').addEventListener('change', () => {
    $('paper').value = store(`su-paper-${$('type').value}`) || DEFAULT_PAPER[$('type').value];
    render();
  });
  $('paper').addEventListener('change', () => {
    store(`su-paper-${$('type').value}`, $('paper').value);
    render();
  });
  $('printBtn').addEventListener('click', () => window.print());
}

main().catch((err) => {
  $('info').textContent = 'Lỗi';
  $('pages').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
});
