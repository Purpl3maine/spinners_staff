'use strict';

const { page, redirect } = require('./layout');
const { homePathFor } = require('./roles');

function sendHtml(ctx, { title, activePath, body }) {
  const html = page({
    title,
    user: ctx.user,
    activePath,
    body,
    pubName: ctx.pubName,
    flash: ctx.flash,
  });
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(html);
}

// Returns true if the request was redirected away (caller must stop processing).
// 'manager' means "manager or owner" (owners get everything a manager can
// do, plus more) — 'staff' and 'owner' require an exact match.
function requireRole(ctx, role) {
  if (!ctx.user) {
    redirect(ctx.res, '/login');
    return true;
  }
  const ok = role === 'manager' ? ctx.user.role === 'manager' || ctx.user.role === 'owner' : ctx.user.role === role;
  if (!ok) {
    redirect(ctx.res, homePathFor(ctx.user));
    return true;
  }
  return false;
}

module.exports = { sendHtml, redirect, requireRole };
