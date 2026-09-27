'use strict';

// Thêm sàn mới: tạo file connector cùng giao diện rồi đăng ký ở đây.
const connectors = [require('./shopee'), require('./lazada'), require('./tiktok'), require('./woocommerce'), require('./demo')];

const byId = new Map(connectors.map((c) => [c.id, c]));

function get(id) {
  return byId.get(id) || null;
}

function list() {
  return connectors.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    authType: c.authType,
    configured: c.isConfigured(),
    credentialFields: c.credentialFields || [],
  }));
}

module.exports = { get, list };
