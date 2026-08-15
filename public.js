'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { parseCookies, parseBody, addSetCookie } = require('./lib/util');
const { getUserFromRequest } = require('./lib/auth');
const db = require('./lib/db');

const PORT = process.env.PORT || 3000;

// ---------- tiny router ----------
const routes = []; // { method, regex, paramNames, handler }

function addRoute(method, pattern, handler) {
  const paramNames = [];
  const regexStr =
    '^' +
    pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          paramNames.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/') +
    '$';
  routes.push({ method, regex: new RegExp(regexStr), paramNames, handler });
}

const router = {
  get: (p, h) => addRoute('GET', p, h),
  post: (p, h) => addRoute('POST', p, h),
};

require('./routes/public')(router);
require('./routes/account')(router);
require('./routes/staff')(router);
require('./routes/manager')(router);

// ---------- static file serving ----------
const STATIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/static\//, '');
  const filePath = path.join(STATIC_DIR, rel);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------- request handling ----------
async function handle(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (pathname.startsWith('/static/')) {
    if (serveStatic(req, res, pathname)) return;
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const cookies = parseCookies(req);
  const user = getUserFromRequest(req, cookies);

  // consume flash cookie (one-time message set by redirect())
  let flash = null;
  if (cookies.pubshift_flash) {
    try {
      flash = JSON.parse(cookies.pubshift_flash);
    } catch (e) {
      flash = null;
    }
  }

  const ctx = {
    req,
    res,
    url: parsedUrl,
    query: Object.fromEntries(parsedUrl.searchParams.entries()),
    cookies,
    user,
    flash,
    db,
    pubName: db.load().settings.pubName,
  };

  if (req.method === 'POST') {
    try {
      ctx.body = await parseBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request: ' + err.message);
      return;
    }
  }

  // clear flash cookie after reading it, unless the handler sets a new one via redirect()
  if (cookies.pubshift_flash) {
    addSetCookie(res, 'pubshift_flash=; Path=/; Max-Age=0; SameSite=Lax');
  }

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = route.regex.exec(pathname);
    if (!match) continue;
    const params = {};
    route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
    ctx.params = params;
    try {
      await route.handler(ctx);
    } catch (err) {
      console.error('Handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Something went wrong: ' + err.message);
      }
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Server error');
    }
  });
});

server.listen(PORT, () => {
  console.log(`PubShift running at http://localhost:${PORT}`);
  console.log(`Demo manager login: manager@pub.local / manager123`);
  console.log(`Demo staff login:   sam@pub.local / staff123`);
});
