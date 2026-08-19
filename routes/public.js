'use strict';

const { sendHtml, redirect } = require('../lib/respond');
const { escapeHtml, addSetCookie } = require('../lib/util');
const auth = require('../lib/auth');
const { homePathFor } = require('../lib/roles');

module.exports = function (router) {
  router.get('/', (ctx) => {
    if (ctx.user) {
      redirect(ctx.res, homePathFor(ctx.user));
    } else {
      redirect(ctx.res, '/login');
    }
  });

  router.get('/login', (ctx) => {
    if (ctx.user) {
      redirect(ctx.res, homePathFor(ctx.user));
      return;
    }
    const body = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h1 class="brand-title"><img src="/static/icon-192.png" alt="" class="brand-logo">${escapeHtml(ctx.pubName)}</h1>
          <p class="muted">Staff &amp; rota portal</p>
          <form method="POST" action="/login" class="stack">
            <label>Email
              <input type="email" name="email" required autofocus placeholder="you@pub.local">
            </label>
            <label>Password
              <input type="password" name="password" required placeholder="••••••••">
            </label>
            <button type="submit" class="btn btn-primary btn-block">Log in</button>
          </form>
          <div class="demo-box">
            <strong>Demo logins</strong>
            <div>Owner: <code>manager@pub.local</code> / <code>manager123</code></div>
            <div>Staff: <code>sam@pub.local</code> / <code>staff123</code></div>
          </div>
        </div>
      </div>`;
    sendHtml(ctx, { title: 'Log in', activePath: '/login', body });
  });

  router.post('/login', async (ctx) => {
    const { email, password } = ctx.body || {};
    const user = email ? auth.findUserByEmail(email) : null;
    if (!user || !user.active || !auth.verifyPassword(password || '', user.passwordHash)) {
      const body = `
        <div class="auth-wrap">
          <div class="auth-card">
            <h1 class="brand-title"><img src="/static/icon-192.png" alt="" class="brand-logo">${escapeHtml(ctx.pubName)}</h1>
            <div class="flash flash-error">Incorrect email or password.</div>
            <form method="POST" action="/login" class="stack">
              <label>Email
                <input type="email" name="email" required autofocus value="${escapeHtml(email || '')}">
              </label>
              <label>Password
                <input type="password" name="password" required>
              </label>
              <button type="submit" class="btn btn-primary btn-block">Log in</button>
            </form>
            <div class="demo-box">
              <strong>Demo logins</strong>
              <div>Owner: <code>manager@pub.local</code> / <code>manager123</code></div>
              <div>Staff: <code>sam@pub.local</code> / <code>staff123</code></div>
            </div>
          </div>
        </div>`;
      ctx.res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(
        require('../lib/layout').page({ title: 'Log in', user: null, activePath: '/login', body, pubName: ctx.pubName })
      );
      return;
    }
    const token = auth.createSession(user.id);
    addSetCookie(ctx.res, auth.sessionCookieHeader(token));
    redirect(ctx.res, homePathFor(user));
  });

  router.post('/logout', (ctx) => {
    const token = ctx.cookies[auth.SESSION_COOKIE];
    if (token) auth.destroySession(token);
    addSetCookie(ctx.res, auth.sessionCookieHeader(null, { clear: true }));
    redirect(ctx.res, '/login');
  });
};
