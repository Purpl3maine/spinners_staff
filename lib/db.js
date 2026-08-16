'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uuid, todayISO, addDays, startOfWeek, nowISO } = require('./util');

// On Railway (or any host using a mounted volume for persistence) set DATA_DIR
// to the volume's mount path so data.json survives deploys/restarts. Falls
// back to RAILWAY_VOLUME_MOUNT_PATH automatically, then to the project folder
// for local development.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
const DB_PATH = path.join(DATA_DIR, 'data.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function seedData() {
  const now = nowISO();
  const manager = {
    id: uuid(),
    name: 'Alex Morgan',
    email: 'manager@pub.local',
    passwordHash: hashPassword('manager123'),
    role: 'manager',
    position: 'General Manager',
    payType: 'salary',
    annualSalary: 32000,
    holidayAllowanceDays: 28,
    hourlyRate: 14.5,
    active: true,
    createdAt: now,
  };

  // Priya is salaried (fixed allowance); everyone else is hourly (12.07% accrual).
  const staffDefs = [
    { name: 'Sam Carter', email: 'sam@pub.local', position: 'Bartender', payType: 'hourly', rate: 11.75, holiday: 28 },
    { name: 'Priya Shah', email: 'priya@pub.local', position: 'Bar Supervisor', payType: 'salary', salary: 27000, rate: 13.25, holiday: 28 },
    { name: 'Tom Wallace', email: 'tom@pub.local', position: 'Kitchen', payType: 'hourly', rate: 12.0, holiday: 28 },
    { name: 'Ella Brennan', email: 'ella@pub.local', position: 'Bartender', payType: 'hourly', rate: 11.75, holiday: 20 },
  ];

  const staff = staffDefs.map((s) => ({
    id: uuid(),
    name: s.name,
    email: s.email,
    passwordHash: hashPassword('staff123'),
    role: 'staff',
    position: s.position,
    payType: s.payType,
    annualSalary: s.salary || 0,
    holidayAllowanceDays: s.holiday,
    hourlyRate: s.rate,
    active: true,
    onRota: true,
    createdAt: now,
  }));

  const users = [manager, ...staff];
  const byName = Object.fromEntries(staff.map((s) => [s.name, s]));

  const thisWeek = startOfWeek(todayISO());
  const nextWeek = addDays(thisWeek, 7);

  const shiftPattern = [
    // [staffName, dayOffset, start, end, role]
    ['Sam Carter', 0, '11:00', '19:00', 'Bar'],
    ['Sam Carter', 2, '17:00', '23:30', 'Bar'],
    ['Sam Carter', 5, '11:00', '19:00', 'Bar'],
    ['Priya Shah', 1, '17:00', '23:30', 'Bar'],
    ['Priya Shah', 3, '11:00', '19:00', 'Bar'],
    ['Priya Shah', 4, '17:00', '23:30', 'Bar'],
    ['Priya Shah', 5, '17:00', '23:30', 'Bar'],
    ['Tom Wallace', 0, '10:00', '15:00', 'Kitchen'],
    ['Tom Wallace', 1, '10:00', '15:00', 'Kitchen'],
    ['Tom Wallace', 4, '16:00', '22:00', 'Kitchen'],
    ['Tom Wallace', 5, '16:00', '22:00', 'Kitchen'],
    ['Ella Brennan', 2, '11:00', '17:00', 'Bar'],
    ['Ella Brennan', 3, '17:00', '23:30', 'Bar'],
    ['Ella Brennan', 6, '12:00', '18:00', 'Bar'],
  ];

  const shifts = [];
  for (const weekStart of [thisWeek, nextWeek]) {
    for (const [name, offset, start, end, role] of shiftPattern) {
      // 8-hour-plus shifts get a demo 30-minute unpaid break.
      const hours = Number(end.slice(0, 2)) - Number(start.slice(0, 2));
      shifts.push({
        id: uuid(),
        userId: byName[name].id,
        date: addDays(weekStart, offset),
        start,
        end,
        role,
        notes: '',
        breakMinutes: hours >= 8 ? 30 : 0,
        published: weekStart === thisWeek,
      });
    }
  }

  // Sam Carter currently clocked in (demo "who's on shift now")
  const clockEvents = [
    {
      id: uuid(),
      userId: byName['Sam Carter'].id,
      type: 'in',
      timestamp: new Date(new Date().setHours(11, 4, 0, 0)).toISOString(),
    },
  ];
  // Yesterday's completed shift for Priya, for timesheet demo
  const yesterday = addDays(todayISO(), -1);
  clockEvents.push(
    { id: uuid(), userId: byName['Priya Shah'].id, type: 'in', timestamp: `${yesterday}T17:02:00.000Z` },
    { id: uuid(), userId: byName['Priya Shah'].id, type: 'out', timestamp: `${yesterday}T23:41:00.000Z` }
  );

  // A few backdated shifts each for Sam and Ella (both hourly) so their
  // 12.07% holiday accrual has some real hours behind it in the demo.
  for (let w = 1; w <= 6; w++) {
    const d1 = addDays(todayISO(), -7 * w - 2);
    const d2 = addDays(todayISO(), -7 * w - 4);
    clockEvents.push(
      { id: uuid(), userId: byName['Sam Carter'].id, type: 'in', timestamp: `${d1}T11:02:00.000Z` },
      { id: uuid(), userId: byName['Sam Carter'].id, type: 'out', timestamp: `${d1}T19:05:00.000Z` },
      { id: uuid(), userId: byName['Ella Brennan'].id, type: 'in', timestamp: `${d2}T11:58:00.000Z` },
      { id: uuid(), userId: byName['Ella Brennan'].id, type: 'out', timestamp: `${d2}T18:02:00.000Z` }
    );
  }

  const timeOffRequests = [
    {
      id: uuid(),
      userId: byName['Priya Shah'].id,
      type: 'holiday',
      startDate: addDays(todayISO(), 14),
      endDate: addDays(todayISO(), 18),
      hours: null,
      reason: 'Family trip',
      status: 'pending',
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      managerNote: '',
    },
    {
      id: uuid(),
      userId: byName['Ella Brennan'].id,
      type: 'holiday',
      startDate: addDays(todayISO(), -30),
      endDate: addDays(todayISO(), -28),
      hours: 18,
      reason: '',
      status: 'approved',
      requestedAt: now,
      decidedBy: manager.id,
      decidedAt: now,
      managerNote: '',
    },
  ];

  return {
    settings: { pubName: 'The Spinners' },
    users,
    shifts,
    clockEvents,
    timeOffRequests,
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  const usingVolume = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
  console.log(`[storage] data directory: ${DATA_DIR}${usingVolume ? ' (persistent volume detected)' : ' (NOT a persistent volume — data will be lost on restart!)'}`);
  if (!fs.existsSync(DB_PATH)) {
    console.log('[storage] no existing data.json found — creating fresh demo data. If you did NOT expect this (e.g. you already set real passwords/staff before), your storage is not persisting between restarts — check the volume is mounted at the right path.');
    cache = seedData();
    save(cache);
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    console.log('[storage] loaded existing data.json successfully.');
  } catch (err) {
    console.error('Failed to read data.json, reseeding:', err.message);
    cache = seedData();
    save(cache);
  }
  return cache;
}

function save(db) {
  cache = db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function resetDemoData() {
  cache = seedData();
  save(cache);
  return cache;
}

module.exports = { load, save, hashPassword, resetDemoData, DB_PATH };
