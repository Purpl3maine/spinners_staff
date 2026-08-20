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

// Minimal multipart/form-data parser (no dependencies) for file uploads.
// Returns { fields: {name: value}, files: {name: {filename, contentType, data:Buffer}} }.
// Only handles single (non-array) fields/files per name, which is all this app needs.
function parseMultipartBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      reject(new Error('Missing multipart boundary'));
      return;
    }
    const boundary = Buffer.from('--' + (boundaryMatch[1] || boundaryMatch[2]));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Upload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const fields = {};
        const files = {};
        let start = buf.indexOf(boundary, 0);
        while (start !== -1) {
          const afterBoundary = start + boundary.length;
          if (buf.slice(afterBoundary, afterBoundary + 2).toString() === '--') break; // terminal boundary
          const nextStart = buf.indexOf(boundary, afterBoundary);
          if (nextStart === -1) break;
          let partStart = afterBoundary;
          if (buf.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
          let partEnd = nextStart;
          if (buf.slice(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2;
          const part = buf.slice(partStart, partEnd);
          const headerEndIdx = part.indexOf('\r\n\r\n');
          if (headerEndIdx !== -1) {
            const headerStr = part.slice(0, headerEndIdx).toString('utf8');
            const content = part.slice(headerEndIdx + 4);
            const nameMatch = headerStr.match(/name="([^"]*)"/i);
            const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
            const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
            const name = nameMatch ? nameMatch[1] : null;
            if (name) {
              if (filenameMatch && filenameMatch[1]) {
                if (filenameMatch[1]) {
                  files[name] = {
                    filename: filenameMatch[1],
                    contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
                    data: content,
                  };
                }
              } else {
                fields[name] = content.toString('utf8');
              }
            }
          }
          start = nextStart;
        }
        resolve({ fields, files });
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
  // Explicit UK timezone — without this it falls back to the server's own
  // timezone (UTC on Railway), which shows times an hour behind during
  // British Summer Time. Europe/London handles the GMT/BST switch itself.
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

// Current UK wall-clock time as "HH:MM" (24-hour), for defaulting
// <input type="time"> fields — same Europe/London reasoning as fmtTimeLabel.
function nowTimeLabelUK() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
}

// The calendar date (YYYY-MM-DD) a UTC timestamp falls on in the UK — NOT
// the same as iso.slice(0, 10), which reads the UTC date and can be a day
// off for events shortly after midnight UK time during BST (e.g. 00:30 BST
// on the 2nd is still 23:30 UTC on the 1st). Use this whenever a clock
// event's timestamp needs to be shown/grouped by the day staff experienced.
function londonDateKey(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

// How far Europe/London is ahead of UTC (in minutes) at a given instant —
// 60 during British Summer Time, 0 during GMT. Works by asking Intl what
// that UTC instant looks like when displayed in London, then comparing.
function londonOffsetMinutes(utcDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/London',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(utcDate)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asIfUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asIfUTC - utcDate.getTime()) / 60000);
}

// Converts a manager-entered UK wall-clock date+time (e.g. from a manual
// clock in/out form — "2026-08-19" + "14:30", meant as 2:30pm in the pub,
// not UTC) into the correct UTC ISO timestamp, accounting for BST/GMT.
// Naively appending "Z" to those values is wrong during BST — it stores an
// hour early — which is what caused clock times to display incorrectly.
function londonWallTimeToISO(dateStr, timeStr) {
  const guessUTC = new Date(`${dateStr}T${timeStr}:00.000Z`);
  const offsetMin = londonOffsetMinutes(guessUTC);
  return new Date(guessUTC.getTime() - offsetMin * 60000).toISOString();
}

// Quotes a single CSV field per RFC 4180: wraps it in double quotes and
// doubles up any internal quotes. Always quotes (not just when "needed")
// since that's simplest and never wrong — Excel/Sheets handle it fine.
function csvField(value) {
  const str = value === undefined || value === null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// Builds a full CSV document from an array of rows (each row an array of
// values). Uses CRLF line endings and a leading UTF-8 BOM — both are
// specifically for Excel: it assumes plain CSV is Windows-1252 without the
// BOM, which mangles the £ sign and other non-ASCII characters otherwise.
function toCsv(rows) {
  const BOM = String.fromCharCode(0xfeff);
  const body = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
  return BOM + body + '\r\n';
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
  parseMultipartBody,
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
  nowTimeLabelUK,
  londonDateKey,
  londonWallTimeToISO,
  csvField,
  toCsv,
};
