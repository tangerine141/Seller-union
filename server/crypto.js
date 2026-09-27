'use strict';

const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function keyFrom(secret, purpose) {
  return crypto.createHash('sha256').update(`${purpose}:${secret}`).digest();
}

// Mã hóa JSON (token/API key của sàn) trước khi lưu DB.
function encryptJson(secret, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret, 'enc'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decryptJson(secret, payload) {
  if (!payload) return null;
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret, 'enc'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

// Token ngắn hạn có chữ ký, dùng cho tham số `state` của OAuth.
function signToken(secret, payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', keyFrom(secret, 'state')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', keyFrom(secret, 'state')).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return payload.exp > Date.now() ? payload : null;
}

module.exports = { hashPassword, verifyPassword, encryptJson, decryptJson, signToken, verifyToken };
