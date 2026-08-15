'use strict';

const crypto = require('crypto');

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uuid() {
  return crypto.randomUUID();
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      try {
        if (contentType.includes('application/json')) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          // application/x-www-form-urlencoded (default for our forms)
          const params = new URLSearchParams(data);
          const out = {};
          for (const [key, value] of params.entries()) out[key] = value;
          resolve(out);
        }
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// --- Date helpers ---
// All dates are stored/compared as ISO strings "YYYY-MM-DD" (local/pub time, no timezone math).

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function startOfWeek(dateStr) {
  // Monday as first day of week
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function fullDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function daysBetweenInclusive(startStr, endStr) {
  const a = new Date(startStr + 'T00:00:00Z');
  const b = new Date(endStr + 'T00:00:00Z');
  const diff = Math.round((b - a) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

function hoursBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  return Math.max(0, ms / 3600000);
}

function fmtHours(h) {
  return (Math.round(h * 100) / 100).toFixed(2);
}

function fmtMoney(n) {
  return '£' + (Math.round(n * 100) / 100).toFixed(2);
}

function fmtTimeLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function addSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [existing, cookieStr]);
  }
}

module.exports = {
  escapeHtml,
  uuid,
  parseCookies,
  parseBody,
  addSetCookie,
  todayISO,
  nowISO,
  startOfWeek,
  addDays,
  dayLabel,
  fullDateLabel,
  daysBetweenInclusive,
  hoursBetween,
  fmtHours,
  fmtMoney,
  fmtTimeLabel,
};
