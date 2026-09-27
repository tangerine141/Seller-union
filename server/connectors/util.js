'use strict';

// Trạng thái đơn chuẩn hóa, dùng chung cho mọi sàn.
const STATUSES = ['pending', 'to_ship', 'shipping', 'completed', 'cancelled', 'returned'];

class ConnectorError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.status = status;
    this.code = code;
  }
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorError(`Phản hồi không phải JSON (HTTP ${res.status})`, { status: res.status });
  }
  if (!res.ok) {
    const msg = data.message || data.msg || data.error || `HTTP ${res.status}`;
    throw new ConnectorError(String(msg), { status: res.status, code: data.code || data.error });
  }
  return data;
}

function toNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Chia mảng thành các lô kích thước n.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function joinAddress(parts) {
  return parts.filter((p) => p && String(p).trim()).join(', ');
}

module.exports = { STATUSES, ConnectorError, fetchJson, toNumber, chunk, joinAddress };
