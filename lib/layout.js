'use strict';

const { escapeHtml, addSetCookie } = require('./util');
const { roleLabel, homePathFor } = require('./roles');

const STAFF_NAV = [
  { href: '/staff', label: 'Clock', icon: '⏱' },
  { href: '/staff/schedule', label: 'Schedule', icon: '📅' },
  { href: '/staff/timesheet', label: 'Timesheet', icon: '🧾' },
  { href: '/staff/time-off', label: 'Time off', icon: '🌴' },
];

const MANAGER_NAV = [
  { href: '/manager', label: 'Dashboard', icon: '🏠' },
  { href: '/manager/rota', label: 'Rota', icon: '📅' },
  { href: '/manager/staff', label: 'Staff', icon: '👥' },
  { href: '/manager/departments', label: 'Departments', icon: '🏷️' },
  { href: '/manager/requests', label: 'Requests', icon: '🌴' },
  { href: '/manager/holiday', label: 'Holiday', icon: '📊' },
  { href: '/manager/timesheets', label: 'Timesheets', icon: '🧾' },
];

// Managers often work paid shifts themselves (e.g. a duty manager on the
// bar), so they get their own "Clock in/out" link too — the same personal
// clock page staff use, via /staff. The owner doesn't get this: that
// account is treated as admin-only, same as elsewhere in the app.
const MANAGER_CLOCK_ITEM = { href: '/staff', label: 'Clock in/out', icon: '⏱' };

function navFor(user) {
  if (user.role === 'owner') return MANAGER_NAV;
  if (user.role === 'manager') return [MANAGER_NAV[0], MANAGER_CLOCK_ITEM, ...MANAGER_NAV.slice(1)];
  return STAFF_NAV;
}

function page({ title, user, activePath, body, pubName = 'PubShift', flash = null, showInstallTip = false }) {
  const nav = user ? navFor(user) : [];
  const navHtml = nav
    .map((item) => {
      const active = item.href === activePath ? ' class="nav-link active"' : ' class="nav-link"';
      return `<a href="${item.href}"${active}><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${escapeHtml(item.label)}</span></a>`;
    })
    .join('\n');

  const flashHtml = flash
    ? `<div class="flash flash-${escapeHtml(flash.type || 'info')}">${escapeHtml(flash.message)}</div>`
    : '';

  const installTipHtml =
    showInstallTip && user
      ? `<div class="install-tip" data-install-tip>
          <button type="button" class="install-tip-close" data-install-tip-dismiss aria-label="Dismiss">×</button>
          <p data-platform="ios">📱 <strong>Get this on your Home Screen:</strong> tap the Share icon in Safari, then <strong>Add to Home Screen</strong>. It'll open full-screen like an app.</p>
          <p data-platform="android">📱 <strong>Get this on your Home Screen:</strong> tap the ⋮ menu in Chrome, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>). It'll open full-screen like an app.</p>
          <p data-platform="desktop">💻 Look for an install icon in your browser's address bar to add this as an app — or open this page on your phone for a Home Screen shortcut.</p>
        </div>`
      : '';

  const header = user
    ? `<header class="topbar">
        <div class="topbar-inner">
          <a href="${homePathFor(user)}" class="brand"><img src="/static/icon-96.png" alt="" class="brand-logo">${escapeHtml(pubName)}</a>
          <div class="topbar-user">
            <a href="/account" class="user-chip">${escapeHtml(user.name)} <em>${escapeHtml(roleLabel(user))}</em></a>
            <form method="POST" action="/logout" class="inline-form">
              <button type="submit" class="link-btn">Log out</button>
            </form>
          </div>
        </div>
        <nav class="topnav">${navHtml}</nav>
      </header>`
    : `<header class="topbar topbar-guest">
        <div class="topbar-inner">
          <span class="brand"><img src="/static/icon-96.png" alt="" class="brand-logo">${escapeHtml(pubName)}</span>
        </div>
      </header>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} · ${escapeHtml(pubName)}</title>
<link rel="manifest" href="/static/manifest.json">
<meta name="theme-color" content="#2a3c3b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(pubName)}">
<link rel="apple-touch-icon" href="/static/icon-192.png">
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
${header}
<main class="content">
${installTipHtml}
${flashHtml}
${body}
</main>
<script src="/static/app.js"></script>
</body>
</html>`;
}

function redirect(res, location, flash) {
  if (flash) {
    const cookieVal = encodeURIComponent(JSON.stringify(flash));
    addSetCookie(res, `pubshift_flash=${cookieVal}; Path=/; Max-Age=10; SameSite=Lax`);
  }
  res.writeHead(302, { Location: location });
  res.end();
}

module.exports = { page, redirect };
