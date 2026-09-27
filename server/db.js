'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  credentials TEXT,           -- JSON đã mã hóa AES-256-GCM
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at INTEGER,
  last_sync_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_status TEXT,
  total REAL NOT NULL DEFAULT 0,
  shipping_fee REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'VND',
  customer_name TEXT,
  customer_phone TEXT,
  shipping_address TEXT,
  tracking_number TEXT,
  carrier TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (shop_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  variant TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (shop_id, external_id)
);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Chạy fn trong một transaction; rollback nếu lỗi.
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, tx };
