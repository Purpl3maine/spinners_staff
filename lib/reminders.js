'use strict';

const { londonDateKey, nowTimeLabelUK } = require('./util');
const { currentStatus } = require('./timesheet');
const { sendPushToUser } = require('./push');

// How long before a shift starts (and after it ends) to nudge someone who
// hasn't clocked in/out yet. Kept generous enough to still catch someone
// who was a few minutes late checking their phone, but not so long that a
// reminder fires long after it'd be useful.
const CLOCK_IN_LEAD_MINUTES = 10;
const CLOCK_OUT_LAG_MINUTES = 15;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Checks today's published shifts for anyone who should be nudged to clock
// in (shift starting soon, not clocked in) or clock out (shift ended,
// still clocked in), and sends a push to each. Designed to be called on a
// short interval (see server.js) — each shift is only ever reminded once
// per direction, tracked on the shift itself, so re-running this
// frequently is safe and cheap when there's nothing new to do.
async function runReminderSweep(db) {
  const data = db.load();
  const today = londonDateKey(new Date().toISOString());
  const nowMinutes = toMinutes(nowTimeLabelUK());

  const todaysShifts = data.shifts.filter((s) => s.date === today && s.published && s.userId);
  if (!todaysShifts.length) return;

  let changed = false;
  for (const shift of todaysShifts) {
    shift.remindersSent = shift.remindersSent || {};
    const startMin = toMinutes(shift.start);
    const endMin = toMinutes(shift.end);
    const status = currentStatus(data, shift.userId);

    if (
      !shift.remindersSent.in &&
      !status.clockedIn &&
      nowMinutes >= startMin - CLOCK_IN_LEAD_MINUTES &&
      nowMinutes <= startMin
    ) {
      await sendPushToUser(data, shift.userId, {
        title: 'Clock-in reminder',
        body: `Your shift starts at ${shift.start} — don't forget to clock in.`,
        url: '/staff',
        tag: 'pubshift-clock-in',
      });
      shift.remindersSent.in = true;
      changed = true;
    }

    if (
      !shift.remindersSent.out &&
      status.clockedIn &&
      nowMinutes >= endMin &&
      nowMinutes <= endMin + CLOCK_OUT_LAG_MINUTES
    ) {
      await sendPushToUser(data, shift.userId, {
        title: 'Clock-out reminder',
        body: `Your shift ended at ${shift.end} — don't forget to clock out.`,
        url: '/staff',
        tag: 'pubshift-clock-out',
      });
      shift.remindersSent.out = true;
      changed = true;
    }
  }

  if (changed) db.save(data);
}

module.exports = { runReminderSweep, CLOCK_IN_LEAD_MINUTES, CLOCK_OUT_LAG_MINUTES };
