'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../server/services/csv');

test('CSV có BOM, escape dấu phẩy/nháy và chặn công thức Excel', () => {
  const csv = toCsv(
    [{ label: 'Tên', value: 'name' }, { label: 'Số', value: (r) => r.n }],
    [{ name: 'Áo "đẹp", size M', n: 1 }, { name: '=HYPERLINK("x")', n: -5 }]
  );
  assert.ok(csv.startsWith('﻿Tên,Số\r\n'));
  assert.match(csv, /"Áo ""đẹp"", size M",1/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)",-5/);
});
