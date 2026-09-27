'use strict';

// CSV UTF-8 có BOM để Excel hiển thị đúng tiếng Việt.
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  // Chặn CSV injection: ô bắt đầu bằng = + - @ bị Excel hiểu là công thức.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv };
