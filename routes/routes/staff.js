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
  fmtTimeLabel,
} = require('../lib/util');
const { currentStatus, groupHoursByDate, eventsForUser } = require('../lib/timesheet');

module.exports = function (router) {
  // ---------------- Dashboard / Clock ----------------
  router.get('/staff', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const status = currentStatus(data, ctx.user.id);
    const today = todayISO();
    const todaysShifts = data.shifts
      .filter((s) => s.userId === ctx.user.id && s.date === today && s.published)
      .sort((a, b) => a.start.localeCompare(b.start));
    const hoursToday = Object.values(groupHoursByDate(data, ctx.user.id, today, today)).reduce((a, b) => a + b, 0);

    const shiftHtml = todaysShifts.length
      ? todaysShifts
          .map(
            (s) => `<li><strong>${escapeHtml(s.start)}–${escapeHtml(s.end)}</strong> · ${escapeHtml(s.role)}${s.notes ? ` — <span class="muted">${escapeHtml(s.notes)}</span>` : ''}</li>`
          )
          .join('')
      : '<li class="muted">No shift scheduled today.</li>';

    const body = `
      <div class="page-head"><h1>Hi ${escapeHtml(ctx.user.name.split(' ')[0])} 👋</h1></div>
      <div class="card clock-card">
        <div id="live-clock" class="clock-time">--:--:--</div>
        <div class="clock-status">
          ${status.clockedIn ? `Clocked in since <strong>${fmtTimeLabel(status.since)}</strong> · ${fmtHours(hoursToday)} hrs so far today` : `You're currently <strong>clocked out</strong>${hoursToday > 0 ? ` · ${fmtHours(hoursToday)} hrs worked today` : ''}`}
        </div>
        <form method="POST" action="/staff/clock">
          <button type="submit" class="clock-btn ${status.clockedIn ? 'out' : 'in'}">
            ${status.clockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </form>
      </div>
      <div class="card">
        <h2>Today's shift</h2>
        <ul class="list-plain">${shiftHtml}</ul>
      </div>`;
    sendHtml(ctx, { title: 'Clock', activePath: '/staff', body });
  });

  router.post('/staff/clock', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const status = currentStatus(data, ctx.user.id);
    const type = status.clockedIn ? 'out' : 'in';
    data.clockEvents.push({ id: uuid(), userId: ctx.user.id, type, timestamp: nowISO() });
    ctx.db.save(data);
    const msg = type === 'in' ? 'Clocked in. Have a good shift!' : 'Clocked out. Nice work!';
    redirect(ctx.res, '/staff', { type: 'success', message: msg });
  });

  // ---------------- Schedule ----------------
  router.get('/staff/schedule', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const today = todayISO();
    const upcoming = data.shifts
      .filter((s) => s.userId === ctx.user.id && s.published && s.date >= today)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

    let body = `<div class="page-head"><h1>My schedule</h1></div>`;
    if (!upcoming.length) {
      body += `<div class="card"><p class="empty-state">No upcoming shifts published yet. Check back once the rota's out.</p></div>`;
    } else {
      const byWeek = {};
      for (const s of upcoming) {
        const wk = startOfWeek(s.date);
        (byWeek[wk] = byWeek[wk] || []).push(s);
      }
      for (const wk of Object.keys(byWeek).sort()) {
        const rows = byWeek[wk]
          .map(
            (s) => `<li><strong>${escapeHtml(dayLabel(s.date))}</strong><br>${escapeHtml(s.start)}–${escapeHtml(s.end)} · ${escapeHtml(s.role)}${s.notes ? `<br><span class="muted">${escapeHtml(s.notes)}</span>` : ''}</li>`
          )
          .join('');
        body += `<div class="card"><h2>Week of ${escapeHtml(fullDateLabel(wk))}</h2><ul class="list-plain">${rows}</ul></div>`;
      }
    }
    sendHtml(ctx, { title: 'Schedule', activePath: '/staff/schedule', body });
  });

  // ---------------- Timesheet ----------------
  router.get('/staff/timesheet', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const weekStart = ctx.query.week && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.week) ? startOfWeek(ctx.query.week) : startOfWeek(todayISO());
    const weekEnd = addDays(weekStart, 6);
    const byDate = groupHoursByDate(data, ctx.user.id, weekStart, weekEnd);

    let total = 0;
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      const hrs = byDate[date] || 0;
      total += hrs;
      rows.push(
        `<tr><td>${escapeHtml(dayLabel(date))}</td><td class="text-right">${hrs > 0 ? fmtHours(hrs) + ' hrs' : '<span class="muted">—</span>'}</td></tr>`
      );
    }
    const rate = ctx.user.hourlyRate || 0;
    const est = total * rate;

    const body = `
      <div class="page-head"><h1>My timesheet</h1></div>
      <div class="week-nav">
        <a class="btn btn-sm" href="/staff/timesheet?week=${addDays(weekStart, -7)}">← Prev week</a>
        <span class="label">${escapeHtml(fullDateLabel(weekStart))} – ${escapeHtml(fullDateLabel(weekEnd))}</span>
        <a class="btn btn-sm" href="/staff/timesheet?week=${addDays(weekStart, 7)}">Next week →</a>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Day</th><th class="text-right">Hours worked</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="text-right">${fmtHours(total)} hrs</td></tr></tfoot>
          </table>
        </div>
        <p class="muted" style="margin-top:0.75rem;">Estimated pay at £${rate.toFixed(2)}/hr: <strong>£${est.toFixed(2)}</strong> (before tax/deductions)</p>
      </div>`;
    sendHtml(ctx, { title: 'Timesheet', activePath: '/staff/timesheet', body });
  });

  // ---------------- Time off ----------------
  router.get('/staff/time-off', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const year = new Date().getFullYear();
    const approvedDaysUsed = data.timeOffRequests
      .filter((r) => r.userId === ctx.user.id && r.status === 'approved' && r.type === 'holiday' && new Date(r.startDate).getFullYear() === year)
      .reduce((sum, r) => sum + daysBetweenInclusive(r.startDate, r.endDate), 0);
    const allowance = ctx.user.holidayAllowanceDays || 0;
    const remaining = Math.max(0, allowance - approvedDaysUsed);

    const myRequests = data.timeOffRequests
      .filter((r) => r.userId === ctx.user.id)
      .sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));

    const rows = myRequests.length
      ? myRequests
          .map(
            (r) => `<li>
              <div class="row" style="align-items:center;">
                <div>
                  <strong>${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''}</strong>
                  <div class="muted">${escapeHtml(r.type)} · ${daysBetweenInclusive(r.startDate, r.endDate)} day(s)${r.reason ? ` — ${escapeHtml(r.reason)}` : ''}</div>
                  ${r.managerNote ? `<div class="muted">Manager note: ${escapeHtml(r.managerNote)}</div>` : ''}
                </div>
                <span class="badge badge-${r.status}">${escapeHtml(r.status)}</span>
              </div>
            </li>`
          )
          .join('')
      : '<li class="muted">No requests yet.</li>';

    const body = `
      <div class="page-head"><h1>Time off</h1></div>
      <div class="card">
        <div class="stat-grid">
          <div class="stat-tile"><div class="num">${remaining}</div><div class="label">Days remaining</div></div>
          <div class="stat-tile"><div class="num">${approvedDaysUsed}</div><div class="label">Days used (${year})</div></div>
          <div class="stat-tile"><div class="num">${allowance}</div><div class="label">Annual allowance</div></div>
        </div>
      </div>
      <div class="card">
        <h2>Request time off</h2>
        <form method="POST" action="/staff/time-off" class="stack">
          <div class="row">
            <label>Type
              <select name="type">
                <option value="holiday">Holiday</option>
                <option value="sick">Sick</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Start date
              <input type="date" name="startDate" required value="${addDays(todayISO(), 7)}">
            </label>
            <label>End date
              <input type="date" name="endDate" required value="${addDays(todayISO(), 7)}">
            </label>
          </div>
          <label>Reason (optional)
            <textarea name="reason" placeholder="Let your manager know any details..."></textarea>
          </label>
          <button type="submit" class="btn btn-primary">Submit request</button>
        </form>
      </div>
      <div class="card">
        <h2>History</h2>
        <ul class="list-plain">${rows}</ul>
      </div>`;
    sendHtml(ctx, { title: 'Time off', activePath: '/staff/time-off', body });
  });

  router.post('/staff/time-off', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const { type, startDate, endDate, reason } = ctx.body || {};
    if (!startDate || !endDate || startDate > endDate) {
      redirect(ctx.res, '/staff/time-off', { type: 'error', message: 'Please provide a valid date range.' });
      return;
    }
    const data = ctx.db.load();
    data.timeOffRequests.push({
      id: uuid(),
      userId: ctx.user.id,
      type: ['holiday', 'sick', 'other'].includes(type) ? type : 'holiday',
      startDate,
      endDate,
      reason: (reason || '').slice(0, 500),
      status: 'pending',
      requestedAt: nowISO(),
      decidedBy: null,
      decidedAt: null,
      managerNote: '',
    });
    ctx.db.save(data);
    redirect(ctx.res, '/staff/time-off', { type: 'success', message: 'Request submitted for approval.' });
  });
};
