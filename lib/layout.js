'use strict';

const { escapeHtml, addSetCookie } = require('./util');

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
  { href: '/manager/requests', label: 'Requests', icon: '🌴' },
  { href: '/manager/holiday', label: 'Holiday', icon: '📊' },
  { href: '/manager/timesheets', label: 'Timesheets', icon: '🧾' },
];

function navFor(user) {
  return user.role === 'manager' ? MANAGER_NAV : STAFF_NAV;
}

function page({ title, user, activePath, body, pubName = 'PubShift', flash = null }) {
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

  const header = user
    ? `<header class="topbar">
        <div class="topbar-inner">
          <a href="${user.role === 'manager' ? '/manager' : '/staff'}" class="brand"><img src="/static/icon-96.png" alt="" class="brand-logo">${escapeHtml(pubName)}</a>
          <div class="topbar-user">
            <a href="/account" class="user-chip">${escapeHtml(user.name)} <em>${user.role === 'manager' ? 'Manager' : escapeHtml(user.position || 'Staff')}</em></a>
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
<meta name="theme-color" content="#0f3d2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(pubName)}">
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
${header}
<main class="content">
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
