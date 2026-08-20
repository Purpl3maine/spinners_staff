'use strict';

const fs = require('fs');
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
  nowTimeLabelUK,
  londonDateKey,
  londonWallTimeToISO,
} = require('../lib/util');
const { currentStatus, totalHoursInRange, eventsForUser } = require('../lib/timesheet');
const { hashPassword } = require('../lib/db');
const { holidayBalance } = require('../lib/holiday');
const { isConfigured: emailConfigured, sendEmail, onboardingEmail, passwordResetEmail } = require('../lib/email');
const { roleLabel, canManageUser } = require('../lib/roles');
const { saveContractFile, absolutePath: contractAbsolutePath, deleteContractFile, deleteAllForUser } = require('../lib/uploads');
const { PALETTE_SIZE, nextColorIndex } = require('../lib/departments');

const DISCIPLINARY_TYPES = ['Verbal warning', 'Written warning', 'Final written warning', 'Other'];

function fmtFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findDept(data, departmentId) {
  return departmentId ? (data.departments || []).find((d) => d.id === departmentId) : null;
}

function deptBadgeHtml(data, departmentId) {
  const dept = findDept(data, departmentId);
  if (!dept) return '';
  return `<span class="dept-badge-${dept.colorIndex % PALETTE_SIZE}">${escapeHtml(dept.name)}</span>`;
}

function departmentOptionsHtml(data, selectedId) {
  return (data.departments || [])
    .map((d) => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');
}

// Anyone who can be scheduled/paid — regular staff and managers (managers
// often work shifts too, e.g. a duty manager on the bar). The owner is left
// out here since they're handled separately (own account page) and aren't
// normally on the payroll/rota list.
function activeStaff(data) {
  return data.users
    .filter((u) => (u.role === 'staff' || u.role === 'manager') && u.active)
    .sort((a, b) => a.name.localeCompare(b.name));
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
          <td>${deptBadgeHtml(data, u.departmentId) || '<span class="muted">—</span>'}</td>
          <td>${payLabel(u)}</td>
          <td>${holidaySummaryLabel(u)}</td>
          <td>${u.active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-denied">Inactive</span>'}</td>
        </tr>`
      )
      .join('');

    const body = `
      <div class="page-head"><h1>Staff</h1><a class="btn btn-sm" href="/manager/departments">Manage departments</a></div>
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
          <div class="row">
            <label>Department
              <select name="departmentId">
                <option value="">— None —</option>
                ${departmentOptionsHtml(data, null)}
              </select>
            </label>
            <div></div>
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
          <div class="row">
            <div data-paytype-field="hourly"><label>Holiday adjustment (hrs)<input type="number" step="0.1" name="holidayAdjustmentHours" value="0"></label></div>
            <div data-paytype-field="salary"><label>Holiday adjustment (days)<input type="number" step="0.5" name="holidayAdjustmentDays" value="0"></label></div>
          </div>
          <p class="muted mt-0">Moving them over from Planday (or anywhere else) mid-year? Enter their existing
            holiday balance here — positive if they're owed holiday already, negative if they've taken more than
            they'd earned there. Leave at 0 for a brand-new starter.</p>
          <label>Temporary password<input type="text" name="password" required value="welcome123"></label>
          <button type="submit" class="btn btn-primary">Add staff member</button>
        </form>
        <p class="muted mt-0">${emailConfigured() ? 'They’ll automatically be emailed their login details.' : 'Onboarding emails aren’t set up yet — you’ll need to share their login and temporary password directly. See DEPLOY.md to turn this on.'}</p>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Pay</th><th>Holiday</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      ${ctx.user.role === 'owner' ? `<div class="card" style="border-color:var(--red-500);">
        <h2>Danger zone</h2>
        <p class="muted mt-0">Clear out test data before you start onboarding real staff.</p>
        <a class="btn btn-danger" href="/manager/reset">Reset for go-live →</a>
      </div>` : ''}`;
    sendHtml(ctx, { title: 'Staff', activePath: '/manager/staff', body });
  });

  // ---------------- Departments ----------------
  router.get('/manager/departments', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const departments = data.departments || [];
    const memberCount = (deptId) => data.users.filter((u) => u.departmentId === deptId && u.active).length;
    const rows = departments.length
      ? departments
          .map(
            (d) => `<li>
              <div class="row" style="align-items:center;">
                <div>${deptBadgeHtml(data, d.id)} <span class="muted">${memberCount(d.id)} active staff</span></div>
                <div class="row" style="gap:0.75rem;">
                  <form method="POST" action="/manager/departments/${d.id}" class="inline-form">
                    <input type="text" name="name" value="${escapeHtml(d.name)}" required style="width:auto;">
                    <button type="submit" class="btn btn-sm">Rename</button>
                  </form>
                  <form method="POST" action="/manager/departments/${d.id}/delete" data-confirm="Delete the &quot;${escapeHtml(d.name)}&quot; department? Staff in it won't be removed — they'll just show as having no department.">
                    <button type="submit" class="link-btn-plain">Delete</button>
                  </form>
                </div>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No departments yet — add one below.</li>';
    const body = `
      <div class="page-head"><h1>Departments</h1></div>
      <div class="card">
        <p class="muted mt-0">Group staff on the rota by department (e.g. Kitchen, FOH, Bar) — each gets its own
          colour automatically. Assign a staff member's department from their staff page.</p>
        <ul class="list-plain">${rows}</ul>
        <hr class="sep">
        <form method="POST" action="/manager/departments" class="stack">
          <label>New department<input type="text" name="name" placeholder="e.g. Kitchen" required></label>
          <button type="submit" class="btn btn-primary">Add department</button>
        </form>
      </div>
      <a class="btn" href="/manager/staff">← Back to staff</a>`;
    sendHtml(ctx, { title: 'Departments', activePath: '/manager/departments', body });
  });

  router.post('/manager/departments', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { name } = ctx.body || {};
    if (!name || !name.trim()) {
      redirect(ctx.res, '/manager/departments', { type: 'error', message: 'Give the department a name.' });
      return;
    }
    const data = ctx.db.load();
    if (!data.departments) data.departments = [];
    if (data.departments.some((d) => d.name.toLowerCase() === name.trim().toLowerCase())) {
      redirect(ctx.res, '/manager/departments', { type: 'error', message: 'A department with that name already exists.' });
      return;
    }
    data.departments.push({ id: uuid(), name: name.trim(), colorIndex: nextColorIndex(data.departments), createdAt: nowISO() });
    ctx.db.save(data);
    redirect(ctx.res, '/manager/departments', { type: 'success', message: `"${name.trim()}" added.` });
  });

  router.post('/manager/departments/:id', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { name } = ctx.body || {};
    const data = ctx.db.load();
    const dept = (data.departments || []).find((d) => d.id === ctx.params.id);
    if (!dept) {
      redirect(ctx.res, '/manager/departments', { type: 'error', message: 'Department not found.' });
      return;
    }
    if (!name || !name.trim()) {
      redirect(ctx.res, '/manager/departments', { type: 'error', message: 'Give the department a name.' });
      return;
    }
    dept.name = name.trim();
    ctx.db.save(data);
    redirect(ctx.res, '/manager/departments', { type: 'success', message: 'Department renamed.' });
  });

  router.post('/manager/departments/:id/delete', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const before = (data.departments || []).length;
    data.departments = (data.departments || []).filter((d) => d.id !== ctx.params.id);
    const removed = before > data.departments.length;
    if (removed) {
      data.users.forEach((u) => {
        if (u.departmentId === ctx.params.id) u.departmentId = null;
      });
    }
    ctx.db.save(data);
    redirect(ctx.res, '/manager/departments', { type: removed ? 'success' : 'error', message: removed ? 'Department deleted.' : 'Department not found.' });
  });

  // ---------------- Reset for go-live (owner only) ----------------
  router.get('/manager/reset', (ctx) => {
    if (requireRole(ctx, 'owner')) return;
    const data = ctx.db.load();
    const users = [...data.users].sort((a, b) => a.name.localeCompare(b.name));
    const rows = users
      .map(
        (u) => `<label style="display:flex;align-items:center;gap:0.5rem;font-weight:normal;">
          <input type="checkbox" name="keep_${u.id}" value="on" style="width:auto;" ${u.id === ctx.user.id ? 'checked' : ''}>
          <span>${escapeHtml(u.name)} <span class="muted">(${escapeHtml(roleLabel(u))} · ${escapeHtml(u.email)})</span></span>
        </label>`
      )
      .join('');

    const body = `
      <div class="page-head"><h1>Reset for go-live</h1></div>
      <div class="card">
        <p class="muted mt-0">Use this once, when you're ready to stop testing and hand the app to real staff.
          It permanently deletes every shift, clock in/out record, and time-off request, and removes every
          account you don't tick below to keep. <strong>This can't be undone</strong> — there's no backup.</p>
        <form method="POST" action="/manager/reset" class="stack" data-confirm="This will permanently delete all shifts, clock history and time-off requests, and remove every unchecked account below. This can't be undone. Continue?">
          <div class="stack" style="gap:0.5rem;">
            <strong>Accounts to keep:</strong>
            ${rows}
          </div>
          <label>Type <strong>RESET</strong> to confirm<input type="text" name="confirm" required placeholder="RESET" autocomplete="off"></label>
          <button type="submit" class="btn btn-danger">Reset now</button>
        </form>
      </div>
      <a class="btn" href="/manager/staff">← Back</a>`;
    sendHtml(ctx, { title: 'Reset for go-live', activePath: '/manager/staff', body });
  });

  router.post('/manager/reset', (ctx) => {
    if (requireRole(ctx, 'owner')) return;
    const body = ctx.body || {};
    if ((body.confirm || '').trim().toUpperCase() !== 'RESET') {
      redirect(ctx.res, '/manager/reset', { type: 'error', message: 'Type RESET exactly (all caps) to confirm — nothing was changed.' });
      return;
    }
    const data = ctx.db.load();
    const keepIds = data.users.filter((u) => body[`keep_${u.id}`] === 'on').map((u) => u.id);
    // Whoever is running the reset can never accidentally remove themselves.
    if (!keepIds.includes(ctx.user.id)) keepIds.push(ctx.user.id);

    const before = data.users.length;
    const removedUsers = data.users.filter((u) => !keepIds.includes(u.id));
    data.users = data.users.filter((u) => keepIds.includes(u.id));
    const removedCount = before - data.users.length;
    // Clean up any uploaded HR documents (contracts etc) for removed accounts
    // so they don't linger on disk with no record pointing to them.
    removedUsers.forEach((u) => deleteAllForUser(u.id));
    data.shifts = [];
    data.clockEvents = [];
    data.timeOffRequests = [];
    ctx.db.save(data);

    redirect(ctx.res, '/manager/staff', {
      type: 'success',
      message: `Reset complete — kept ${data.users.length} account(s), removed ${removedCount}, and cleared all shifts, clock history and time-off requests.`,
    });
  });

  router.post('/manager/staff', async (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const {
      name,
      email,
      position,
      payType,
      hourlyRate,
      annualSalary,
      holidayAllowanceDays,
      holidayAdjustmentHours,
      holidayAdjustmentDays,
      password,
      role,
      departmentId,
    } = ctx.body || {};
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
    const validDept = (data.departments || []).some((d) => d.id === departmentId);
    const maxOrder = data.users.reduce((max, u) => Math.max(max, u.rotaSortOrder || 0), -1);
    data.users.push({
      id: uuid(),
      name,
      email,
      passwordHash: hashPassword(password),
      role: assignedRole,
      position: position || 'Staff',
      departmentId: validDept ? departmentId : null,
      payType: payType === 'salary' ? 'salary' : 'hourly',
      annualSalary: Number(annualSalary) || 0,
      holidayAllowanceDays: Number(holidayAllowanceDays) || 0,
      holidayAdjustmentHours: Number(holidayAdjustmentHours) || 0,
      holidayAdjustmentDays: Number(holidayAdjustmentDays) || 0,
      hourlyRate: Number(hourlyRate) || 0,
      active: true,
      onRota: true,
      rotaSortOrder: maxOrder + 1,
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
                  <div class="muted">${escapeHtml(fullDateLabel(londonDateKey(e.timestamp)))} · ${fmtTimeLabel(e.timestamp)}</div>
                </div>
                <div class="row" style="gap:0.5rem;">
                  <a class="link-btn-plain" href="/manager/staff/${u.id}/clock/${e.id}/edit">Edit</a>
                  <form method="POST" action="/manager/staff/${u.id}/clock/${e.id}/delete" data-confirm="Remove this clock ${e.type === 'in' ? 'in' : 'out'} entry? This can't be undone.">
                    <button type="submit" class="link-btn-plain">Remove</button>
                  </form>
                </div>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No clock events yet.</li>';

    const disciplinaryEntries = (u.disciplinary || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const disciplinaryHtml = disciplinaryEntries.length
      ? disciplinaryEntries
          .map(
            (d) => `<li>
              <div class="row" style="align-items:center;">
                <div>
                  <span class="badge badge-pending">${escapeHtml(d.type)}</span>
                  <div class="muted">${escapeHtml(fullDateLabel(d.date))}</div>
                  ${d.notes ? `<p style="margin:0.35rem 0 0;">${escapeHtml(d.notes)}</p>` : ''}
                </div>
                <form method="POST" action="/manager/staff/${u.id}/disciplinary/${d.id}/delete" data-confirm="Remove this disciplinary entry? This can't be undone.">
                  <button type="submit" class="link-btn-plain">Remove</button>
                </form>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No disciplinary entries.</li>';

    const contracts = (u.contracts || []).slice().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const contractsHtml = contracts.length
      ? contracts
          .map(
            (c) => `<li>
              <div class="row" style="align-items:center;">
                <div>
                  <a href="/manager/staff/${u.id}/contracts/${c.id}" target="_blank" rel="noopener">${escapeHtml(c.filename)}</a>
                  <div class="muted">${escapeHtml(c.type || 'Document')}${c.date ? ` · ${escapeHtml(fullDateLabel(c.date))}` : ''} · ${fmtFileSize(c.size)}</div>
                  ${c.notes ? `<p style="margin:0.35rem 0 0;">${escapeHtml(c.notes)}</p>` : ''}
                </div>
                <form method="POST" action="/manager/staff/${u.id}/contracts/${c.id}/delete" data-confirm="Remove this document? This can't be undone.">
                  <button type="submit" class="link-btn-plain">Remove</button>
                </form>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No documents uploaded yet.</li>';

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
            <label>Time<input type="time" name="time" required value="${nowTimeLabelUK()}"></label>
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
          <div class="row">
            <label>Department
              <select name="departmentId">
                <option value="">— None —</option>
                ${departmentOptionsHtml(data, u.departmentId)}
              </select>
            </label>
            <div></div>
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
          <div class="row">
            <div data-paytype-field="hourly"><label>Holiday adjustment (hrs)<input type="number" step="0.1" name="holidayAdjustmentHours" value="${u.holidayAdjustmentHours || 0}"></label></div>
            <div data-paytype-field="salary"><label>Holiday adjustment (days)<input type="number" step="0.5" name="holidayAdjustmentDays" value="${u.holidayAdjustmentDays || 0}"></label></div>
          </div>
          <p class="muted mt-0">Use this to carry over a starting balance when moving someone here from another
            system (e.g. Planday) mid-year — enter what they're owed as of today. Positive if they have holiday
            still owed from before, negative if they'd already taken more than they'd earned. It's added on top
            of what this app works out, and shown separately on the Holiday page so it's never hidden.</p>
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
      </div>
      <div class="card">
        <h2>Emergency contact</h2>
        <p class="muted mt-0">Who to contact if something happens to them at work. ${u.id === ctx.user.id ? 'You can also update this yourself from My account.' : 'They can also update this themselves from their account.'}</p>
        <form method="POST" action="/manager/staff/${u.id}/emergency-contact" class="stack">
          <div class="row">
            <label>Name<input type="text" name="ecName" value="${escapeHtml((u.emergencyContact && u.emergencyContact.name) || '')}"></label>
            <label>Relationship<input type="text" name="ecRelationship" placeholder="e.g. Partner, Parent" value="${escapeHtml((u.emergencyContact && u.emergencyContact.relationship) || '')}"></label>
          </div>
          <label>Phone number<input type="tel" name="ecPhone" value="${escapeHtml((u.emergencyContact && u.emergencyContact.phone) || '')}"></label>
          <button type="submit" class="btn">Save emergency contact</button>
        </form>
      </div>
      <div class="card">
        <h2>Health information</h2>
        <p class="muted mt-0">Anything relevant to keeping them safe at work — allergies, conditions, medication
          that matters on shift. Visible to you and other managers only; keep it to what's actually needed for
          their safety at work.</p>
        <form method="POST" action="/manager/staff/${u.id}/health" class="stack">
          <label>Notes<textarea name="healthInfo" rows="4">${escapeHtml(u.healthInfo || '')}</textarea></label>
          <button type="submit" class="btn">Save</button>
        </form>
      </div>
      <div class="card">
        <h2>Disciplinary record</h2>
        <p class="muted mt-0">Visible to you and other managers only.</p>
        <ul class="list-plain">${disciplinaryHtml}</ul>
        <hr class="sep">
        <form method="POST" action="/manager/staff/${u.id}/disciplinary" class="stack">
          <div class="row">
            <label>Type
              <select name="type">${DISCIPLINARY_TYPES.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>
            </label>
            <label>Date<input type="date" name="date" required value="${todayISO()}"></label>
          </div>
          <label>Notes<textarea name="notes" rows="3" placeholder="What happened, who was involved, any outcome or action taken..."></textarea></label>
          <button type="submit" class="btn">Add entry</button>
        </form>
      </div>
      <div class="card">
        <h2>Contracts &amp; documents</h2>
        <p class="muted mt-0">Signed contracts, right-to-work checks, and other paperwork for this person.</p>
        <ul class="list-plain">${contractsHtml}</ul>
        <hr class="sep">
        <form method="POST" action="/manager/staff/${u.id}/contracts" enctype="multipart/form-data" class="stack">
          <label>File (PDF, Word doc, or image)<input type="file" name="file" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"></label>
          <div class="row">
            <label>Type<input type="text" name="type" placeholder="e.g. Contract of employment"></label>
            <label>Date<input type="date" name="date" value="${todayISO()}"></label>
          </div>
          <label>Notes (optional)<textarea name="notes" rows="2"></textarea></label>
          <button type="submit" class="btn">Upload</button>
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
    if (!canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Only the owner can manage manager accounts.' });
      return;
    }
    const {
      name,
      email,
      position,
      payType,
      hourlyRate,
      annualSalary,
      holidayAllowanceDays,
      holidayAdjustmentHours,
      holidayAdjustmentDays,
      onRota,
      role,
      departmentId,
    } = ctx.body || {};
    if (name) u.name = name;
    if (email) u.email = email;
    u.position = position || u.position;
    u.payType = payType === 'salary' ? 'salary' : 'hourly';
    u.hourlyRate = Number(hourlyRate) || 0;
    u.annualSalary = Number(annualSalary) || 0;
    u.holidayAllowanceDays = Number(holidayAllowanceDays) || 0;
    u.holidayAdjustmentHours = Number(holidayAdjustmentHours) || 0;
    u.holidayAdjustmentDays = Number(holidayAdjustmentDays) || 0;
    u.onRota = onRota === 'on';
    u.departmentId = (data.departments || []).some((d) => d.id === departmentId) ? departmentId : null;
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
      timestamp: londonWallTimeToISO(date, time),
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

  // Fixes a clock in/out event that's already on record — e.g. a staff
  // member forgot to clock in/out and a manager needs to correct the time,
  // rather than delete it and add a fresh manual one.
  router.get('/manager/staff/:id/clock/:eventId/edit', (ctx) => {
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
    const event = data.clockEvents.find((e) => e.id === ctx.params.eventId && e.userId === u.id);
    if (!event) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Clock event not found.' });
      return;
    }
    const ts = new Date(event.timestamp);
    // en-CA gives YYYY-MM-DD, which is what <input type="date"> needs — both
    // pinned to Europe/London so this matches what the manager actually sees
    // elsewhere on the page (fmtTimeLabel uses the same timezone).
    const dateVal = ts.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const timeVal = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
    const body = `
      <div class="page-head"><h1>Edit clock event</h1></div>
      <div class="card">
        <p><strong>${escapeHtml(u.name)}</strong></p>
        <form method="POST" action="/manager/staff/${u.id}/clock/${event.id}/edit" class="stack">
          <div class="row">
            <label>Type
              <select name="type">
                <option value="in" ${event.type === 'in' ? 'selected' : ''}>Clock in</option>
                <option value="out" ${event.type === 'out' ? 'selected' : ''}>Clock out</option>
              </select>
            </label>
            <label>Date<input type="date" name="date" required value="${dateVal}"></label>
            <label>Time<input type="time" name="time" required value="${timeVal}"></label>
          </div>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </form>
        <a class="btn" style="margin-top:0.75rem;" href="/manager/staff/${u.id}">Cancel</a>
      </div>`;
    sendHtml(ctx, { title: 'Edit clock event', activePath: '/manager/staff', body });
  });

  router.post('/manager/staff/:id/clock/:eventId/edit', (ctx) => {
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
    const event = data.clockEvents.find((e) => e.id === ctx.params.eventId && e.userId === u.id);
    if (!event) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Clock event not found.' });
      return;
    }
    const { type, date, time } = ctx.body || {};
    if (!['in', 'out'].includes(type) || !date || !time) {
      redirect(ctx.res, `/manager/staff/${u.id}/clock/${event.id}/edit`, {
        type: 'error',
        message: 'Please provide a type, date and time.',
      });
      return;
    }
    event.type = type;
    event.timestamp = londonWallTimeToISO(date, time);
    event.source = 'manual';
    event.editedBy = ctx.user.id;
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Clock event updated.' });
  });

  router.post('/manager/staff/:id/emergency-contact', (ctx) => {
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
    const { ecName, ecRelationship, ecPhone } = ctx.body || {};
    u.emergencyContact = { name: (ecName || '').trim(), relationship: (ecRelationship || '').trim(), phone: (ecPhone || '').trim() };
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Emergency contact saved.' });
  });

  router.post('/manager/staff/:id/health', (ctx) => {
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
    u.healthInfo = (ctx.body && ctx.body.healthInfo ? ctx.body.healthInfo : '').trim();
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Health information saved.' });
  });

  router.post('/manager/staff/:id/disciplinary', (ctx) => {
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
    const { type, date, notes } = ctx.body || {};
    if (!date) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'A date is required for a disciplinary entry.' });
      return;
    }
    if (!u.disciplinary) u.disciplinary = [];
    u.disciplinary.push({
      id: uuid(),
      type: DISCIPLINARY_TYPES.includes(type) ? type : 'Other',
      date,
      notes: (notes || '').trim(),
      addedBy: ctx.user.id,
      createdAt: nowISO(),
    });
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Disciplinary entry added.' });
  });

  router.post('/manager/staff/:id/disciplinary/:entryId/delete', (ctx) => {
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
    const before = (u.disciplinary || []).length;
    u.disciplinary = (u.disciplinary || []).filter((d) => d.id !== ctx.params.entryId);
    const removed = u.disciplinary.length < before;
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: removed ? 'success' : 'error', message: removed ? 'Disciplinary entry removed.' : 'Entry not found.' });
  });

  router.post('/manager/staff/:id/contracts', (ctx) => {
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
    const file = ctx.files && ctx.files.file;
    if (!file || !file.data || !file.data.length) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Choose a file to upload.' });
      return;
    }
    let meta;
    try {
      meta = saveContractFile(u.id, file);
    } catch (err) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: err.message });
      return;
    }
    const { type, date, notes } = ctx.body || {};
    meta.type = (type || '').trim();
    meta.date = date || '';
    meta.notes = (notes || '').trim();
    meta.uploadedAt = nowISO();
    meta.uploadedBy = ctx.user.id;
    if (!u.contracts) u.contracts = [];
    u.contracts.push(meta);
    ctx.db.save(data);
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'success', message: 'Document uploaded.' });
  });

  router.get('/manager/staff/:id/contracts/:fileId', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.params.id);
    if (!u || !canManageUser(ctx.user, u)) {
      redirect(ctx.res, '/manager/staff', { type: 'error', message: 'Not found.' });
      return;
    }
    const doc = (u.contracts || []).find((c) => c.id === ctx.params.fileId);
    if (!doc) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'Document not found.' });
      return;
    }
    const filePath = contractAbsolutePath(doc.storedPath);
    if (!fs.existsSync(filePath)) {
      redirect(ctx.res, `/manager/staff/${u.id}`, { type: 'error', message: 'That file is missing from storage.' });
      return;
    }
    ctx.res.writeHead(200, {
      'Content-Type': doc.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
    });
    fs.createReadStream(filePath).pipe(ctx.res);
  });

  router.post('/manager/staff/:id/contracts/:fileId/delete', (ctx) => {
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
    const doc = (u.contracts || []).find((c) => c.id === ctx.params.fileId);
    if (doc) {
      deleteContractFile(doc.storedPath);
      u.contracts = u.contracts.filter((c) => c.id !== ctx.params.fileId);
      ctx.db.save(data);
    }
    redirect(ctx.res, `/manager/staff/${u.id}`, { type: doc ? 'success' : 'error', message: doc ? 'Document removed.' : 'Document not found.' });
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

    // Group staff by department (in the order departments were created),
    // with anyone unassigned in a final group. Only show group headers/
    // colours at all once at least one department has been set up.
    const departments = data.departments || [];
    const showGroups = departments.length > 0;
    const byOrder = (a, b) => (a.rotaSortOrder ?? 0) - (b.rotaSortOrder ?? 0);
    const groups = [];
    departments.forEach((dept) => {
      const members = staff.filter((u) => u.departmentId === dept.id).sort(byOrder);
      if (members.length) groups.push({ dept, members });
    });
    const ungrouped = staff.filter((u) => !u.departmentId || !departments.some((d) => d.id === u.departmentId)).sort(byOrder);
    if (ungrouped.length) groups.push({ dept: null, members: ungrouped });

    const bodyRows = groups
      .map((group) => {
        const colorClass = group.dept ? `dept-row-${group.dept.colorIndex % PALETTE_SIZE}` : '';
        const accentClass = group.dept ? `dept-accent-${group.dept.colorIndex % PALETTE_SIZE}` : '';
        const deptHeaderRow = showGroups
          ? `<tr class="dept-group-row ${colorClass}"><td colspan="${days.length + 1}">${group.dept ? escapeHtml(group.dept.name) : 'No department'}</td></tr>`
          : '';
        const memberRows = group.members
          .map((u) => {
            const cells = days
              .map((d) => {
                const shifts = weekShifts.filter((s) => s.userId === u.id && s.date === d);
                const chips = shifts
                  .map((s) => {
                    const shiftData = escapeHtml(
                      JSON.stringify({ id: s.id, userId: s.userId, date: s.date, start: s.start, end: s.end, role: s.role, breakMinutes: s.breakMinutes || 0, notes: s.notes || '' })
                    );
                    return `<div class="shift-chip-wrap" draggable="true" data-shift="${shiftData}">
                      <a class="shift-chip${s.published ? '' : ' draft'}" href="/manager/rota/shift?id=${s.id}&week=${weekStart}">${escapeHtml(s.start)}–${escapeHtml(s.end)}<small>${escapeHtml(s.role)}${s.breakMinutes ? ` · ${s.breakMinutes}min break` : ''}${s.published ? '' : ' · draft'}</small></a>
                      <button type="button" class="chip-copy-btn" title="Copy this shift" aria-label="Copy this shift">⧉</button>
                    </div>`;
                  })
                  .join('');
                return `<td class="rota-cell" data-userid="${u.id}" data-date="${d}">${chips}<a class="add-shift-link" href="/manager/rota/shift?userId=${u.id}&date=${d}&week=${weekStart}">+ Add shift</a><button type="button" class="paste-shift-btn" style="display:none;" data-userid="${u.id}" data-date="${d}">📋 Paste shift</button></td>`;
              })
              .join('');
            return `<tr data-user-id="${u.id}" data-department-id="${group.dept ? group.dept.id : ''}"><td class="${accentClass}"><span class="row-drag-handle" draggable="true" title="Drag to reorder">⋮⋮</span><strong>${escapeHtml(u.name)}</strong><div class="muted">${escapeHtml(u.position)}</div>
              <form method="POST" action="/manager/rota/staff/${u.id}/hide" class="no-print" data-confirm="Remove ${escapeHtml(u.name)} from the rota grid? Their account and shifts already assigned are unaffected — you can add them back any time.">
                <input type="hidden" name="week" value="${weekStart}">
                <button type="submit" class="link-btn-plain">Remove from rota</button>
              </form></td>${cells}</tr>`;
          })
          .join('');
        return deptHeaderRow + memberRows;
      })
      .join('');

    const hiddenHtml = hidden.length
      ? `<div class="card no-print">
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

    const templates = data.rotaTemplates || [];
    const templatesOptionsHtml = templates
      .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.shifts.length} shift${t.shifts.length === 1 ? '' : 's'})</option>`)
      .join('');
    const templatesCardHtml = `
      <div class="card no-print">
        <h2>Templates</h2>
        <p class="muted mt-0">Save a typical week's shifts as a template, then apply it to any future week instead
          of rebuilding it from scratch. Applying a template only adds a shift where that person doesn't already
          have one that day — it won't overwrite or duplicate anything, and applied shifts are added as drafts so
          you can review before publishing.</p>
        <div class="row">
          <form method="POST" action="/manager/rota/templates" class="stack" style="flex:1;">
            <input type="hidden" name="week" value="${weekStart}">
            <label>Save this week as a template<input type="text" name="name" placeholder="e.g. Standard week" required></label>
            <button type="submit" class="btn btn-sm">Save as template</button>
          </form>
          ${templates.length ? `<form method="POST" action="/manager/rota/templates/apply" class="stack" style="flex:1;" data-confirm="Apply this template to the week of ${escapeHtml(fullDateLabel(weekStart))}? It only adds shifts where someone doesn't already have one that day.">
            <input type="hidden" name="week" value="${weekStart}">
            <label>Apply a template to this week
              <select name="templateId">${templatesOptionsHtml}</select>
            </label>
            <button type="submit" class="btn btn-sm">Apply to this week</button>
          </form>` : ''}
        </div>
        ${templates.length ? `<a href="/manager/rota/templates" class="link-btn-plain" style="margin-top:0.5rem;display:inline-block;">Manage saved templates →</a>` : ''}
      </div>`;

    const body = `
      <div class="page-head">
        <h1>Rota builder</h1>
        <div class="row no-print" style="gap:0.5rem;">
          <button type="button" class="btn btn-sm" onclick="window.print()">🖨️ Print rota</button>
          <a class="btn btn-sm" href="/manager/staff">+ Add / manage staff</a>
        </div>
      </div>
      <div id="shift-clipboard-bar" class="clipboard-bar no-print" style="display:none;"></div>
      <div class="week-nav">
        <a class="btn btn-sm no-print" href="/manager/rota?week=${addDays(weekStart, -7)}">← Prev week</a>
        <span class="label">${escapeHtml(fullDateLabel(weekStart))} – ${escapeHtml(fullDateLabel(weekEnd))}</span>
        <a class="btn btn-sm no-print" href="/manager/rota?week=${addDays(weekStart, 7)}">Next week →</a>
        ${anyShift ? (anyDraft
          ? `<form method="POST" action="/manager/rota/publish" class="inline-form no-print"><input type="hidden" name="week" value="${weekStart}"><button type="submit" class="btn btn-amber">Publish week to staff</button></form>`
          : `<span class="badge badge-published">Published</span>`) : ''}
      </div>
      ${staff.length === 0 ? '<div class="card"><p class="empty-state">Add staff members first before building a rota.</p></div>' : `
      <div class="card">
        <p class="muted mt-0 no-print">On a computer, drag a shift onto another day or person to move it, use the ⧉ button to
          copy one and paste it elsewhere, or drag the ⋮⋮ handle next to a name to reorder staff (within their
          department group). <a href="/manager/departments">Manage departments →</a></p>
        <div class="table-wrap">
          <table class="rota-grid" data-week="${weekStart}">
            <thead>${headerRow}</thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
      ${templatesCardHtml}`}
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
        // Also lets a drag-and-drop move (or a paste target) reassign who
        // the shift belongs to and which day it's on, not just its times.
        shift.userId = userId;
        shift.date = date;
      }
    } else {
      data.shifts.push({ id: uuid(), userId, date, start, end, role: role || 'Staff', notes: notes || '', breakMinutes: breakMins, published: false });
    }
    ctx.db.save(data);
    if (ctx.req.headers['x-requested-with'] === 'fetch') {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ ok: true }));
      return;
    }
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

  router.post('/manager/rota/staff/reorder', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { draggedUserId, targetUserId, position, week } = ctx.body || {};
    const redirectTo = `/manager/rota?week=${week || startOfWeek(todayISO())}`;
    const data = ctx.db.load();
    const dragged = data.users.find((u) => u.id === draggedUserId);
    const target = data.users.find((u) => u.id === targetUserId);
    if (!dragged || !target || dragged.id === target.id) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Could not reorder — staff member not found.' });
      return;
    }
    if ((dragged.departmentId || null) !== (target.departmentId || null)) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Staff can only be reordered within the same department group.' });
      return;
    }
    const group = rotaStaff(data)
      .filter((u) => (u.departmentId || null) === (dragged.departmentId || null))
      .sort((a, b) => (a.rotaSortOrder ?? 0) - (b.rotaSortOrder ?? 0));
    const without = group.filter((u) => u.id !== dragged.id);
    let targetIdx = without.findIndex((u) => u.id === target.id);
    if (position === 'after') targetIdx += 1;
    without.splice(targetIdx, 0, dragged);
    without.forEach((u, i) => (u.rotaSortOrder = i));
    ctx.db.save(data);
    redirect(ctx.res, redirectTo, { type: 'success', message: `${dragged.name} reordered.` });
  });

  // ---------------- Rota templates ----------------
  router.get('/manager/rota/templates', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const templates = (data.rotaTemplates || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const rows = templates.length
      ? templates
          .map(
            (t) => `<li>
              <div class="row" style="align-items:center;">
                <div><strong>${escapeHtml(t.name)}</strong> <span class="muted">${t.shifts.length} shift${t.shifts.length === 1 ? '' : 's'} · saved ${escapeHtml(fullDateLabel(t.createdAt.slice(0, 10)))}</span></div>
                <form method="POST" action="/manager/rota/templates/${t.id}/delete" data-confirm="Delete the template &quot;${escapeHtml(t.name)}&quot;? This can't be undone.">
                  <button type="submit" class="link-btn-plain">Delete</button>
                </form>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No templates saved yet.</li>';
    const body = `
      <div class="page-head"><h1>Rota templates</h1></div>
      <div class="card">
        <p class="muted mt-0">Templates are saved from a specific week's shifts on the Rota builder page, and can
          be applied to any future week from there.</p>
        <ul class="list-plain">${rows}</ul>
      </div>
      <a class="btn" href="/manager/rota">← Back to rota builder</a>`;
    sendHtml(ctx, { title: 'Rota templates', activePath: '/manager/rota', body });
  });

  router.post('/manager/rota/templates', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { name, week } = ctx.body || {};
    const weekStart = week || startOfWeek(todayISO());
    const redirectTo = `/manager/rota?week=${weekStart}`;
    if (!name || !name.trim()) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Give the template a name.' });
      return;
    }
    const data = ctx.db.load();
    const weekEnd = addDays(weekStart, 6);
    const weekShifts = data.shifts.filter((s) => s.date >= weekStart && s.date <= weekEnd);
    if (!weekShifts.length) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'This week has no shifts to save as a template.' });
      return;
    }
    const templateShifts = weekShifts.map((s) => ({
      userId: s.userId,
      dayOffset: daysBetweenInclusive(weekStart, s.date) - 1,
      start: s.start,
      end: s.end,
      role: s.role,
      breakMinutes: s.breakMinutes || 0,
      notes: s.notes || '',
    }));
    if (!data.rotaTemplates) data.rotaTemplates = [];
    data.rotaTemplates.push({ id: uuid(), name: name.trim(), createdAt: nowISO(), createdBy: ctx.user.id, shifts: templateShifts });
    ctx.db.save(data);
    redirect(ctx.res, redirectTo, { type: 'success', message: `Saved "${name.trim()}" as a template (${templateShifts.length} shift${templateShifts.length === 1 ? '' : 's'}).` });
  });

  router.post('/manager/rota/templates/:id/delete', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const data = ctx.db.load();
    const before = (data.rotaTemplates || []).length;
    data.rotaTemplates = (data.rotaTemplates || []).filter((t) => t.id !== ctx.params.id);
    const removed = data.rotaTemplates.length < before;
    ctx.db.save(data);
    redirect(ctx.res, '/manager/rota/templates', { type: removed ? 'success' : 'error', message: removed ? 'Template deleted.' : 'Template not found.' });
  });

  router.post('/manager/rota/templates/apply', (ctx) => {
    if (requireRole(ctx, 'manager')) return;
    const { templateId, week } = ctx.body || {};
    const weekStart = week || startOfWeek(todayISO());
    const redirectTo = `/manager/rota?week=${weekStart}`;
    const data = ctx.db.load();
    const template = (data.rotaTemplates || []).find((t) => t.id === templateId);
    if (!template) {
      redirect(ctx.res, redirectTo, { type: 'error', message: 'Template not found.' });
      return;
    }
    const activeUserIds = new Set(data.users.filter((u) => u.active).map((u) => u.id));
    let applied = 0;
    let skipped = 0;
    template.shifts.forEach((ts) => {
      if (!activeUserIds.has(ts.userId)) {
        skipped++;
        return;
      }
      const date = addDays(weekStart, ts.dayOffset);
      const alreadyHasShift = data.shifts.some((s) => s.userId === ts.userId && s.date === date);
      if (alreadyHasShift) {
        skipped++;
        return;
      }
      data.shifts.push({
        id: uuid(),
        userId: ts.userId,
        date,
        start: ts.start,
        end: ts.end,
        role: ts.role,
        notes: ts.notes || '',
        breakMinutes: ts.breakMinutes || 0,
        published: false,
      });
      applied++;
    });
    ctx.db.save(data);
    const skippedNote = skipped ? ` (${skipped} skipped — already had a shift that day, or no longer active)` : '';
    redirect(ctx.res, redirectTo, { type: 'success', message: `Applied "${template.name}" — added ${applied} shift${applied === 1 ? '' : 's'} as drafts${skippedNote}.` });
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
        const adjCell =
          bal.adjustment === 0
            ? '<span class="muted">—</span>'
            : `<span style="color:${bal.adjustment > 0 ? 'var(--green-900)' : 'var(--red-500)'};">${bal.adjustment > 0 ? '+' : ''}${fmt(bal.adjustment)}</span>`;
        return `<tr>
          <td><a href="/manager/staff/${u.id}">${escapeHtml(u.name)}</a><div class="muted">${escapeHtml(u.position)}</div></td>
          <td>${u.payType === 'salary' ? 'Salary' : 'Hourly (12.07% accrual)'}</td>
          <td class="text-right">${fmt(bal.accrued)}</td>
          <td class="text-right">${adjCell}</td>
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
            <thead><tr><th>Staff</th><th>Basis</th><th class="text-right">Accrued / allowance</th><th class="text-right">Adjustment</th><th class="text-right">Taken</th><th class="text-right">Remaining</th></tr></thead>
            <tbody>${balanceRows || '<tr><td colspan="6" class="empty-state">No active staff.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:0.75rem;">Hourly staff accrue 12.07% of hours actually worked so far
          this holiday year — their "remaining" figure grows as they work more hours. Salaried staff get their
          full day allowance from day one of the year. <strong>Adjustment</strong> is a manual correction set on
          someone's staff profile — mainly for carrying over a starting balance when moving them here from
          another system mid-year.</p>
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
        return `<tr><td><a href="/manager/staff/${u.id}">${escapeHtml(u.name)}</a><div class="muted">${escapeHtml(u.position)}</div></td><td class="text-right">${fmtHours(hrs)} hrs</td><td class="text-right">${costCell}</td></tr>`;
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
        <p class="muted" style="margin-top:0.75rem;">Estimated labour cost before tax, NI or on-costs — for planning only.
          Click a name to see their clock events — handy if someone forgot to clock in or out and their hours look wrong.</p>
      </div>`;
    sendHtml(ctx, { title: 'Timesheets', activePath: '/manager/timesheets', body });
  });
};
