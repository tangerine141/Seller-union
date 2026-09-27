'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const env = process.env;

function int(name, fallback) {
  const v = parseInt(env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

const isProd = env.NODE_ENV === 'production';

// APP_SECRET ký phiên đăng nhập và mã hóa token của các sàn. Bắt buộc ở production.
let appSecret = env.APP_SECRET;
if (!appSecret) {
  if (isProd) {
    throw new Error('Thiếu biến môi trường APP_SECRET (chuỗi ngẫu nhiên >= 32 ký tự).');
  }
  appSecret = 'dev-only-secret-change-me-' + crypto.createHash('sha256').update(__dirname).digest('hex');
}

module.exports = {
  isProd,
  port: int('PORT', 3000),
  siteUrl: (env.SITE_URL || `http://localhost:${int('PORT', 3000)}`).replace(/\/$/, ''),
  siteName: env.SITE_NAME || 'Seller Union',
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'seller-union.db'),
  appSecret,
  // Tự động đồng bộ định kỳ (phút). 0 = tắt.
  autoSyncMinutes: int('AUTO_SYNC_MINUTES', 15),
  // Lần đồng bộ đầu tiên lấy đơn trong bao nhiêu ngày gần nhất.
  initialSyncDays: int('INITIAL_SYNC_DAYS', 30),
  // Múi giờ dùng để gom thống kê theo ngày (phút so với UTC). Mặc định GMT+7.
  tzOffsetMinutes: int('TZ_OFFSET_MINUTES', 420),

  shopee: {
    partnerId: env.SHOPEE_PARTNER_ID || '',
    partnerKey: env.SHOPEE_PARTNER_KEY || '',
    host: env.SHOPEE_HOST || 'https://partner.shopeemobile.com',
  },
  lazada: {
    appKey: env.LAZADA_APP_KEY || '',
    appSecret: env.LAZADA_APP_SECRET || '',
    apiHost: env.LAZADA_API_HOST || 'https://api.lazada.vn/rest',
    authHost: env.LAZADA_AUTH_HOST || 'https://auth.lazada.com',
  },
  tiktok: {
    appKey: env.TIKTOK_APP_KEY || '',
    appSecret: env.TIKTOK_APP_SECRET || '',
    serviceId: env.TIKTOK_SERVICE_ID || '',
    apiHost: env.TIKTOK_API_HOST || 'https://open-api.tiktokglobalshop.com',
    authHost: env.TIKTOK_AUTH_HOST || 'https://auth.tiktok-shops.com',
    authorizeUrl: env.TIKTOK_AUTHORIZE_URL || 'https://services.tiktokshop.com/open/authorize',
  },
};
