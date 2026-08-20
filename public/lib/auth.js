'use strict';

const crypto = require('crypto');
const db = require('./db');
const { uuid } = require('./util');

const SESSION_COOKIE = 'pubshift_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// In-memory session store. A restart logs everyone out — acceptable for a prototype.
const sessions = new Map();

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function findUserByEmail(email) {
  const data = db.load();
  return data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

function createSession(userId) {
  const token = uuid();
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function getUserFromRequest(req, cookies) {
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const data = db.load();
  const user = data.users.find((u) => u.id === session.userId && u.active);
  return user || null;
}

function sessionCookieHeader(token, { clear = false } = {}) {
  if (clear) {
    return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
  }
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

module.exports = {
  SESSION_COOKIE,
  verifyPassword,
  findUserByEmail,
  createSession,
  destroySession,
  getUserFromRequest,
  sessionCookieHeader,
};
