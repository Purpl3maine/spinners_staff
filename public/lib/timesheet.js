'use strict';

const { hoursBetween, nowISO } = require('./util');

// Pairs a chronologically-sorted list of clock events (in/out) into worked
// intervals. Stray/duplicate events are handled leniently since this is a
// prototype, not a payroll system of record.
function pairEvents(events) {
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const pairs = [];
  let open = null;
  for (const ev of sorted) {
    if (ev.type === 'in') {
      open = ev;
    } else if (ev.type === 'out' && open) {
      pairs.push({ inIso: open.timestamp, outIso: ev.timestamp, ongoing: false });
      open = null;
    }
  }
  if (open) {
    pairs.push({ inIso: open.timestamp, outIso: null, ongoing: true });
  }
  return pairs;
}

function pairHours(pair) {
  const end = pair.outIso || nowISO();
  return hoursBetween(pair.inIso, end);
}

function eventsForUser(db, userId) {
  return db.clockEvents.filter((e) => e.userId === userId);
}

// Total unpaid break minutes recorded on any shift scheduled for this user on this date.
function breakMinutesForDate(db, userId, date) {
  return (db.shifts || [])
    .filter((s) => s.userId === userId && s.date === date)
    .reduce((sum, s) => sum + (Number(s.breakMinutes) || 0), 0);
}

// Groups worked hours by the calendar date of the clock-in, restricted to
// [startDate, endDate] inclusive (YYYY-MM-DD). Unpaid breaks recorded on that
// day's rota shift(s) are deducted from the paid hours total.
function groupHoursByDate(db, userId, startDate, endDate) {
  const pairs = pairEvents(eventsForUser(db, userId));
  const byDate = {};
  for (const pair of pairs) {
    const date = pair.inIso.slice(0, 10);
    if (date < startDate || date > endDate) continue;
    byDate[date] = (byDate[date] || 0) + pairHours(pair);
  }
  for (const date of Object.keys(byDate)) {
    const breakMins = breakMinutesForDate(db, userId, date);
    if (breakMins > 0) {
      byDate[date] = Math.max(0, byDate[date] - breakMins / 60);
    }
  }
  return byDate;
}

function totalHoursInRange(db, userId, startDate, endDate) {
  const byDate = groupHoursByDate(db, userId, startDate, endDate);
  return Object.values(byDate).reduce((a, b) => a + b, 0);
}

function currentStatus(db, userId) {
  const pairs = pairEvents(eventsForUser(db, userId));
  const last = pairs[pairs.length - 1];
  if (last && last.ongoing) {
    return { clockedIn: true, since: last.inIso };
  }
  return { clockedIn: false, since: null };
}

module.exports = {
  pairEvents,
  pairHours,
  eventsForUser,
  groupHoursByDate,
  totalHoursInRange,
  currentStatus,
  breakMinutesForDate,
};
