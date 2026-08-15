'use strict';

const { sendHtml, redirect, requireRole } = require('../lib/respond');
const {
  escapeHtml,
  uuid,
  nowISO,
  todayISO,
  startOfWeek,
  addDays,
  dayLabel,
  fullDateLabel,
  daysBetweenInclusive,
  fmtHours,
  fmtMoney,
  fmtTimeLabel,
} = require('../lib/util');
const { currentStatus, totalHoursInRange } = require('../lib/timesheet');
const { hashPassword } = require('../lib/db');

function activeStaff(data) {
  return data.users.filter((u) => u.role === 'staff' && u.active).sort((a, b) => a.name.localeCompare(b.name));
}

function weekParam(ctx) {
  return ctx.query.week && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.week) ? startOfWeek(ctx.query.week) : startOfWeek(todayISO());
}

module.exports = function (router) {
  // ---------------- Dashboard ----------------
  router.get('/manager', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const staff = activeStaff(data);
    const onShift = staff
      .map((u) => ({ user: u, status: currentStatus(data, u.id) }))
      .filter((x) => x.status.clockedIn);

    const pending = data.timeOffRequests.filter((r) => r.status === 'pending').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    const weekStart = startOfWeek(todayISO());
    const weekEnd = addDays(weekStart, 6);
    const shiftsThisWeek = data.shifts.filter((s) => s.date >= weekStart && s.date <= weekEnd).length;

    const onShiftHtml = onShift.length
      ? onShift.map((x) => `<li><strong>${escapeHtml(x.user.name)}</strong> <span class="muted">(${escapeHtml(x.user.position)})</span> — since ${fmtTimeLabel(x.status.since)}</li>`).join('')
      : '<li class="muted">Nobody is clocked in right now.</li>';

    const pendingHtml = pending.length
      ? pending
          .slice(0, 5)
          .map((r) => {
            const u = data.users.find((x) => x.id === r.userId);
            return `<li><strong>${escapeHtml(u ? u.name : 'Unknown')}</strong> — ${escapeHtml(r.type)} ${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''}</li>`;
          })
          .join('')
      : '<li class="muted">No pending requests.</li>';

    const body = `
      <div class="page-head"><h1>Dashboard</h1></div>
      <div class="stat-grid">
        <div class="stat-tile"><div class="num">${onShift.length}</div><div class="label">Clocked in now</div></div>
        <div class="stat-tile"><div class="num">${staff.length}</div><div class="label">Active staff</div></div>
        <div class="stat-tile"><div class="num">${shiftsThisWeek}</div><div class="label">Shifts this week</div></div>
        <div class="stat-tile"><div class="num">${pending.length}</div><div class="label">Pending requests</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h2>On shift now</h2></div>
          <ul class="list-plain">${onShiftHtml}</ul>
        </div>
        <div class="card">
          <div class="card-header"><h2>Pending time off</h2><a class="btn btn-sm" href="/manager/requests">View all</a></div>
          <ul class="list-plain">${pendingHtml}</ul>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Rota</h2><p class="muted">Build and publish this week's shifts.</p><a class="btn btn-primary" href="/manager/rota">Open rota builder</a></div>
        <div class="card"><h2>Timesheets</h2><p class="muted">Review hours worked and estimated labour cost.</p><a class="btn" href="/manager/timesheets">View timesheets</a></div>
      </div>`;
    sendHtml(ctx, { title: 'Dashboard', activePath: '/manager', body });
  });

  // ---------------- Staff directory ----------------
  router.get('/manager/staff', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const rows = data.users
      .filter((u) => u.id !== ctx.user.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (u) => `<tr>
          <td><a href="/manager/staff/${u.id}">${escapeHtml(u.name)}</a><div class="muted">${escapeHtml(u.email)}</div></td>
          <td>${escapeHtml(u.role === 'manager' ? 'Manager' : u.position || '—')}</td>
          <td>£${(u.hourlyRate || 0).toFixed(2)}/hr</td>
          <td>${u.holidayAllowanceDays || 0} days</td>
          <td>${u.active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-denied">Inactive</span>'}</td>
        </tr>`
      )
      .join('');

    const body = `
      <div class="page-head"><h1>Staff</h1></div>
      <div class="card">
        <h2>Add a staff member</h2>
        <form method="POST" action="/manager/staff" class="stack">
          <div class="row">
            <label>Full name<input type="text" name="name" required></label>
            <label>Email<input type="email" name="email" required></label>
          </div>
          <div class="row">
            <label>Position<input type="text" name="position" placeholder="Bartender" required></label>
            <label>Hourly rate (£)<input type="number" step="0.01" min="0" name="hourlyRate" value="11.75" required></label>
            <label>Holiday allowance (days/yr)<input type="number" min="0" name="holidayAllowanceDays" value="28" required></label>
          </div>
          <label>Temporary password<input type="text" name="password" required value="welcome123"></label>
          <button type="submit" class="btn btn-primary">Add staff member</button>
        </form>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Rate</th><th>Holiday</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    sendHtml(ctx, { title: 'Staff', activePath: '/manager/staff', body });
  });

  router.post('/manager/staff', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { name, email, position, hourlyRate, holidayAllowanceDays, password } = ctx.body || {};
    if (!name || !email || !password) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Name, email and password are required.' });
      return;
    }
    const data = ctx.db.load();
    if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'A user with that email already exists.' });
      return;
    }
    data.users.push({
      id: uuid(),
      name,
      email,
      passwordHash: hashPassword(password),
      role: 'staff',
      position: position || 'Staff',
      holidayAllowanceDays: Number(holidayAllowanceDays) || 0,
      hourlyRate: Number(hourlyRate) || 0,
      active: true,
      createdAt: nowISO(),
    });
    ctx.db.save(data);
    redirect(ctx.res, '/manager/staff', { type: 'success', message: `${name} added. Share their email and temporary password.` });
  });

  router.get('/manager/staff/:id', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    const body = `
      <div class="page-head"><h1>${escapeHtml(u.name)}</h1></div>
      <div class="card">
        <form method="POST" action="/manager/staff/${u.id}" class="stack">
          <div class="row">
            <label>Full name<input type="text" name="name" value="${escapeHtml(u.name)}" required></label>
            <label>Email<input type="email" name="email" value="${escapeHtml(u.email)}" required></label>
          </div>
          <div class="row">
            <label>Position<input type="text" name="position" value="${escapeHtml(u.position || '')}"></label>
            <label>Hourly rate (£)<input type="number" step="0.01" min="0" name="hourlyRate" value="${u.hourlyRate || 0}"></label>
            <label>Holiday allowance (days/yr)<input type="number" min="0" name="holidayAllowanceDays" value="${u.holidayAllowanceDays || 0}"></label>
          </div>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </form>
        <hr class="sep">
        <h2>Reset password</h2>
        <p class="muted">Sets a new temporary password for this account — useful if they've forgotten it. Tell them the new password directly; they can change it themselves afterwards in Account settings.</p>
        <form method="POST" action="/manager/staff/${u.id}/reset-password" class="stack">
          <label>New temporary password<input type="text" name="password" required minlength="6"></label>
          <button type="submit" class="btn">Set new password</button>
        </form>
        <hr class="sep">
        <form method="POST" action="/manager/staff/${u.id}/toggle">
          <button type="submit" class="btn ${u.active ? 'btn-danger' : ''}">${u.active ? 'Deactivate' : 'Reactivate'} account</button>
        </form>
      </div>`;
    sendHtml(ctx, { title: u.name, activePath: '/manager/staff', body });
  });

  router.post('/manager/staff/:id', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    const { name, email, position, hourlyRate, holidayAllowanceDays } = ctx.body || {};
    if (name) u.name = name;
    if (email) u.email = email;
    u.position = position || u.position;
    u.hourlyRate = Number(hourlyRate) || 0;
    u.holidayAllowanceDays = Number(holidayAllowanceDays) || 0;
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Saved.' });
  });

  router.post('/manager/staff/:id/reset-password', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    const { password } = ctx.body || {};
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (!password || password.length < 6) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Password must be at least 6 characters.' });
      return;
    }
    u.passwordHash = hashPassword(password);
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: `Password reset. Tell ${u.name} their new temporary password.` });
  });

  router.post('/manager/staff/:id/toggle', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (u) {
      u.active = !u.active;
      ctx.db.save(data);
    }
    redirect(ctx.res, `/manager/staff/${ctx.params.id}`, { type: 'success', message: u && u.active ? 'Account reactivated.' : 'Account deactivated.' });
  });

  // ---------------- Rota builder ----------------
  router.get('/manager/rota', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const weekStart = weekParam(ctx);
    const weekEnd = addDays(weekStart, 6);
    const staff = activeStaff(data);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const weekShifts = data.shifts.filter((s) => s.date >= weekStart && s.date <= weekEnd);
    const anyDraft = weekShifts.some((s) => !s.published);
    const anyShift = weekShifts.length > 0;

    const headerRow = `<tr><th>Staff</th>${days.map((d) => `<th>${escapeHtml(dayLabel(d))}</th>`).join('')}</tr>`;

    const bodyRows = staff
      .map((u) => {
        const cells = days
          .map((d) => {
            const shifts = weekShifts.filter((s) => s.userId === u.id && s.date === d);
            const chips = shifts
              .map(
                (s) => `<a class="shift-chip${s.published ? '' : ' draft'}" href="/manager/rota/shift?id=${s.id}&week=${weekStart}">${escapeHtml(s.start)}–${escapeHtml(s.end)}<small>${escapeHtml(s.role)}${s.published ? '' : ' · draft'}</small></a>`
              )
              .join('');
            return `<td class="rota-cell">${chips}<a class="add-shift-link" href="/manager/rota/shift?userId=${u.id}&date=${d}&week=${weekStart}">+ Add shift</a></td>`;
          })
          .join('');
        return `<tr><td><strong>${escapeHtml(u.name)}</strong><div class="muted">${escapeHtml(u.position)}</div></td>${cells}</tr>`;
      })
      .join('');

    const body = `
      <div class="page-head"><h1>Rota builder</h1></div>
      <div class="week-nav">
        <a class="btn btn-sm" href="/manager/rota?week=${addDays(weekStart, -7)}">← Prev week</a>
        <span class="label">${escapeHtml(fullDateLabel(weekStart))} – ${escapeHtml(fullDateLabel(weekEnd))}</span>
        <a class="btn btn-sm" href="/manager/rota?week=${addDays(weekStart, 7)}">Next week →</a>
        ${anyShift ? (anyDraft
          ? `<form method="POST" action="/manager/rota/publish" class="inline-form"><input type="hidden" name="week" value="${weekStart}"><button type="submit" class="btn btn-amber">Publish week to staff</button></form>`
          : `<span class="badge badge-published">Published</span>`) : ''}
      </div>
      ${staff.length === 0 ? '<div class="card"><p class="empty-state">Add staff members first before building a rota.</p></div>' : `
      <div class="card">
        <div class="table-wrap">
          <table class="rota-grid">
            <thead>${headerRow}</thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>`}`;
    sendHtml(ctx, { title: 'Rota builder', activePath: '/manager/rota', body });
  });

  router.get('/manager/rota/shift', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const week = ctx.query.week || startOfWeek(todayISO());
    let shift = null;
    if (ctx.query.id) {
      shift = data.shifts.find((s) => s.id === ctx.query.id);
      if (!shift) {
        redirect(ctx.res, `/manager/rota?week=${week}`, { type: 'error', message: 'Shift not found.' });
        return;
      }
    }
    const userId = shift ? shift.userId : ctx.query.userId;
    const date = shift ? shift.date : ctx.query.date;
    const u = data.users.find((x) => x.id === userId);
    if (!u) {
      redirect(ctx.res, `/manager/rota?week=${week}`, { type: 'error', message: 'Staff member not found.' });
      return;
    }

    const body = `
      <div class="page-head"><h1>${shift ? 'Edit' : 'Add'} shift</h1></div>
      <div class="card">
        <p><strong>${escapeHtml(u.name)}</strong> · ${escapeHtml(fullDateLabel(date))}</p>
        <form method="POST" action="/manager/rota/shift" class="stack">
          <input type="hidden" name="id" value="${shift ? shift.id : ''}">
          <input type="hidden" name="userId" value="${escapeHtml(userId)}">
          <input type="hidden" name="date" value="${escapeHtml(date)}">
          <input type="hidden" name="week" value="${escapeHtml(week)}">
          <div class="row">
            <label>Start time<input type="time" name="start" required value="${shift ? shift.start : '11:00'}"></label>
            <label>End time<input type="time" name="end" required value="${shift ? shift.end : '19:00'}"></label>
          </div>
          <label>Role / section<input type="text" name="role" value="${escapeHtml(shift ? shift.role : u.position || '')}"></label>
          <label>Notes (optional)<textarea name="notes">${escapeHtml(shift ? shift.notes : '')}</textarea></label>
          <button type="submit" class="btn btn-primary">${shift ? 'Save changes' : 'Add shift'}</button>
        </form>
        ${shift ? `<form method="POST" action="/manager/rota/shift/delete" style="margin-top:0.75rem;" data-confirm="Remove this shift?">
          <input type="hidden" name="id" value="${shift.id}">
          <input type="hidden" name="week" value="${escapeHtml(week)}">
          <button type="submit" class="btn btn-danger">Delete shift</button>
        </form>` : ''}
        <a class="btn" style="margin-top:0.75rem;" href="/manager/rota?week=${escapeHtml(week)}">Cancel</a>
      </div>`;
    sendHtml(ctx, { title: shift ? 'Edit shift' : 'Add shift', activePath: '/manager/rota', body });
  });

  router.post('/manager/rota/shift', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { id, userId, date, start, end, role, notes, week } = ctx.body || {};
    const redirectTo = `/manager/rota?week=${week || startOfWeek(todayISO())}`;
    if (!userId || !date || !start || !end || start >= end) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Please provide a valid time range (end after start).' });
      return;
    }
    const data = ctx.db.load();
    if (id) {
      const shift = data.shifts.find((s) => s.id === id);
      if (shift) {
        shift.start = start;
        shift.end = end;
        shift.role = role || shift.role;
        shift.notes = notes || '';
      }
    } else {
      data.shifts.push({ id: uuid(), userId, date, start, end, role: role || 'Staff', notes: notes || '', published: false });
    }
    ctx.db.save(data);
    redirect(ctx.res, redirectTo, { type: 'success', message: 'Shift saved.' });
  });

  router.post('/manager/rota/shift/delete', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { id, week } = ctx.body || {};
    const data = ctx.db.load();
    data.shifts = data.shifts.filter((s) => s.id !== id);
    ctx.db.save(data);
    redirect(ctx.res, `/manager/rota?week=${week || startOfWeek(todayISO())}`, { type: 'success', message: 'Shift removed.' });
  });

  router.post('/manager/rota/publish', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { week } = ctx.body || {};
    const weekStart = week || startOfWeek(todayISO());
    const weekEnd = addDays(weekStart, 6);
    const data = ctx.db.load();
    let count = 0;
    data.shifts.forEach((s) => {
      if (s.date >= weekStart && s.date <= weekEnd && !s.published) {
        s.published = true;
        count++;
      }
    });
    ctx.db.save(data);
    redirect(ctx.res, `/manager/rota?week=${weekStart}`, { type: 'success', message: `Published ${count} shift(s) — staff can now see this week.` });
  });

  // ---------------- Time-off requests ----------------
  router.get('/manager/requests', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const all = [...data.timeOffRequests].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const pending = all.filter((r) => r.status === 'pending');
    const decided = all.filter((r) => r.status !== 'pending');

    function rowFor(r, withActions) {
      const u = data.users.find((x) => x.id === r.userId);
      return `<li>
        <div class="row" style="align-items:center;">
          <div>
            <strong>${escapeHtml(u ? u.name : 'Unknown')}</strong> — ${escapeHtml(r.type)}
            <div class="muted">${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''} · ${daysBetweenInclusive(r.startDate, r.endDate)} day(s)</div>
            ${r.reason ? `<div class="muted">"${escapeHtml(r.reason)}"</div>` : ''}
          </div>
          ${withActions
            ? `<div class="pill-row">
                <form method="POST" action="/manager/requests/${r.id}"><input type="hidden" name="action" value="approve"><button class="btn btn-sm btn-primary" type="submit">Approve</button></form>
                <form method="POST" action="/manager/requests/${r.id}"><input type="hidden" name="action" value="deny"><button class="btn btn-sm btn-danger" type="submit">Deny</button></form>
              </div>`
            : `<span class="badge badge-${r.status}">${escapeHtml(r.status)}</span>`}
        </div>
      </li>`;
    }

    const body = `
      <div class="page-head"><h1>Time off requests</h1></div>
      <div class="card">
        <h2>Pending (${pending.length})</h2>
        <ul class="list-plain">${pending.length ? pending.map((r) => rowFor(r, true)).join('') : '<li class="muted">Nothing waiting on you 🎉</li>'}</ul>
      </div>
      <div class="card">
        <h2>History</h2>
        <ul class="list-plain">${decided.length ? decided.map((r) => rowFor(r, false)).join('') : '<li class="muted">No decisions yet.</li>'}</ul>
      </div>`;
    sendHtml(ctx, { title: 'Requests', activePath: '/manager/requests', body });
  });

  router.post('/manager/requests/:id', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const r = data.timeOffRequests.find((x) => x.id === ctx.params.id);
    const { action } = ctx.body || {};
    if (r && ['approve', 'deny'].includes(action)) {
      r.status = action === 'approve' ? 'approved' : 'denied';
      r.decidedBy = ctx.user.id;
      r.decidedAt = nowISO();
      ctx.db.save(data);
    }
    redirect(ctx.res, '/manager/requests', { type: 'success', message: `Request ${action === 'approve' ? 'approved' : 'denied'}.` });
  });

  // ---------------- Timesheets report ----------------
  router.get('/manager/timesheets', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const weekStart = weekParam(ctx);
    const weekEnd = addDays(weekStart, 6);
    const staff = activeStaff(data);

    let grandHours = 0;
    let grandCost = 0;
    const rows = staff
      .map((u) => {
        const hrs = totalHoursInRange(data, u.id, weekStart, weekEnd);
        const cost = hrs * (u.hourlyRate || 0);
        grandHours += hrs;
        grandCost += cost;
        return `<tr><td>${escapeHtml(u.name)}<div class="muted">${escapeHtml(u.position)}</div></td><td class="text-right">${fmtHours(hrs)} hrs</td><td class="text-right">${fmtMoney(cost)}</td></tr>`;
      })
      .join('');

    const body = `
      <div class="page-head"><h1>Timesheets</h1></div>
      <div class="week-nav">
        <a class="btn btn-sm" href="/manager/timesheets?week=${addDays(weekStart, -7)}">← Prev week</a>
        <span class="label">${escapeHtml(fullDateLabel(weekStart))} – ${escapeHtml(fullDateLabel(weekEnd))}</span>
        <a class="btn btn-sm" href="/manager/timesheets?week=${addDays(weekStart, 7)}">Next week →</a>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th class="text-right">Hours</th><th class="text-right">Est. cost</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="empty-state">No active staff.</td></tr>'}</tbody>
            <tfoot><tr><td>Total</td><td class="text-right">${fmtHours(grandHours)} hrs</td><td class="text-right">${fmtMoney(grandCost)}</td></tr></tfoot>
          </table>
        </div>
        <p class="muted" style="margin-top:0.75rem;">Estimated labour cost before tax, NI or on-costs — for planning only.</p>
      </div>`;
    sendHtml(ctx, { title: 'Timesheets', activePath: '/manager/timesheets', body });
  });
};
