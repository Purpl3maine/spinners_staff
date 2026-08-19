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
const { currentStatus, totalHoursInRange, eventsForUser } = require('../lib/timesheet');
const { hashPassword } = require('../lib/db');
const { holidayBalance } = require('../lib/holiday');
const { isConfigured: emailConfigured, sendEmail, onboardingEmail, passwordResetEmail } = require('../lib/email');
const { roleLabel, canManageUser } = require('../lib/roles');

function activeStaff(data) {
  return data.users.filter((u) => u.role === 'staff' && u.active).sort((a, b) => a.name.localeCompare(b.name));
}

// Staff shown as rows on the rota grid. onRota defaults to true for anyone
// who's never had it explicitly set (keeps old data working without a migration).
function rotaStaff(data) {
  return activeStaff(data).filter((u) => u.onRota !== false);
}

function hiddenFromRota(data) {
  return activeStaff(data).filter((u) => u.onRota === false);
}

function payLabel(u) {
  return u.payType === 'salary' ? `£${(u.annualSalary || 0).toLocaleString('en-GB')}/yr` : `£${(u.hourlyRate || 0).toFixed(2)}/hr`;
}

function holidaySummaryLabel(u) {
  return u.payType === 'salary' ? `${u.holidayAllowanceDays || 0} days/yr` : '12.07% accrual';
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
          <td>${escapeHtml(u.role === 'staff' ? u.position || '—' : roleLabel(u))}</td>
          <td>${payLabel(u)}</td>
          <td>${holidaySummaryLabel(u)}</td>
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
            <label>Pay type
              <select name="payType">
                <option value="hourly" selected>Hourly</option>
                <option value="salary">Fixed salary</option>
              </select>
            </label>
          </div>
          ${ctx.user.role === 'owner' ? `<div class="row">
            <label>Role
              <select name="role">
                <option value="staff" selected>Staff</option>
                <option value="manager">Manager</option>
              </select>
            </label>
          </div>
          <p class="muted mt-0">Managers get full access to staff, rota, payroll, requests and holiday — but
            can't manage other managers. Only you (owner) can do that.</p>` : ''}
          <div class="row">
            <div data-paytype-field="hourly"><label>Hourly rate (£)<input type="number" step="0.01" min="0" name="hourlyRate" value="11.75"></label></div>
            <div data-paytype-field="salary"><label>Annual salary (£)<input type="number" step="100" min="0" name="annualSalary" value="24000"></label></div>
            <div data-paytype-field="salary"><label>Holiday allowance (days/yr)<input type="number" min="0" name="holidayAllowanceDays" value="28"></label></div>
          </div>
          <p class="muted mt-0" data-paytype-field="hourly">Hourly staff accrue holiday automatically — 12.07% of
            the hours they work — instead of a fixed day allowance. See the Holiday page for balances.</p>
          <label>Temporary password<input type="text" name="password" required value="welcome123"></label>
          <button type="submit" class="btn btn-primary">Add staff member</button>
        </form>
        <p class="muted mt-0">${emailConfigured() ? 'They’ll automatically be emailed their login details.' : 'Onboarding emails aren’t set up yet — you’ll need to share their login and temporary password directly. See DEPLOY.md to turn this on.'}</p>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Pay</th><th>Holiday</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    sendHtml(ctx, { title: 'Staff', activePath: '/manager/staff', body });
  });

  router.post('/manager/staff', async (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { name, email, position, payType, hourlyRate, annualSalary, holidayAllowanceDays, password, role } = ctx.body || {};
    if (!name || !email || !password) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Name, email and password are required.' });
      return;
    }
    const data = ctx.db.load();
    if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'A user with that email already exists.' });
      return;
    }
    // Only an owner can create a manager-level account — anyone else's
    // submission is forced to plain staff, regardless of what was posted.
    const assignedRole = ctx.user.role === 'owner' && role === 'manager' ? 'manager' : 'staff';
    data.users.push({
      id: uuid(),
      name,
      email,
      passwordHash: hashPassword(password),
      role: assignedRole,
      position: position || 'Staff',
      payType: payType === 'salary' ? 'salary' : 'hourly',
      annualSalary: Number(annualSalary) || 0,
      holidayAllowanceDays: Number(holidayAllowanceDays) || 0,
      hourlyRate: Number(hourlyRate) || 0,
      active: true,
      onRota: true,
      createdAt: nowISO(),
    });
    ctx.db.save(data);

    let message = `${name} added.`;
    if (emailConfigured()) {
      const { subject, html } = onboardingEmail({ pubName: data.settings.pubName, name, email, password });
      const result = await sendEmail({ to: email, subject, html });
      message += result.ok
        ? ' We’ve emailed them their login details.'
        : ' We couldn’t send the onboarding email automatically — share their email and temporary password with them directly.';
    } else {
      message += ' Share their email and temporary password with them directly.';
    }
    redirect(ctx.res, '/manager/staff', { type: 'success', message });
  });

  router.get('/manager/staff/:id', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    const status = currentStatus(data, u.id);
    const recentEvents = eventsForUser(data, u.id)
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);
    const eventsHtml = recentEvents.length
      ? recentEvents
          .map(
            (e) => `<li>
              <div class="row" style="align-items:center;">
                <div>
                  <span class="badge badge-${e.type}">${e.type === 'in' ? 'Clocked in' : 'Clocked out'}</span>
                  ${e.source === 'manual' ? '<span class="badge badge-draft">Manual</span>' : ''}
                  <div class="muted">${escapeHtml(fullDateLabel(e.timestamp.slice(0, 10)))} · ${fmtTimeLabel(e.timestamp)}</div>
                </div>
                <form method="POST" action="/manager/staff/${u.id}/clock/${e.id}/delete" data-confirm="Remove this clock ${e.type === 'in' ? 'in' : 'out'} entry? This can't be undone.">
                  <button type="submit" class="link-btn-plain">Remove</button>
                </form>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No clock events yet.</li>';

    const body = `
      <div class="page-head"><h1>${escapeHtml(u.name)}</h1></div>
      <div class="card">
        <div class="card-header"><h2>Clock in/out</h2><span class="badge badge-${status.clockedIn ? 'in' : 'out'}">${status.clockedIn ? 'Clocked in' : 'Clocked out'}</span></div>
        <p class="muted mt-0">Normally staff clock themselves in/out from their phone, which checks they're at the
          pub. Use this if that's not working for them (e.g. a GPS/location issue) or to fix a mistake — it skips
          the location check.</p>
        <form method="POST" action="/manager/staff/${u.id}/clock" class="stack">
          <div class="row">
            <label>Type
              <select name="type">
                <option value="in">Clock in</option>
                <option value="out">Clock out</option>
              </select>
            </label>
            <label>Date<input type="date" name="date" required value="${todayISO()}"></label>
            <label>Time<input type="time" name="time" required value="${new Date().toISOString().slice(11, 16)}"></label>
          </div>
          <button type="submit" class="btn">Add manual entry</button>
        </form>
        <hr class="sep">
        <h3 style="margin:0 0 0.5rem;">Recent clock events</h3>
        <ul class="list-plain">${eventsHtml}</ul>
      </div>
      <div class="card">
        <form method="POST" action="/manager/staff/${u.id}" class="stack">
          <div class="row">
            <label>Full name<input type="text" name="name" value="${escapeHtml(u.name)}" required></label>
            <label>Email<input type="email" name="email" value="${escapeHtml(u.email)}" required></label>
          </div>
          <div class="row">
            <label>Position<input type="text" name="position" value="${escapeHtml(u.position || '')}"></label>
            <label>Pay type
              <select name="payType">
                <option value="hourly" ${u.payType !== 'salary' ? 'selected' : ''}>Hourly</option>
                <option value="salary" ${u.payType === 'salary' ? 'selected' : ''}>Fixed salary</option>
              </select>
            </label>
          </div>
          ${ctx.user.role === 'owner' && u.id !== ctx.user.id && u.role !== 'owner'
            ? `<div class="row">
                <label>Role
                  <select name="role">
                    <option value="staff" ${u.role !== 'manager' ? 'selected' : ''}>Staff</option>
                    <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
                  </select>
                </label>
              </div>
              <p class="muted mt-0">Managers get full access to staff, rota, payroll, requests and holiday — but
                can't manage other managers.</p>`
            : u.role !== 'staff'
              ? `<p class="muted mt-0">Role: <strong>${escapeHtml(roleLabel(u))}</strong>${u.role === 'owner' ? ' — owner-level accounts can only be changed directly, not from this form.' : ''}</p>`
              : ''}
          <div class="row">
            <div data-paytype-field="hourly"><label>Hourly rate (£)<input type="number" step="0.01" min="0" name="hourlyRate" value="${u.hourlyRate || 0}"></label></div>
            <div data-paytype-field="salary"><label>Annual salary (£)<input type="number" step="100" min="0" name="annualSalary" value="${u.annualSalary || 0}"></label></div>
            <div data-paytype-field="salary"><label>Holiday allowance (days/yr)<input type="number" min="0" name="holidayAllowanceDays" value="${u.holidayAllowanceDays || 0}"></label></div>
          </div>
          <p class="muted mt-0" data-paytype-field="hourly">Hourly staff accrue holiday automatically — 12.07% of
            hours worked — instead of a fixed day allowance.
            <a href="/manager/holiday">See their balance on the Holiday page →</a></p>
          <label style="flex-direction:row;align-items:center;gap:0.5rem;">
            <input type="checkbox" name="onRota" style="width:auto;" ${u.onRota !== false ? 'checked' : ''}>
            <span>Show on the rota grid</span>
          </label>
          <p class="muted mt-0">Turn this off for someone you don't schedule shifts for (e.g. an admin-only
            account) — they'll disappear from the rota builder but keep everything else: logging in, clocking
            in/out, and requesting time off.</p>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </form>
        <hr class="sep">
        <h2>Reset password</h2>
        <p class="muted">Sets a new temporary password for this account — useful if they've forgotten it. Tell them the new password directly; they can change it themselves afterwards in Account settings.</p>
        <form method="POST" action="/manager/staff/${u.id}/reset-password" class="stack">
          <label>New temporary password<input type="text" name="password" required minlength="6"></label>
          ${emailConfigured() ? `<label style="flex-direction:row;align-items:center;gap:0.5rem;">
            <input type="checkbox" name="emailIt" style="width:auto;" checked>
            <span>Email this to ${escapeHtml(u.email)}</span>
          </label>` : ''}
          <button type="submit" class="btn">Set new password</button>
        </form>
        ${u.id !== ctx.user.id ? `<hr class="sep">
        <form method="POST" action="/manager/staff/${u.id}/toggle">
          <button type="submit" class="btn ${u.active ? 'btn-danger' : ''}">${u.active ? 'Deactivate' : 'Reactivate'} account</button>
        </form>` : ''}
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
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    const { name, email, position, payType, hourlyRate, annualSalary, holidayAllowanceDays, onRota, role } = ctx.body || {};
    if (name) u.name = name;
    if (email) u.email = email;
    u.position = position || u.position;
    u.payType = payType === 'salary' ? 'salary' : 'hourly';
    u.hourlyRate = Number(hourlyRate) || 0;
    u.annualSalary = Number(annualSalary) || 0;
    u.holidayAllowanceDays = Number(holidayAllowanceDays) || 0;
    u.onRota = onRota === 'on';
    // Only an owner can change someone's role, never their own, and never to/from owner via this form.
    if (ctx.user.role === 'owner' && u.id !== ctx.user.id && u.role !== 'owner' && ['staff', 'manager'].includes(role)) {
      u.role = role;
    }
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Saved.' });
  });

  router.post('/manager/staff/:id/reset-password', async (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    const { password, emailIt } = ctx.body || {};
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    if (!password || password.length < 6) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Password must be at least 6 characters.' });
      return;
    }
    u.passwordHash = hashPassword(password);
    ctx.db.save(data);

    let message = 'Password reset.';
    if (emailIt === 'on' && emailConfigured()) {
      const { subject, html } = passwordResetEmail({ pubName: data.settings.pubName, name: u.name, email: u.email, password });
      const result = await sendEmail({ to: u.email, subject, html });
      message += result.ok ? ` We’ve emailed ${u.name} their new password.` : ` We couldn’t email it automatically — tell ${u.name} their new temporary password directly.`;
    } else {
      message += ` Tell ${u.name} their new temporary password.`;
    }
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message });
  });

  router.post('/manager/staff/:id/clock', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    const { type, date, time } = ctx.body || {};
    if (!['in', 'out'].includes(type) || !date || !time) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Please provide a type, date and time.' });
      return;
    }
    data.clockEvents.push({
      id: uuid(),
      userId: u.id,
      type,
      timestamp: `${date}T${time}:00.000Z`,
      source: 'manual',
      addedBy: ctx.user.id,
    });
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: `Manual clock ${type === 'in' ? 'in' : 'out'} added for ${u.name}.` });
  });

  router.post('/manager/staff/:id/clock/:eventId/delete', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    const before = data.clockEvents.length;
    data.clockEvents = data.clockEvents.filter((e) => !(e.id === ctx.params.eventId && e.userId === ctx.params.id));
    const removed = data.clockEvents.length < before;
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${ctx.params.id}`, {
      type: removed ? 'success' : 'error',
      message: removed ? 'Clock event removed.' : 'Clock event not found.',
    });
  });

  router.post('/manager/staff/:id/toggle', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Staff member not found.' });
      return;
    }
    if (u.id === ctx.user.id) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: "You can't deactivate your own account." });
      return;
    }
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    u.active = !u.active;
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${ctx.params.id}`, { type: 'success', message: u.active ? 'Account reactivated.' : 'Account deactivated.' });
  });

  // ---------------- Rota builder ----------------
  router.get('/manager/rota', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const weekStart = weekParam(ctx);
    const weekEnd = addDays(weekStart, 6);
    const staff = rotaStaff(data);
    const hidden = hiddenFromRota(data);
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
                (s) => `<a class="shift-chip${s.published ? '' : ' draft'}" href="/manager/rota/shift?id=${s.id}&week=${weekStart}">${escapeHtml(s.start)}–${escapeHtml(s.end)}<small>${escapeHtml(s.role)}${s.breakMinutes ? ` · ${s.breakMinutes}min break` : ''}${s.published ? '' : ' · draft'}</small></a>`
              )
              .join('');
            return `<td class="rota-cell">${chips}<a class="add-shift-link" href="/manager/rota/shift?userId=${u.id}&date=${d}&week=${weekStart}">+ Add shift</a></td>`;
          })
          .join('');
        return `<tr><td><strong>${escapeHtml(u.name)}</strong><div class="muted">${escapeHtml(u.position)}</div>
          <form method="POST" action="/manager/rota/staff/${u.id}/hide" data-confirm="Remove ${escapeHtml(u.name)} from the rota grid? Their account and shifts already assigned are unaffected — you can add them back any time.">
            <input type="hidden" name="week" value="${weekStart}">
            <button type="submit" class="link-btn-plain">Remove from rota</button>
          </form></td>${cells}</tr>`;
      })
      .join('');

    const hiddenHtml = hidden.length
      ? `<div class="card">
          <h2>Not shown on the rota</h2>
          <p class="muted">Active staff who are hidden from the grid above — they can still log in, clock in/out, and request time off as normal.</p>
          <ul class="list-plain">
            ${hidden
              .map(
                (u) => `<li>
                  <div class="row" style="align-items:center;">
                    <div><strong>${escapeHtml(u.name)}</strong> <span class="muted">${escapeHtml(u.position)}</span></div>
                    <form method="POST" action="/manager/rota/staff/${u.id}/show">
                      <input type="hidden" name="week" value="${weekStart}">
                      <button type="submit" class="btn btn-sm">+ Add to rota</button>
                    </form>
                  </div>
                </li>`
              )
              .join('')}
          </ul>
        </div>`
      : '';

    const body = `
      <div class="page-head"><h1>Rota builder</h1><a class="btn btn-sm" href="/manager/staff">+ Add / manage staff</a></div>
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
      </div>`}
      ${hiddenHtml}`;
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
          <label>Unpaid break (minutes)
            <input type="number" name="breakMinutes" min="0" step="5" value="${shift ? shift.breakMinutes || 0 : 0}">
          </label>
          <p class="muted mt-0">Deducted automatically from this day's paid hours on their timesheet — e.g. 30 for
            a standard half-hour unpaid break. Leave at 0 if there's no unpaid break.</p>
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
    const { id, userId, date, start, end, role, notes, breakMinutes, week } = ctx.body || {};
    const redirectTo = `/manager/rota?week=${week || startOfWeek(todayISO())}`;
    if (!userId || !date || !start || !end || start >= end) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Please provide a valid time range (end after start).' });
      return;
    }
    const breakMins = Math.max(0, Number(breakMinutes) || 0);
    const data = ctx.db.load();
    if (id) {
      const shift = data.shifts.find((s) => s.id === id);
      if (shift) {
        shift.start = start;
        shift.end = end;
        shift.role = role || shift.role;
        shift.notes = notes || '';
        shift.breakMinutes = breakMins;
      }
    } else {
      data.shifts.push({ id: uuid(), userId, date, start, end, role: role || 'Staff', notes: notes || '', breakMinutes: breakMins, published: false });
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

  router.post('/manager/rota/staff/:id/hide', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    const week = (ctx.body && ctx.body.week) || startOfWeek(todayISO());
    if (u) {
      u.onRota = false;
      ctx.db.save(data);
    }
    redirect(ctx.res, `/manager/rota?week=${week}`, { type: 'success', message: u ? `${u.name} removed from the rota grid.` : 'Staff member not found.' });
  });

  router.post('/manager/rota/staff/:id/show', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    const week = (ctx.body && ctx.body.week) || startOfWeek(todayISO());
    if (u) {
      u.onRota = true;
      ctx.db.save(data);
    }
    redirect(ctx.res, `/manager/rota?week=${week}`, { type: 'success', message: u ? `${u.name} added back to the rota grid.` : 'Staff member not found.' });
  });

  // ---------------- Holiday balances & log ----------------
  router.get('/manager/holiday', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const today = todayISO();
    const staff = activeStaff(data);

    const balanceRows = staff
      .map((u) => {
        const bal = holidayBalance(data, u, today);
        const fmt = (n) => (bal.unit === 'days' ? `${Math.round(n * 10) / 10} days` : `${fmtHours(n)} hrs`);
        return `<tr>
          <td><a href="/manager/staff/${u.id}">${escapeHtml(u.name)}</a><div class="muted">${escapeHtml(u.position)}</div></td>
          <td>${u.payType === 'salary' ? 'Salary' : 'Hourly (12.07% accrual)'}</td>
          <td class="text-right">${fmt(bal.accrued)}</td>
          <td class="text-right">${fmt(bal.taken)}</td>
          <td class="text-right"><strong>${fmt(bal.remaining)}</strong></td>
        </tr>`;
      })
      .join('');

    const holidayLog = [...data.timeOffRequests]
      .filter((r) => r.type === 'holiday')
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((r) => {
        const u = data.users.find((x) => x.id === r.userId);
        const amount = u && u.payType !== 'salary' && r.hours ? `${r.hours} hrs` : `${daysBetweenInclusive(r.startDate, r.endDate)} day(s)`;
        return `<tr>
          <td>${escapeHtml(u ? u.name : 'Unknown')}</td>
          <td>${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''}</td>
          <td>${amount}</td>
          <td><span class="badge badge-${r.status}">${escapeHtml(r.status)}</span></td>
        </tr>`;
      })
      .join('');

    const yearWindow = staff.length ? holidayBalance(data, staff[0], today) : null;

    const body = `
      <div class="page-head"><h1>Holiday</h1></div>
      <div class="card">
        <h2>Balances</h2>
        ${yearWindow ? `<p class="muted mt-0">Current holiday year: ${escapeHtml(fullDateLabel(yearWindow.yearStart))} to ${escapeHtml(fullDateLabel(yearWindow.yearEnd))} — resets every 1 April.</p>` : ''}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Basis</th><th class="text-right">Accrued / allowance</th><th class="text-right">Taken</th><th class="text-right">Remaining</th></tr></thead>
            <tbody>${balanceRows || '<tr><td colspan="5" class="empty-state">No active staff.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:0.75rem;">Hourly staff accrue 12.07% of hours actually worked so far
          this holiday year — their "remaining" figure grows as they work more hours. Salaried staff get their
          full day allowance from day one of the year.</p>
      </div>
      <div class="card">
        <h2>Holiday log</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Dates</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>${holidayLog || '<tr><td colspan="4" class="empty-state">No holiday requests yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    sendHtml(ctx, { title: 'Holiday', activePath: '/manager/holiday', body });
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
      const amount =
        r.type === 'holiday' && u && u.payType !== 'salary' && r.hours
          ? `${r.hours} hrs`
          : `${daysBetweenInclusive(r.startDate, r.endDate)} day(s)`;
      return `<li>
        <div class="row" style="align-items:center;">
          <div>
            <strong>${escapeHtml(u ? u.name : 'Unknown')}</strong> — ${escapeHtml(r.type)}
            <div class="muted">${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''} · ${amount}</div>
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
        const isSalary = u.payType === 'salary';
        const cost = isSalary ? (u.annualSalary || 0) / 52 : hrs * (u.hourlyRate || 0);
        grandHours += hrs;
        grandCost += cost;
        const costCell = isSalary ? `${fmtMoney(cost)} <span class="muted">(salaried, pro-rated)</span>` : fmtMoney(cost);
        return `<tr><td>${escapeHtml(u.name)}<div class="muted">${escapeHtml(u.position)}</div></td><td class="text-right">${fmtHours(hrs)} hrs</td><td class="text-right">${costCell}</td></tr>`;
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
