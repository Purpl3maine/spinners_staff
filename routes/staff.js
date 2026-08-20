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
const { holidayBalance } = require('../lib/holiday');
const { RADIUS_METERS, checkWithinRadius } = require('../lib/geo');

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
            (s) => `<li><strong>${escapeHtml(s.start)}–${escapeHtml(s.end)}</strong> · ${escapeHtml(s.role)}${s.breakMinutes ? ` · ${s.breakMinutes} min unpaid break` : ''}${s.notes ? ` — <span class="muted">${escapeHtml(s.notes)}</span>` : ''}</li>`
          )
          .join('')
      : '<li class="muted">No shift scheduled today.</li>';

    const hasPushSubscription = (ctx.user.pushSubscriptions || []).length > 0;
    const vapidPublicKey = (data.settings.vapid && data.settings.vapid.publicKey) || '';

    const body = `
      <div class="page-head"><h1>Hi ${escapeHtml(ctx.user.name.split(' ')[0])} 👋</h1></div>
      <div class="card clock-card">
        <div id="live-clock" class="clock-time">--:--:--</div>
        <div class="clock-status">
          ${status.clockedIn ? `Clocked in since <strong>${fmtTimeLabel(status.since)}</strong> · ${fmtHours(hoursToday)} hrs so far today` : `You're currently <strong>clocked out</strong>${hoursToday > 0 ? ` · ${fmtHours(hoursToday)} hrs worked today` : ''}`}
        </div>
        <form method="POST" action="/staff/clock" id="clock-form" data-geo-form>
          <input type="hidden" name="lat" value="">
          <input type="hidden" name="lng" value="">
          <button type="button" id="clock-submit-btn" class="clock-btn ${status.clockedIn ? 'out' : 'in'}">
            ${status.clockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </form>
        <p id="clock-geo-status" class="geo-status muted">You need to be at the pub to clock in/out — we'll check your location when you tap the button.</p>
      </div>
      <div class="card">
        <h2>Today's shift</h2>
        <ul class="list-plain">${shiftHtml}</ul>
      </div>
      <div class="card" data-push-card style="display:none;">
        <div class="card-header"><h2>Clock reminders</h2></div>
        <p class="muted mt-0">Get a notification on this device shortly before your shift starts if you haven't
          clocked in, and shortly after it ends if you haven't clocked out.</p>
        <button type="button" class="btn" data-push-toggle data-subscribed="${hasPushSubscription}" data-vapid-key="${escapeHtml(vapidPublicKey)}">
          ${hasPushSubscription ? '🔔 Reminders on — tap to turn off' : '🔔 Enable clock reminders'}
        </button>
      </div>`;
    sendHtml(ctx, { title: 'Clock', activePath: '/staff', body });
  });

  router.post('/staff/push-subscribe', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const sub = ctx.body || {};
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      ctx.res.writeHead(400, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ ok: false, error: 'Invalid subscription' }));
      return;
    }
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.user.id);
    u.pushSubscriptions = u.pushSubscriptions || [];
    // Re-subscribing (e.g. after clearing site data) can produce the same
    // endpoint again — replace rather than duplicate.
    u.pushSubscriptions = u.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint);
    u.pushSubscriptions.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, addedAt: nowISO() });
    ctx.db.save(data);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ ok: true }));
  });

  router.post('/staff/push-unsubscribe', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const { endpoint } = ctx.body || {};
    const data = ctx.db.load();
    const u = data.users.find((x) => x.id === ctx.user.id);
    if (u) {
      u.pushSubscriptions = (u.pushSubscriptions || []).filter((s) => s.endpoint !== endpoint);
      ctx.db.save(data);
    }
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ ok: true }));
  });

  router.post('/staff/clock', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const { lat, lng } = ctx.body || {};
    if (lat === undefined || lng === undefined || lat === '' || lng === '') {
      redirect(ctx.res, '/staff', {
        type: 'error',
        message: "We couldn't get your location. Please allow location access for this site and try again.",
      });
      return;
    }
    const { ok, distance } = checkWithinRadius(lat, lng);
    if (!ok) {
      const distanceNote = distance === null ? '' : ` You're currently about ${distance}m away.`;
      redirect(ctx.res, '/staff', {
        type: 'error',
        message: `You need to be within ${RADIUS_METERS}m of the pub to clock in/out.${distanceNote}`,
      });
      return;
    }
    const data = ctx.db.load();
    const status = currentStatus(data, ctx.user.id);
    const type = status.clockedIn ? 'out' : 'in';
    data.clockEvents.push({ id: uuid(), userId: ctx.user.id, type, timestamp: nowISO(), lat: Number(lat), lng: Number(lng) });
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

    const openShifts = data.shifts
      .filter((s) => !s.userId && s.published && s.date >= today)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const myClaims = (data.shiftClaims || []).filter((c) => c.userId === ctx.user.id && c.status === 'pending');
    const claimedShiftIds = new Set(myClaims.map((c) => c.shiftId));

    let body = `<div class="page-head"><h1>My schedule</h1></div>`;

    if (openShifts.length) {
      const openRows = openShifts
        .map((s) => {
          const requested = claimedShiftIds.has(s.id);
          return `<li>
            <div class="row" style="align-items:center;">
              <div>
                <strong>${escapeHtml(dayLabel(s.date))}</strong> ${escapeHtml(s.start)}–${escapeHtml(s.end)} · ${escapeHtml(s.role)}
                ${s.notes ? `<div class="muted">${escapeHtml(s.notes)}</div>` : ''}
              </div>
              ${requested
                ? `<form method="POST" action="/staff/shift-claims/${myClaims.find((c) => c.shiftId === s.id).id}/cancel">
                    <button type="submit" class="link-btn-plain">Requested — cancel?</button>
                  </form>`
                : `<form method="POST" action="/staff/shift-claims">
                    <input type="hidden" name="shiftId" value="${s.id}">
                    <button type="submit" class="btn btn-sm">Request this shift</button>
                  </form>`}
            </div>
          </li>`;
        })
        .join('');
      body += `<div class="card">
        <h2>Open shifts</h2>
        <p class="muted mt-0">Nobody's assigned to these yet — request one and your manager will approve or decline it.</p>
        <ul class="list-plain">${openRows}</ul>
      </div>`;
    }

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
            (s) => `<li><strong>${escapeHtml(dayLabel(s.date))}</strong><br>${escapeHtml(s.start)}–${escapeHtml(s.end)} · ${escapeHtml(s.role)}${s.breakMinutes ? ` · ${s.breakMinutes} min unpaid break` : ''}${s.notes ? `<br><span class="muted">${escapeHtml(s.notes)}</span>` : ''}</li>`
          )
          .join('');
        body += `<div class="card"><h2>Week of ${escapeHtml(fullDateLabel(wk))}</h2><ul class="list-plain">${rows}</ul></div>`;
      }
    }
    sendHtml(ctx, { title: 'Schedule', activePath: '/staff/schedule', body });
  });

  router.post('/staff/shift-claims', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const { shiftId } = ctx.body || {};
    const data = ctx.db.load();
    const shift = data.shifts.find((s) => s.id === shiftId);
    if (!shift || shift.userId || !shift.published) {
      redirect(ctx.res, '/staff/schedule', { type: 'error', message: 'That shift is no longer open.' });
      return;
    }
    data.shiftClaims = data.shiftClaims || [];
    const alreadyRequested = data.shiftClaims.some((c) => c.shiftId === shiftId && c.userId === ctx.user.id && c.status === 'pending');
    if (alreadyRequested) {
      redirect(ctx.res, '/staff/schedule', { type: 'info', message: "You've already requested that shift." });
      return;
    }
    data.shiftClaims.push({
      id: uuid(),
      shiftId,
      userId: ctx.user.id,
      status: 'pending',
      requestedAt: nowISO(),
      decidedBy: null,
      decidedAt: null,
    });
    ctx.db.save(data);
    redirect(ctx.res, '/staff/schedule', { type: 'success', message: "Request sent — you'll see it here once your manager decides." });
  });

  router.post('/staff/shift-claims/:id/cancel', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    data.shiftClaims = data.shiftClaims || [];
    const before = data.shiftClaims.length;
    data.shiftClaims = data.shiftClaims.filter((c) => !(c.id === ctx.params.id && c.userId === ctx.user.id && c.status === 'pending'));
    const removed = data.shiftClaims.length < before;
    ctx.db.save(data);
    redirect(ctx.res, '/staff/schedule', {
      type: removed ? 'success' : 'error',
      message: removed ? 'Request cancelled.' : 'Request not found.',
    });
  });

  // ---------------- Availability ----------------
  router.get('/staff/availability', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const weekStart = ctx.query.week && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.week) ? startOfWeek(ctx.query.week) : startOfWeek(todayISO());
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const entries = {};
    (data.availability || []).forEach((a) => {
      if (a.userId === ctx.user.id) entries[a.date] = a;
    });

    const rows = days
      .map((d) => {
        const a = entries[d] || {};
        const status = a.status || '';
        return `<div class="availability-day">
          <div class="availability-day-head">${escapeHtml(fullDateLabel(d))}</div>
          <div class="row">
            <label>Status
              <select name="status_${d}">
                <option value=""${status === '' ? ' selected' : ''}>No preference set</option>
                <option value="available"${status === 'available' ? ' selected' : ''}>Available</option>
                <option value="unavailable"${status === 'unavailable' ? ' selected' : ''}>Not available</option>
              </select>
            </label>
            <label>Could start from<input type="time" name="from_${d}" value="${escapeHtml(a.fromTime || '')}"></label>
            <label>Could finish by<input type="time" name="to_${d}" value="${escapeHtml(a.toTime || '')}"></label>
          </div>
          <label>Notes (optional)<input type="text" name="note_${d}" value="${escapeHtml(a.note || '')}" placeholder="e.g. could do evenings only, or free after 3pm"></label>
        </div>`;
      })
      .join('');

    const body = `
      <div class="page-head"><h1>My availability</h1></div>
      <div class="week-nav">
        <a class="btn btn-sm" href="/staff/availability?week=${addDays(weekStart, -7)}">← Prev week</a>
        <span class="label">${escapeHtml(fullDateLabel(weekStart))} – ${escapeHtml(fullDateLabel(addDays(weekStart, 6)))}</span>
        <a class="btn btn-sm" href="/staff/availability?week=${addDays(weekStart, 7)}">Next week →</a>
      </div>
      <div class="card">
        <p class="muted mt-0">Let your manager know which days you can and can't work this week — it shows up
          right on the rota when they're building it. If you're not putting yourself forward for a day but could
          still help out, leave it as "Not available" and note the hours you could manage instead.</p>
        <form method="POST" action="/staff/availability" class="stack">
          <input type="hidden" name="week" value="${weekStart}">
          ${rows}
          <button type="submit" class="btn btn-primary">Save availability</button>
        </form>
      </div>`;
    sendHtml(ctx, { title: 'Availability', activePath: '/staff/availability', body });
  });

  router.post('/staff/availability', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const reqBody = ctx.body || {};
    const weekStart =
      reqBody.week && /^\d{4}-\d{2}-\d{2}$/.test(reqBody.week) ? startOfWeek(reqBody.week) : startOfWeek(todayISO());
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const data = ctx.db.load();
    data.availability = data.availability || [];

    days.forEach((d) => {
      const status = ['available', 'unavailable'].includes(reqBody[`status_${d}`]) ? reqBody[`status_${d}`] : '';
      const fromTime = (reqBody[`from_${d}`] || '').trim();
      const toTime = (reqBody[`to_${d}`] || '').trim();
      const note = (reqBody[`note_${d}`] || '').trim().slice(0, 300);
      const existingIdx = data.availability.findIndex((a) => a.userId === ctx.user.id && a.date === d);

      if (!status && !fromTime && !toTime && !note) {
        // Nothing set for this day — clear any existing entry rather than
        // leaving a stale one behind.
        if (existingIdx !== -1) data.availability.splice(existingIdx, 1);
        return;
      }
      const entry = { id: uuid(), userId: ctx.user.id, date: d, status, fromTime, toTime, note, updatedAt: nowISO() };
      if (existingIdx !== -1) {
        entry.id = data.availability[existingIdx].id;
        data.availability[existingIdx] = entry;
      } else {
        data.availability.push(entry);
      }
    });

    ctx.db.save(data);
    redirect(ctx.res, `/staff/availability?week=${weekStart}`, { type: 'success', message: 'Availability saved.' });
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
    const isSalary = ctx.user.payType === 'salary';
    const rate = ctx.user.hourlyRate || 0;
    const est = total * rate;
    const payNote = isSalary
      ? `You're on a fixed annual salary of £${(ctx.user.annualSalary || 0).toLocaleString('en-GB')} — the hours above are for reference and don't change your pay.`
      : `Estimated pay at £${rate.toFixed(2)}/hr: <strong>£${est.toFixed(2)}</strong> (before tax/deductions)`;

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
        <p class="muted" style="margin-top:0.75rem;">${payNote}</p>
      </div>`;
    sendHtml(ctx, { title: 'Timesheet', activePath: '/staff/timesheet', body });
  });

  // ---------------- Time off ----------------
  router.get('/staff/time-off', (ctx) => {
    if (requireRole(ctx, 'staff')) return;
    const data = ctx.db.load();
    const isHourly = ctx.user.payType !== 'salary';
    const bal = holidayBalance(data, ctx.user, todayISO());

    const myRequests = data.timeOffRequests
      .filter((r) => r.userId === ctx.user.id)
      .sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));

    const rows = myRequests.length
      ? myRequests
          .map((r) => {
            const amount =
              r.type === 'holiday' && isHourly && r.hours
                ? `${r.hours} hrs`
                : `${daysBetweenInclusive(r.startDate, r.endDate)} day(s)`;
            return `<li>
              <div class="row" style="align-items:center;">
                <div>
                  <strong>${escapeHtml(fullDateLabel(r.startDate))}${r.startDate !== r.endDate ? ` → ${escapeHtml(fullDateLabel(r.endDate))}` : ''}</strong>
                  <div class="muted">${escapeHtml(r.type)} · ${amount}${r.reason ? ` — ${escapeHtml(r.reason)}` : ''}</div>
                  ${r.managerNote ? `<div class="muted">Manager note: ${escapeHtml(r.managerNote)}</div>` : ''}
                </div>
                <span class="badge badge-${r.status}">${escapeHtml(r.status)}</span>
              </div>
            </li>`;
          })
          .join('')
      : '<li class="muted">No requests yet.</li>';

    const adjustmentNote =
      bal.adjustment !== 0
        ? `<p class="muted" style="margin-top:0.75rem;">Includes a manual adjustment of ${bal.adjustment > 0 ? '+' : ''}${isHourly ? fmtHours(bal.adjustment) + ' hrs' : Math.round(bal.adjustment * 10) / 10 + ' days'} set by your manager — usually to carry over a balance from before this app.</p>`
        : '';
    const balanceCard = isHourly
      ? `<div class="stat-grid">
          <div class="stat-tile"><div class="num">${fmtHours(bal.remaining)}</div><div class="label">Hours remaining</div></div>
          <div class="stat-tile"><div class="num">${fmtHours(bal.taken)}</div><div class="label">Hours taken</div></div>
          <div class="stat-tile"><div class="num">${fmtHours(bal.accrued)}</div><div class="label">Hours accrued so far</div></div>
        </div>
        <p class="muted" style="margin-top:0.75rem;">You accrue holiday at 12.07% of hours worked, for the holiday
          year running ${escapeHtml(fullDateLabel(bal.yearStart))} to ${escapeHtml(fullDateLabel(bal.yearEnd))}.</p>
        ${adjustmentNote}`
      : `<div class="stat-grid">
          <div class="stat-tile"><div class="num">${Math.round(bal.remaining * 10) / 10}</div><div class="label">Days remaining</div></div>
          <div class="stat-tile"><div class="num">${bal.taken}</div><div class="label">Days used</div></div>
          <div class="stat-tile"><div class="num">${bal.accrued}</div><div class="label">Annual allowance</div></div>
        </div>
        <p class="muted" style="margin-top:0.75rem;">Holiday year: ${escapeHtml(fullDateLabel(bal.yearStart))} to ${escapeHtml(fullDateLabel(bal.yearEnd))}.</p>
        ${adjustmentNote}`;

    const body = `
      <div class="page-head"><h1>Time off</h1></div>
      <div class="card">${balanceCard}</div>
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
          ${isHourly ? `<label>Hours to book off
            <input type="number" name="hours" min="0" step="0.5" placeholder="e.g. 16 for two 8-hour shifts">
          </label>
          <p class="muted mt-0">Since your hours vary week to week, let us know how many paid hours this covers —
            only needed for Holiday requests, we'll use it to deduct from your accrued balance.</p>` : ''}
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
    const { type, startDate, endDate, reason, hours } = ctx.body || {};
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
      hours: ctx.user.payType !== 'salary' ? Math.max(0, Number(hours) || 0) : null,
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
