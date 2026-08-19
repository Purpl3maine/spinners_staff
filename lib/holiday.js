'use strict';

const { daysBetweenInclusive } = require('./util');
const { totalHoursInRange } = require('./timesheet');

// Standard UK statutory accrual rate for hourly/irregular-hours workers:
// 5.6 weeks' statutory leave ÷ 46.4 working weeks in a year ≈ 12.07%.
const HOLIDAY_ACCRUAL_RATE = 0.1207;

// Returns the {start, end} (YYYY-MM-DD, inclusive) of the holiday year
// containing `dateISO`, given the year resets every 1 April.
function holidayYearFor(dateISO) {
  const d = new Date(dateISO + 'T00:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed: April = 3
  const day = d.getUTCDate();
  const onOrAfterApril1 = month > 3 || (month === 3 && day >= 1);
  const startYear = onOrAfterApril1 ? year : year - 1;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

function approvedHolidayRequests(data, userId, yearStart, yearEnd) {
  return data.timeOffRequests.filter(
    (r) => r.userId === userId && r.type === 'holiday' && r.status === 'approved' && r.startDate >= yearStart && r.startDate <= yearEnd
  );
}

// Computes this holiday year's balance for a user as of `todayISO`.
// Salaried staff: a fixed day allowance, granted in full at the start of the year.
// Hourly staff: accrues 12.07% of hours actually worked so far this year — no
// fixed allowance, since their hours (and so their entitlement) vary week to week.
//
// `holidayAdjustmentDays` / `holidayAdjustmentHours` is a manual +/- correction
// a manager can set on the person's profile — mainly for carrying over a
// starting balance when moving someone onto this app mid-year from another
// system (e.g. Planday): positive if they're owed holiday from before, negative
// if they'd already taken more than they'd accrued there. It's added on top of
// whatever this app calculates, and shown separately so it's never hidden.
function holidayBalance(data, user, todayISO) {
  const { start, end } = holidayYearFor(todayISO);
  const cappedToday = todayISO < end ? todayISO : end;

  if (user.payType === 'salary') {
    const allowance = user.holidayAllowanceDays || 0;
    const adjustment = Number(user.holidayAdjustmentDays) || 0;
    const taken = approvedHolidayRequests(data, user.id, start, end).reduce(
      (sum, r) => sum + daysBetweenInclusive(r.startDate, r.endDate),
      0
    );
    return {
      unit: 'days',
      accrued: allowance,
      adjustment,
      taken,
      remaining: Math.max(0, allowance + adjustment - taken),
      yearStart: start,
      yearEnd: end,
    };
  }

  const hoursWorked = totalHoursInRange(data, user.id, start, cappedToday);
  const accrued = hoursWorked * HOLIDAY_ACCRUAL_RATE;
  const adjustment = Number(user.holidayAdjustmentHours) || 0;
  const taken = approvedHolidayRequests(data, user.id, start, end).reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  return {
    unit: 'hours',
    accrued,
    adjustment,
    taken,
    remaining: Math.max(0, accrued + adjustment - taken),
    yearStart: start,
    yearEnd: end,
  };
}

function fmtBalance(bal) {
  return bal.unit === 'days' ? `${Math.round(bal.remaining * 10) / 10} days` : `${(Math.round(bal.remaining * 10) / 10).toFixed(1)} hrs`;
}

module.exports = { HOLIDAY_ACCRUAL_RATE, holidayYearFor, holidayBalance, approvedHolidayRequests, fmtBalance };
