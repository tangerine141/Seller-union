// Seller Union — ứng dụng web một trang (không cần build).
const $root = document.getElementById('root');
const DAY = 86400000;

const state = {
  user: null,
  platforms: [],
  statuses: {},
  shops: [],
  dash: { preset: '30', shopId: '' },
  orders: { q: '', status: '', shopId: '', preset: '30', offset: 0, list: [], total: 0, counts: {}, selected: new Set() },
  products: { q: '', shopId: '', low: false },
};

// ---------- Tiện ích ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('vi-VN');
const money = (v) => `${nf.format(Math.round(v || 0))}đ`;
function compact(v) {
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)} tỷ`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}tr`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}
const pad = (n) => String(n).padStart(2, '0');
function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtAgo(ms) {
  if (!ms) return 'chưa đồng bộ';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`;
  return fmtDateTime(ms);
}
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

function rangeFrom(preset) {
  const now = Date.now();
  const today = startOfDay(now);
  const d = new Date(today);
  switch (preset) {
    case 'today': return { from: today, to: now };
    case 'month': return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now };
    case 'lastmonth': return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
    case 'all': return {};
    default: return { from: today - (Number(preset) - 1) * DAY, to: now };
  }
}
const PRESETS = [['today', 'Hôm nay'], ['7', '7 ngày'], ['30', '30 ngày'], ['month', 'Tháng này'], ['lastmonth', 'Tháng trước'], ['90', '90 ngày']];

const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false)).toString();

function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

async function api(path, { method = 'GET', body, noRedirect = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !noRedirect && !path.startsWith('/api/auth')) {
    state.user = null;
    location.hash = '#/login';
    throw new Error(data.error || 'Vui lòng đăng nhập');
  }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

const platform = (id) => state.platforms.find((p) => p.id === id) || { id, name: id, color: '#6b7280' };
const platBadge = (id) => { const p = platform(id); return `<span class="plat" style="background:${esc(p.color)}">${esc(p.name)}</span>`; };
const statusBadge = (s) => `<span class="badge st-${esc(s)}">${esc(state.statuses[s] || s)}</span>`;
const shopOptions = (selected) =>
  `<option value="">Tất cả shop</option>${state.shops.map((s) => `<option value="${s.id}" ${String(selected) === String(s.id) ? 'selected' : ''}>${esc(platform(s.platform).name)} · ${esc(s.name)}</option>`).join('')}`;

// ---------- Icon (SVG nội tuyến) ----------
const ICON = {
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  store: '<path d="M3 9l1.5-5h15L21 9M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9zM5 12v8h14v-8"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

// ---------- Khung ----------
function shell(active, content) {
  const nav = [['#/', 'chart', 'Tổng quan'], ['#/orders', 'list', 'Đơn hàng'], ['#/products', 'box', 'Sản phẩm'], ['#/shops', 'store', 'Shop']];
  $root.innerHTML = `
  <div class="shell">
    <aside class="side">
      <a class="brand" href="/"><img src="/assets/icon.svg" width="28" height="28" alt="">Seller Union</a>
      ${nav.map(([href, ic, label]) => `<a class="navlink ${active === href ? 'active' : ''}" href="${href}">${icon(ic)}<span>${label}</span></a>`).join('')}
      <div class="spacer"></div>
      <div class="userbox"><div><b>${esc(state.user?.name)}</b></div><div class="muted">${esc(state.user?.email)}</div>
        <button class="btn btn-sm" style="margin-top:8px" data-action="logout">Đăng xuất</button></div>
    </aside>
    <main class="main" id="main">${content}</main>
  </div>`;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  if ('caches' in window) (await caches.keys()).forEach((k) => caches.delete(k));
  state.user = null;
  location.hash = '#/login';
}

async function loadShops() {
  state.shops = (await api('/api/shops')).shops;
}

// ---------- Đăng nhập / đăng ký ----------
function authView(mode) {
  const isReg = mode === 'register';
  $root.innerHTML = `
  <div class="auth"><form class="card" id="authForm" novalidate>
    <a class="brand" href="/"><img src="/assets/icon.svg" width="32" height="32" alt="">Seller Union</a>
    <p class="muted center">${isReg ? 'Tạo tài khoản để gom mọi shop về một nơi' : 'Đăng nhập để quản lý shop của bạn'}</p>
    <div id="formError"></div>
    ${isReg ? '<div class="field"><label for="name">Tên của bạn</label><input class="input" id="name" name="name" autocomplete="name"></div>' : ''}
    <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Mật khẩu</label><input class="input" id="password" name="password" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" required minlength="8">
      ${isReg ? '<small class="muted">Tối thiểu 8 ký tự</small>' : ''}</div>
    <button class="btn btn-primary btn-block" type="submit">${isReg ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
    <p class="center small" style="margin-top:16px">${isReg ? 'Đã có tài khoản? <a href="#/login">Đăng nhập</a>' : 'Chưa có tài khoản? <a href="#/register">Đăng ký miễn phí</a>'}</p>
  </form></div>`;
  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      await boot();
      location.hash = isReg ? '#/shops' : '#/';
    } catch (err) {
      document.getElementById('formError').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Tổng quan ----------
function barChart(rows, width = 720) {
  const W = Math.max(300, Math.round(width)), H = 240, L = 48, R = 8, T = 12, B = 28;
  const max = Math.max(...rows.map((r) => r.revenue), 0);
  const step = niceStep(max / 4 || 1);
  const top = Math.max(step * 4, step);
  const iw = W - L - R, ih = H - T - B;
  const bw = iw / rows.length;
  const barW = Math.max(2, Math.min(28, bw * 0.7));
  const y = (v) => T + ih - (v / top) * ih;
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor(iw / 48)));
  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const cx = L + bw * i + bw / 2;
    const h = (r.revenue / top) * ih;
    const x = cx - barW / 2;
    const rad = Math.min(4, barW / 2, h);
    const y0 = T + ih;
    // Cột bo góc trên 4px, đáy phẳng trên trục.
    const path = h > 0 ? `M${x},${y0}V${y0 - h + rad}Q${x},${y0 - h} ${x + rad},${y0 - h}H${x + barW - rad}Q${x + barW},${y0 - h} ${x + barW},${y0 - h + rad}V${y0}Z` : '';
    svg += `<rect class="hit" data-i="${i}" x="${L + bw * i}" y="${T}" width="${bw}" height="${ih}" fill="transparent"/>`;
    if (path) svg += `<path class="bar" data-bar="${i}" d="${path}"/>`;
    if (i % labelEvery === 0) svg += `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${r.day.slice(8, 10)}/${r.day.slice(5, 7)}</text>`;
  });
  return `<div class="chart" id="revChart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Doanh thu theo ngày">${svg}</svg><div class="tooltip hidden"></div></div>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function bindChart(rows) {
  let box = document.getElementById('revChart');
  if (!box) return;
  // Vẽ lại theo đúng chiều rộng thực tế để chữ trên trục không bị co nhỏ.
  box.outerHTML = barChart(rows, box.clientWidth);
  box = document.getElementById('revChart');
  const tip = box.querySelector('.tooltip');
  const show = (e) => {
    const i = e.target.dataset?.i;
    box.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
    if (i === undefined) return tip.classList.add('hidden');
    const r = rows[i];
    box.querySelector(`[data-bar="${i}"]`)?.classList.add('hover');
    const rect = e.target.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    tip.innerHTML = `<b>${r.day.slice(8, 10)}/${r.day.slice(5, 7)}/${r.day.slice(0, 4)}</b><br>${money(r.revenue)} · ${r.orders} đơn`;
    tip.style.left = `${Math.min(Math.max(rect.left - br.left + rect.width / 2, 70), br.width - 70)}px`;
    tip.style.top = `${e.target.closest('svg').getBoundingClientRect().height * 0.25}px`;
    tip.classList.remove('hidden');
  };
  box.addEventListener('pointermove', show);
  box.addEventListener('pointerdown', show);
  box.addEventListener('pointerleave', () => { tip.classList.add('hidden'); box.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover')); });
}

function hbars(rows, labelFn, valueFn, fmt) {
  const max = Math.max(...rows.map(valueFn), 0) || 1;
  return rows
    .map((r) => `<div class="hbar"><div class="name">${labelFn(r)}</div><div class="track"><div class="fill" style="width:${(valueFn(r) / max) * 100}%"></div></div><div class="num">${fmt(r)}</div></div>`)
    .join('');
}

function emptyShops() {
  return `<div class="card empty"><div class="big">🛍️</div><h2>Chưa có shop nào được kết nối</h2>
    <p>Kết nối shop Shopee, Lazada, TikTok Shop, WooCommerce — hoặc tạo shop demo để xem thử.</p>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <a class="btn btn-primary" href="#/shops?add=1">${icon('plus')}Thêm shop</a>
      <button class="btn" data-action="demo">Tạo shop demo</button></div></div>`;
}

async function dashboardView() {
  shell('#/', '<div class="loading"><span class="spin"></span></div>');
  await loadShops();
  const main = document.getElementById('main');
  if (!state.shops.length) {
    main.innerHTML = `<div class="topbar"><h1>Tổng quan</h1></div>${emptyShops()}`;
    return;
  }
  const f = { ...rangeFrom(state.dash.preset), shopId: state.dash.shopId };
  const s = await api(`/api/stats?${qs(f)}`);
  const sum = s.summary;
  const statusRows = Object.keys(state.statuses).map((k) => ({ status: k, orders: s.byStatus.find((b) => b.status === k)?.orders || 0 }));
  main.innerHTML = `
    <div class="topbar"><h1>Tổng quan</h1>
      <button class="btn" data-action="syncAll">${icon('sync')}<span>Đồng bộ</span></button>
      <a class="btn" href="/api/stats/export.csv?${qs(f)}">${icon('download')}<span>Xuất CSV</span></a></div>
    <div class="filters">
      <div class="seg" role="group" aria-label="Khoảng thời gian">${PRESETS.map(([k, l]) => `<button data-preset="${k}" class="${state.dash.preset === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select class="input" id="dashShop" aria-label="Lọc theo shop">${shopOptions(state.dash.shopId)}</select>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="label">Doanh thu</div><div class="value num">${money(sum.revenue)}</div><div class="sub">Không gồm đơn hủy/hoàn</div></div>
      <div class="card kpi"><div class="label">Số đơn</div><div class="value num">${nf.format(sum.orders)}</div><div class="sub">${nf.format(sum.itemsSold)} sản phẩm đã bán</div></div>
      <div class="card kpi"><div class="label">Giá trị TB/đơn</div><div class="value num">${money(sum.avgOrderValue)}</div><div class="sub">Hoàn thành: ${money(sum.completedRevenue)}</div></div>
      <div class="card kpi"><div class="label">Cần xử lý</div><div class="value num">${nf.format(sum.toProcess)}</div><div class="sub">Tỉ lệ hủy/hoàn ${(sum.cancelRate * 100).toFixed(1)}%</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="card-head"><h2>Doanh thu theo ngày</h2></div>${barChart(s.byDay)}</div>
      <div class="card"><div class="card-head"><h2>Trạng thái đơn</h2><a class="small" href="#/orders">Xem đơn →</a></div>
        ${statusRows.map((r) => `<div class="list-row"><span>${statusBadge(r.status)}</span><b class="num">${nf.format(r.orders)}</b></div>`).join('')}</div>
    </div>
    <div class="grid2b">
      <div class="card"><h2>Doanh thu theo shop</h2>
        ${s.byShop.length ? hbars(s.byShop, (r) => `<span title="${esc(r.name)}">${esc(r.name)}</span><small>${esc(platform(r.platform).name)}</small>`, (r) => r.revenue, (r) => compact(r.revenue)) : '<p class="muted">Chưa có đơn trong khoảng này.</p>'}</div>
      <div class="card"><h2>Doanh thu theo sàn</h2>
        ${s.byPlatform.length ? hbars(s.byPlatform, (r) => esc(platform(r.platform).name), (r) => r.revenue, (r) => `${compact(r.revenue)} · ${r.orders} đơn`) : '<p class="muted">Chưa có dữ liệu.</p>'}</div>
    </div>
    <div class="grid2b">
      <div class="card"><h2>Sản phẩm bán chạy</h2>
        ${s.topProducts.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Sản phẩm</th><th class="right">SL</th><th class="right">Doanh thu</th></tr></thead><tbody>
        ${s.topProducts.map((p) => `<tr><td>${esc(p.name)}<div class="muted small">${esc(p.sku)}</div></td><td class="right num">${nf.format(p.quantity)}</td><td class="right num">${money(p.revenue)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Chưa có dữ liệu.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Sắp hết hàng</h2><a class="small" href="#/products?low=1">Xem tất cả →</a></div>
        ${s.lowStock.length ? s.lowStock.map((p) => `<div class="list-row"><span>${esc(p.name)} <span class="muted small">${esc(p.sku)} · ${esc(p.shop_name)}</span></span><b class="num" style="color:var(--bad)">${p.stock}</b></div>`).join('') : '<p class="muted">Không có sản phẩm nào sắp hết hàng. 👍</p>'}</div>
    </div>`;
  bindChart(s.byDay);
  main.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { state.dash.preset = b.dataset.preset; dashboardView(); }));
  main.querySelector('#dashShop').addEventListener('change', (e) => { state.dash.shopId = e.target.value; dashboardView(); });
}

// ---------- Đơn hàng ----------
function orderFilterParams() {
  const o = state.orders;
  return { ...rangeFrom(o.preset), q: o.q, status: o.status, shopId: o.shopId };
}

function itemsSummary(items) {
  return items.map((it) => `${esc(it.name)}${it.variant ? ` (${esc(it.variant)})` : ''} ×${it.quantity}`).join('; ');
}

function orderRows() {
  const o = state.orders;
  const table = `<div class="card table-wrap table-orders" style="padding:0"><table class="data"><thead><tr>
      <th><input type="checkbox" class="chk" id="chkAll" aria-label="Chọn tất cả" ${o.list.length && o.list.every((x) => o.selected.has(x.id)) ? 'checked' : ''}></th>
      <th>Mã đơn</th><th>Shop</th><th>Ngày đặt</th><th>Khách hàng</th><th>Sản phẩm</th><th class="right">Tổng</th><th>Trạng thái</th></tr></thead><tbody>
    ${o.list.map((x) => `<tr class="clickable" data-id="${x.id}">
      <td><input type="checkbox" class="chk" data-sel="${x.id}" ${o.selected.has(x.id) ? 'checked' : ''} aria-label="Chọn đơn ${esc(x.external_id)}"></td>
      <td><b>${esc(x.external_id)}</b>${x.tracking_number ? `<div class="muted small">${esc(x.tracking_number)}</div>` : ''}</td>
      <td>${platBadge(x.platform)}<div class="small">${esc(x.shop_name)}</div></td>
      <td class="small">${fmtDateTime(x.created_at)}</td>
      <td>${esc(x.customer_name)}<div class="muted small">${esc(x.customer_phone)}</div></td>
      <td class="items">${itemsSummary(x.items)}</td>
      <td class="right num"><b>${money(x.total)}</b></td>
      <td>${statusBadge(x.status)}</td></tr>`).join('')}
    </tbody></table></div>`;
  const cards = `<div class="card order-cards" style="padding:0">${o.list.map((x) => `
    <div class="ocard" data-id="${x.id}">
      <input type="checkbox" class="chk" data-sel="${x.id}" ${o.selected.has(x.id) ? 'checked' : ''} aria-label="Chọn đơn ${esc(x.external_id)}">
      <div><div class="top"><span>${platBadge(x.platform)} <b>${esc(x.external_id)}</b></span>${statusBadge(x.status)}</div>
        <div class="meta">${fmtDateTime(x.created_at)} · ${esc(x.shop_name)}</div>
        <div class="small">${itemsSummary(x.items)}</div>
        <div class="top"><span class="small">${esc(x.customer_name)}</span><b class="num">${money(x.total)}</b></div></div>
    </div>`).join('')}</div>`;
  return table + cards;
}

async function loadOrders(append = false) {
  const o = state.orders;
  if (!append) o.offset = 0;
  const data = await api(`/api/orders?${qs({ ...orderFilterParams(), limit: 50, offset: o.offset, withCounts: 1 })}`);
  o.list = append ? o.list.concat(data.orders) : data.orders;
  o.total = data.total;
  o.counts = data.statusCounts || {};
}

function printUrl(type, params) {
  return `/app/print.html?${qs({ type, ...params })}`;
}

function renderOrders() {
  const o = state.orders;
  const main = document.getElementById('main');
  const allCount = Object.values(o.counts).reduce((a, b) => a + b, 0);
  const sel = [...o.selected];
  const filterParams = orderFilterParams();
  const target = sel.length ? { ids: sel.join(',') } : filterParams;
  main.innerHTML = `
    <div class="topbar"><h1>Đơn hàng</h1>
      <button class="btn" data-action="syncAll">${icon('sync')}<span>Đồng bộ</span></button>
      <a class="btn" href="/api/orders/export.csv?${qs(target)}">${icon('download')}<span>Xuất CSV</span></a>
      <a class="btn" target="_blank" href="${printUrl('invoice', target)}">${icon('print')}<span>In</span></a></div>
    <div class="filters">
      <input class="input grow" id="oq" type="search" placeholder="Tìm mã đơn, khách, SĐT, sản phẩm, SKU…" value="${esc(o.q)}">
      <select class="input" id="oshop" aria-label="Lọc theo shop">${shopOptions(o.shopId)}</select>
      <select class="input" id="opreset" aria-label="Thời gian">${[...PRESETS, ['all', 'Tất cả']].map(([k, l]) => `<option value="${k}" ${o.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab ${o.status === '' ? 'on' : ''}" data-status="">Tất cả<b>${allCount}</b></button>
      ${Object.entries(state.statuses).map(([k, l]) => `<button class="tab ${o.status === k ? 'on' : ''}" data-status="${k}">${esc(l)}<b>${o.counts[k] || 0}</b></button>`).join('')}
    </div>
    ${sel.length ? `<div class="bulkbar"><span class="count">Đã chọn ${sel.length} đơn</span>
      <a class="btn btn-sm" target="_blank" href="${printUrl('invoice', target)}">Phiếu giao hàng</a>
      <a class="btn btn-sm" target="_blank" href="${printUrl('picklist', target)}">DS lấy hàng</a>
      <a class="btn btn-sm" target="_blank" href="${printUrl('manifest', target)}">Bảng kê</a>
      <a class="btn btn-sm" href="/api/orders/export.csv?${qs(target)}">CSV</a>
      <button class="btn btn-sm" data-action="clearSel">Bỏ chọn</button></div>`
      : `<div class="filters small muted">In theo bộ lọc hiện tại:
      <a target="_blank" href="${printUrl('invoice', filterParams)}">Phiếu giao hàng</a> ·
      <a target="_blank" href="${printUrl('picklist', filterParams)}">Danh sách lấy hàng</a> ·
      <a target="_blank" href="${printUrl('manifest', filterParams)}">Bảng kê bàn giao</a></div>`}
    ${o.list.length ? orderRows() : '<div class="card empty"><div class="big">📭</div>Không có đơn phù hợp.</div>'}
    ${o.list.length < o.total ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-action="more">Tải thêm (${o.list.length}/${o.total})</button></div>` : ''}
  `;

  let t;
  main.querySelector('#oq').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => { o.q = e.target.value; await loadOrders(); renderOrders(); const el = document.getElementById('oq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350);
  });
  main.querySelector('#oshop').addEventListener('change', async (e) => { o.shopId = e.target.value; o.selected.clear(); await loadOrders(); renderOrders(); });
  main.querySelector('#opreset').addEventListener('change', async (e) => { o.preset = e.target.value; o.selected.clear(); await loadOrders(); renderOrders(); });
  main.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => { o.status = b.dataset.status; o.selected.clear(); await loadOrders(); renderOrders(); }));
  main.querySelector('#chkAll')?.addEventListener('change', (e) => {
    o.list.forEach((x) => (e.target.checked ? o.selected.add(x.id) : o.selected.delete(x.id)));
    renderOrders();
  });
}

function bindOrdersMain(main) {
  const o = state.orders;
  main.addEventListener('click', async (e) => {
    const selBox = e.target.closest('[data-sel]');
    if (selBox) {
      const id = Number(selBox.dataset.sel);
      selBox.checked ? o.selected.add(id) : o.selected.delete(id);
      renderOrders();
      return;
    }
    if (e.target.closest('[data-action=more]')) { o.offset = o.list.length; await loadOrders(true); renderOrders(); return; }
    if (e.target.closest('[data-action=clearSel]')) { o.selected.clear(); renderOrders(); return; }
    const row = e.target.closest('[data-id]');
    if (row && !e.target.closest('a,button,input')) orderModal(o.list.find((x) => x.id === Number(row.dataset.id)));
  });
}

async function ordersView() {
  shell('#/orders', '<div class="loading"><span class="spin"></span></div>');
  await loadShops();
  if (!state.shops.length) {
    document.getElementById('main').innerHTML = `<div class="topbar"><h1>Đơn hàng</h1></div>${emptyShops()}`;
    return;
  }
  await loadOrders();
  bindOrdersMain(document.getElementById('main'));
  renderOrders();
}

function modal(title, body) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" aria-label="Đóng" data-close>×</button></div>${body}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  return { el: bg, close };
}

function orderModal(x) {
  if (!x) return;
  modal(`Đơn ${x.external_id}`, `
    <dl class="dl">
      <dt>Shop</dt><dd>${platBadge(x.platform)} ${esc(x.shop_name)}</dd>
      <dt>Trạng thái</dt><dd>${statusBadge(x.status)} <span class="muted small">${esc(x.raw_status)}</span></dd>
      <dt>Ngày đặt</dt><dd>${fmtDateTime(x.created_at)}</dd>
      <dt>Khách hàng</dt><dd>${esc(x.customer_name)} ${x.customer_phone ? `· <a href="tel:${esc(x.customer_phone)}">${esc(x.customer_phone)}</a>` : ''}</dd>
      <dt>Địa chỉ</dt><dd>${esc(x.shipping_address) || '—'}</dd>
      <dt>Vận chuyển</dt><dd>${esc(x.carrier) || '—'} ${x.tracking_number ? `· ${esc(x.tracking_number)}` : ''}</dd>
      ${x.note ? `<dt>Ghi chú</dt><dd>${esc(x.note)}</dd>` : ''}
    </dl>
    <div class="table-wrap"><table class="data"><thead><tr><th>Sản phẩm</th><th class="right">SL</th><th class="right">Đơn giá</th></tr></thead><tbody>
      ${x.items.map((it) => `<tr><td>${esc(it.name)}<div class="muted small">${esc([it.sku, it.variant].filter(Boolean).join(' · '))}</div></td><td class="right num">${it.quantity}</td><td class="right num">${money(it.price)}</td></tr>`).join('')}
      <tr><td>Phí vận chuyển</td><td></td><td class="right num">${money(x.shipping_fee)}</td></tr>
      <tr><td><b>Tổng cộng</b></td><td></td><td class="right num"><b>${money(x.total)}</b></td></tr>
    </tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <a class="btn btn-primary" target="_blank" href="${printUrl('invoice', { ids: x.id })}">${icon('print')}In phiếu giao hàng</a>
      <button class="btn" data-close>Đóng</button></div>`);
}

// ---------- Sản phẩm ----------
async function productsView() {
  shell('#/products', '<div class="loading"><span class="spin"></span></div>');
  await loadShops();
  const p = state.products;
  const params = { q: p.q, shopId: p.shopId, lowStock: p.low ? 5 : '' };
  const { products } = await api(`/api/products?${qs(params)}`);
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="topbar"><h1>Sản phẩm & tồn kho</h1>
      <a class="btn" href="/api/products/export.csv?${qs(params)}">${icon('download')}<span>Xuất CSV</span></a></div>
    <div class="filters">
      <input class="input grow" id="pq" type="search" placeholder="Tìm tên sản phẩm, SKU…" value="${esc(p.q)}">
      <select class="input" id="pshop" aria-label="Lọc theo shop">${shopOptions(p.shopId)}</select>
      <label class="btn"><input type="checkbox" class="chk" id="plow" ${p.low ? 'checked' : ''}> Sắp hết (≤ 5)</label>
    </div>
    ${products.length ? `<div class="card table-wrap" style="padding:0"><table class="data"><thead><tr><th>Sản phẩm</th><th>Shop</th><th class="right">Giá</th><th class="right">Tồn</th></tr></thead><tbody>
      ${products.map((x) => `<tr><td>${esc(x.name)}<div class="muted small">${esc(x.sku)}</div></td><td>${platBadge(x.platform)}<div class="small">${esc(x.shop_name)}</div></td>
        <td class="right num">${money(x.price)}</td><td class="right num" ${x.stock <= 5 ? 'style="color:var(--bad);font-weight:700"' : ''}>${nf.format(x.stock)}</td></tr>`).join('')}
    </tbody></table></div><p class="muted small">${products.length} sản phẩm</p>` : '<div class="card empty"><div class="big">📦</div>Không có sản phẩm phù hợp.</div>'}`;
  let t;
  main.querySelector('#pq').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => { p.q = e.target.value; await productsView(); const el = document.getElementById('pq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350);
  });
  main.querySelector('#pshop').addEventListener('change', (e) => { p.shopId = e.target.value; productsView(); });
  main.querySelector('#plow').addEventListener('change', (e) => { p.low = e.target.checked; productsView(); });
}

// ---------- Shop ----------
async function shopsView(params) {
  shell('#/shops', '<div class="loading"><span class="spin"></span></div>');
  if (params.get('connected')) toast(`Đã kết nối ${params.get('connected')}. Đang đồng bộ dữ liệu…`);
  if (params.get('error')) toast(params.get('error'), 6000);
  if (params.get('connected') || params.get('error')) history.replaceState(null, '', '#/shops');
  await loadShops();
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="topbar"><h1>Shop đã kết nối</h1>
      ${state.shops.length ? `<button class="btn" data-action="syncAll">${icon('sync')}<span>Đồng bộ tất cả</span></button>` : ''}
      <button class="btn btn-primary" data-action="addShop">${icon('plus')}<span>Thêm shop</span></button></div>
    ${state.shops.length ? `<div class="shops">${state.shops.map((s) => `
      <div class="card shop-card">
        <div class="row">${platBadge(s.platform)}<span class="badge ${s.status === 'error' ? 'st-cancelled' : 'st-completed'}">${s.status === 'error' ? 'Lỗi' : 'Hoạt động'}</span></div>
        <b>${esc(s.name)}</b>
        <div class="muted small">${nf.format(s.order_count)} đơn · ${nf.format(s.product_count)} sản phẩm · Đồng bộ ${fmtAgo(s.last_sync_at)}</div>
        ${s.last_sync_error ? `<div class="err">${esc(s.last_sync_error)}</div>` : ''}
        <div class="actions">
          <button class="btn btn-sm" data-sync="${s.id}">${icon('sync')}Đồng bộ</button>
          <button class="btn btn-sm" data-rename="${s.id}">Đổi tên</button>
          <button class="btn btn-sm btn-danger" data-del="${s.id}">Xóa</button>
        </div>
      </div>`).join('')}</div>` : emptyShops()}
    <div class="card" style="margin-top:24px">
      <h2>Tài khoản</h2>
      <p class="muted small" style="margin:0 0 8px">${esc(state.user?.name)} · ${esc(state.user?.email)}</p>
      <button class="btn btn-sm" data-action="logout">Đăng xuất</button>
      <p class="muted small">Mẹo: trên điện thoại, chọn “Thêm vào màn hình chính” để dùng như ứng dụng.</p>
    </div>`;

  main.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span> Đang đồng bộ';
    try { const r = await api(`/api/shops/${b.dataset.sync}/sync`, { method: 'POST' }); toast(`Đã đồng bộ ${r.orders ?? 0} đơn, ${r.products ?? 0} sản phẩm`); } catch (err) { toast(err.message, 5000); }
    shopsView(new URLSearchParams());
  }));
  main.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const shop = state.shops.find((s) => s.id === Number(b.dataset.rename));
    const name = prompt('Tên mới cho shop', shop.name);
    if (!name) return;
    try { await api(`/api/shops/${shop.id}`, { method: 'PATCH', body: { name } }); shopsView(new URLSearchParams()); } catch (err) { toast(err.message); }
  }));
  main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const shop = state.shops.find((s) => s.id === Number(b.dataset.del));
    if (!confirm(`Xóa shop "${shop.name}" cùng toàn bộ đơn hàng đã đồng bộ? (Dữ liệu trên sàn không bị ảnh hưởng)`)) return;
    try { await api(`/api/shops/${shop.id}`, { method: 'DELETE' }); toast('Đã xóa shop'); shopsView(new URLSearchParams()); } catch (err) { toast(err.message); }
  }));
  if (params.get('add')) addShopModal();
}

// Tóm tắt cách tạo app trên từng sàn (bản đầy đủ: /huong-dan-ket-noi).
const APP_GUIDE = {
  shopee: {
    portal: 'https://open.shopee.com',
    steps: [
      'Vào <b>open.shopee.com</b>, đăng nhập bằng tài khoản người bán, chọn loại tài khoản <b>Shopee Seller</b> (cần CCCD).',
      'Khi được duyệt: <b>Console → App List → Create App</b>.',
      'Trong cài đặt app, khai báo <b>Redirect URL</b> bên dưới và bật quyền <b>Order</b>, <b>Product</b>.',
      'Sao chép <b>Partner ID</b> và <b>Partner Key</b> dán vào đây.',
    ],
  },
  lazada: {
    portal: 'https://open.lazada.com',
    steps: [
      'Vào <b>open.lazada.com</b>, đăng ký làm Developer.',
      '<b>App Console → Create</b>, chọn loại <b>Seller In-house APP</b>.',
      'Ô <b>Callback URL</b> dán đúng địa chỉ bên dưới.',
      'Vào <b>Manage → Advance information</b>, sao chép <b>App Key</b> và <b>App Secret</b>.',
    ],
  },
  tiktok: {
    portal: 'https://partner.tiktokshop.com',
    steps: [
      'Vào <b>partner.tiktokshop.com</b>, đăng ký tài khoản đối tác.',
      '<b>App & Service → Create</b>, chọn <b>Custom App</b>, thị trường Việt Nam.',
      'Ô <b>Redirect URL</b> dán địa chỉ bên dưới, bật quyền <b>Order</b> và <b>Product</b>.',
      'Sao chép <b>App Key</b>, <b>App Secret</b>, <b>Service ID</b> dán vào đây.',
    ],
  },
};

async function oauthPanel(p, box, m) {
  const { apps } = await api('/api/connect/apps');
  const hasOwn = Boolean(apps[p.id]);
  const redirectUrl = `${location.origin}/connect/${p.id}/callback`;
  const guide = APP_GUIDE[p.id];
  const go = async (own) => {
    const { url } = await api(`/api/connect/${p.id}/authorize${own ? '?own=1' : ''}`);
    location.href = url;
  };
  box.innerHTML = `<div style="margin-top:16px">
    ${p.configured ? `<button class="btn btn-primary btn-block" id="useShared">Kết nối ${esc(p.name)}</button>
      <p class="muted small center" style="margin:8px 0 0">hoặc dùng key riêng của shop bạn:</p>` : ''}
    <h2 style="margin-top:12px">Kết nối bằng key riêng</h2>
    ${hasOwn ? `<p class="small">✅ Bạn đã lưu key ${esc(p.name)}. <button class="btn btn-sm btn-primary" id="useOwn">Kết nối ngay</button>
      <button class="btn btn-sm" id="editOwn">Nhập lại key</button> <button class="btn btn-sm btn-danger" id="delOwn">Xóa key</button></p>` : ''}
    <form id="ownForm" class="${hasOwn ? 'hidden' : ''}">
      <ol class="small" style="padding-left:18px;margin:0 0 12px">${guide.steps.map((x) => `<li style="margin-bottom:4px">${x}</li>`).join('')}</ol>
      <div class="field"><label>Redirect / Callback URL</label>
        <div style="display:flex;gap:6px"><input class="input" id="redir" readonly value="${esc(redirectUrl)}"><button class="btn" type="button" id="copyRedir">Chép</button></div></div>
      ${p.appFields.map((f) => f.type === 'checkbox'
        ? `<label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" class="chk" name="${f.key}" id="a-${f.key}"> ${esc(f.label)}</label>`
        : `<div class="field"><label for="a-${f.key}">${esc(f.label)}</label><input class="input" id="a-${f.key}" name="${f.key}" type="${f.type}" placeholder="${esc(f.placeholder || '')}" required autocomplete="off"></div>`).join('')}
      <div id="ownErr"></div>
      <button class="btn btn-primary btn-block" type="submit">Lưu key &amp; kết nối</button>
      <p class="muted small" style="margin-bottom:0">Key được mã hóa trên máy chủ và chỉ dùng cho shop của bạn. <a href="/huong-dan-ket-noi#${p.id}" target="_blank">Hướng dẫn chi tiết</a></p>
    </form></div>`;
  const err = (e) => { box.querySelector('#ownErr').innerHTML = `<div class="form-error">${esc(e.message)}</div>`; };
  box.querySelector('#useShared')?.addEventListener('click', () => go(false).catch((e) => toast(e.message, 5000)));
  box.querySelector('#useOwn')?.addEventListener('click', () => go(true).catch((e) => toast(e.message, 5000)));
  box.querySelector('#editOwn')?.addEventListener('click', () => box.querySelector('#ownForm').classList.remove('hidden'));
  box.querySelector('#delOwn')?.addEventListener('click', async () => {
    await api(`/api/connect/${p.id}/app`, { method: 'DELETE' });
    toast('Đã xóa key');
    oauthPanel(p, box, m);
  });
  box.querySelector('#copyRedir').addEventListener('click', async () => {
    const input = box.querySelector('#redir');
    try { await navigator.clipboard.writeText(input.value); toast('Đã chép'); } catch { input.select(); }
  });
  box.querySelector('#ownForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(`/api/connect/${p.id}/app`, { method: 'PUT', body });
      await go(true);
    } catch (e2) {
      err(e2);
      btn.disabled = false;
    }
  });
}

function addShopModal() {
  const PLAT_DESC = { shopee: 'Ủy quyền qua Shopee Open Platform', lazada: 'Ủy quyền qua Lazada Open Platform', tiktok: 'Ủy quyền qua TikTok Shop Partner', woocommerce: 'Dùng REST API key của website', demo: 'Dữ liệu mẫu để dùng thử' };
  const m = modal('Thêm shop', `<p class="muted small" style="margin-top:0">Chọn sàn bạn muốn kết nối:</p>
    <div class="plat-grid">${state.platforms.map((p) => `<button class="plat-opt" data-plat="${p.id}"><span class="plat" style="background:${esc(p.color)}">${esc(p.name)}</span><small>${PLAT_DESC[p.id] || ''}</small></button>`).join('')}</div>
    <div id="platForm"></div>`);
  m.el.querySelectorAll('[data-plat]').forEach((b) => b.addEventListener('click', async () => {
    const p = platform(b.dataset.plat);
    const box = m.el.querySelector('#platForm');
    if (p.authType === 'oauth') {
      try {
        await oauthPanel(p, box, m);
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        box.innerHTML = `<div class="form-error" style="margin-top:12px">${esc(err.message)}</div>`;
      }
      return;
    }
    box.innerHTML = `<form id="keyForm" style="margin-top:16px"><h2>Kết nối ${esc(p.name)}</h2>
      ${p.credentialFields.map((f) => `<div class="field"><label for="f-${f.key}">${esc(f.label)}</label><input class="input" id="f-${f.key}" name="${f.key}" type="${f.type}" placeholder="${esc(f.placeholder || '')}" ${f.key !== 'name' ? 'required' : ''} autocomplete="off"></div>`).join('')}
      <div id="keyErr"></div><button class="btn btn-primary btn-block" type="submit">Kết nối</button></form>`;
    box.querySelector('#keyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span> Đang kết nối & đồng bộ…';
      try {
        await api('/api/shops', { method: 'POST', body: { platform: p.id, ...Object.fromEntries(new FormData(e.target)) } });
        m.close();
        toast('Kết nối thành công');
        location.hash = '#/shops';
        shopsView(new URLSearchParams());
      } catch (err) {
        box.querySelector('#keyErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Kết nối';
      }
    });
  }));
}

// ---------- Hành động chung ----------
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'logout') return logout();
  if (act === 'addShop') return addShopModal();
  if (act === 'demo') {
    a.disabled = true;
    try {
      await api('/api/shops', { method: 'POST', body: { platform: 'demo', name: 'Shop demo' } });
      toast('Đã tạo shop demo với dữ liệu 30 ngày');
      route();
    } catch (err) { toast(err.message); a.disabled = false; }
  }
  if (act === 'syncAll') {
    a.disabled = true;
    a.innerHTML = '<span class="spin"></span><span>Đang đồng bộ</span>';
    try {
      const { results } = await api('/api/sync', { method: 'POST' });
      const failed = results.filter((r) => !r.ok).length;
      toast(failed ? `Đồng bộ xong, ${failed} shop lỗi` : 'Đồng bộ xong');
    } catch (err) { toast(err.message); }
    route();
  }
});

// ---------- Router ----------
async function route() {
  const [path, query] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  if (path === '/login' || path === '/register') {
    if (state.user) { location.hash = '#/'; return; }
    return authView(path.slice(1));
  }
  if (!state.user) { location.hash = '#/login'; return; }
  try {
    if (path === '/orders') return await ordersView();
    if (path === '/products') { if (params.get('low')) state.products.low = true; return await productsView(); }
    if (path === '/shops') return await shopsView(params);
    return await dashboardView();
  } catch (err) {
    const main = document.getElementById('main');
    if (main) main.innerHTML = `<div class="card empty"><div class="big">⚠️</div>${esc(err.message)}<div style="margin-top:12px"><button class="btn" onclick="location.reload()">Thử lại</button></div></div>`;
  }
}

async function boot() {
  const meta = await api('/api/platforms');
  state.platforms = meta.platforms;
  state.statuses = meta.statuses;
  // Không tự chuyển trang ở đây để link #/register từ trang chủ vẫn mở đúng form đăng ký.
  try { state.user = (await api('/api/me', { noRedirect: true })).user; } catch { state.user = null; }
}

window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
boot().then(route).catch((err) => { $root.innerHTML = `<div class="empty">Không tải được ứng dụng: ${esc(err.message)}</div>`; });
