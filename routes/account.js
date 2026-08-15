'use strict';

const { sendHtml, redirect } = require('../lib/respond');
const { escapeHtml } = require('../lib/util');
const auth = require('../lib/auth');
const { hashPassword } = require('../lib/db');

module.exports = function (router) {
  router.get('/account', (ctx) => {
    if (!ctx.user) {
      redirect(ctx.res, '/login');
      return;
    }
    const homePath = ctx.user.role === 'manager' ? '/manager' : '/staff';
    const body = `
      <div class="page-head"><h1>My account</h1></div>
      <div class="card">
        <h2>${escapeHtml(ctx.user.name)}</h2>
        <p class="muted">${escapeHtml(ctx.user.email)} · ${escapeHtml(ctx.user.role === 'manager' ? 'Manager' : ctx.user.position || 'Staff')}</p>
      </div>
      <div class="card">
        <h2>Change password</h2>
        <form method="POST" action="/account/password" class="stack">
          <label>Current password<input type="password" name="currentPassword" required autocomplete="current-password"></label>
          <label>New password<input type="password" name="newPassword" required minlength="6" autocomplete="new-password"></label>
          <label>Confirm new password<input type="password" name="confirmPassword" required minlength="6" autocomplete="new-password"></label>
          <button type="submit" class="btn btn-primary">Update password</button>
        </form>
      </div>
      <a class="btn" href="${homePath}">← Back</a>`;
    sendHtml(ctx, { title: 'My account', activePath: '/account', body });
  });

  router.post('/account/password', (ctx) => {
    if (!ctx.user) {
      redirect(ctx.res, '/login');
      return;
    }
    const { currentPassword, newPassword, confirmPassword } = ctx.body || {};
    if (!auth.verifyPassword(currentPassword || '', ctx.user.passwordHash)) {
      redirect(ctx.res, '/account', { type: 'error', message: 'Current password is incorrect.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      redirect(ctx.res, '/account', { type: 'error', message: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      redirect(ctx.res, '/account', { type: 'error', message: 'New password and confirmation do not match.' });
      return;
    }
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.user.id);
    u.passwordHash = hashPassword(newPassword);
    ctx.db.save(data);
    redirect(ctx.res, '/account', { type: 'success', message: 'Password updated.' });
  });
};
