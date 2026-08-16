'use strict';

const { page, redirect } = require('./layout');

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
function requireRole(ctx, role) {
  if (!ctx.user) {
    redirect(ctx.res, '/login');
    return true;
  }
  if (ctx.user.role !== role) {
    redirect(ctx.res, ctx.user.role === 'manager' ? '/manager' : '/staff');
    return true;
  }
  return false;
}

module.exports = { sendHtml, redirect, requireRole };
