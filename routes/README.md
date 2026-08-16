# The Spinners Staff App — clock in/out, rota & holiday requests

A working prototype of a Planday-style staff app for The Spinners: clock
in/out, a weekly rota builder, and holiday/absence requests with manager
approval, branded with your logo. It's one responsive web app — staff use it
on their phone (add it to their home screen like an app), managers use it on
desktop or mobile.

**This is a prototype**, built to let you try the concept with real staff
before committing to a bigger build. See "From prototype to production" below
for what that next step looks like — and see **DEPLOY.md** for step-by-step
instructions to put this live at staff.spinnersdarwen.co.uk.

## Quick start

Requirements: [Node.js](https://nodejs.org) version 18 or later. No other
installs, no database setup, no build step — the whole thing is dependency-free.

```bash
cd pubshift
node server.js
```

Then open **http://localhost:3000** in your browser. On first run it creates
`data.json` next to the server with some demo data pre-loaded for The
Spinners (a manager, four staff, a couple of weeks of shifts, and one pending
holiday request) so you can see it in action straight away.

**Demo logins:**

| Role    | Email             | Password  |
|---------|-------------------|-----------|
| Manager | manager@pub.local | manager123 |
| Staff   | sam@pub.local     | staff123   |

(Other seeded staff: priya@pub.local, tom@pub.local, ella@pub.local — all use
`staff123`.)

To reset back to that demo data, stop the server and delete `data.json`, then
start it again.

### Rebranding

The pub name and logo are already set to The Spinners. If you ever want to
change either: the name lives in `lib/db.js` (`settings.pubName`, only takes
effect for a fresh `data.json`), and the logo files are `public/logo.png` and
`public/icon-96/192/512.png` — replace those with a new square image at the
same filenames and it flows through everywhere (header, login page, and the
home-screen icon).

### Installing on staff phones

There's no app to download. Staff open the site in their phone's browser,
then use "Add to Home Screen" (Safari: Share → Add to Home Screen; Chrome:
menu → Add to Home Screen) — it'll sit on their home screen and open full-screen
like a native app.

## What's in it

**Staff**
- Clock in / clock out with a big one-tap button, and see hours worked today
- View upcoming published shifts (schedule)
- View a weekly timesheet of hours worked, with an estimated pay total
- Request holiday/sick/other leave, see remaining holiday balance, and track
  request status

**Managers**
- Dashboard: who's clocked in right now, pending requests, quick links
- Add/edit staff (position, hourly rate, holiday allowance), deactivate leavers,
  and reset a staff member's password if they're locked out
- Rota builder: a weekly grid, click any cell to add/edit/delete a shift,
  publish the week when it's ready (shifts stay as an internal draft until
  published — staff only see published shifts)
- Approve or deny time-off requests
- Weekly timesheets report per staff member with estimated labour cost

**Everyone** gets an **Account** page (top right) to change their own password.

## Known simplifications (it's a prototype)

These are deliberate shortcuts to get something testable quickly — worth
knowing about before you rely on this for real payroll or compliance:

- **Storage**: everything lives in a single `data.json` file, not a real
  database. Fine for one pub trying this out; it will not hold up to
  concurrent writes at scale or give you backups/history.
- **Sessions are in-memory** — restarting the server logs everyone out.
- **No working-time/break rules, overtime, or TOIL logic** — Planday enforces
  these; this prototype just records clock times.
- **Holiday balance** is a simple calendar-day count (not pro-rated, doesn't
  exclude weekends/bank holidays).
- **No messaging/newsfeed, shift swaps, document storage, payroll export, or
  reporting/analytics dashboards** — you told me clock in/out, rota, and
  holiday requests mattered most, so I focused there first.
- **No "forgot password" email flow or self-signup** — staff can change their
  own password once logged in (Account page), and a manager can reset anyone's
  password if they're locked out, but there's no email sending configured for
  a self-service reset link.
- **Storage note for hosting**: if you deploy this (see DEPLOY.md), the data
  file needs to live on a persistent volume — otherwise it's wiped on every
  redeploy. The app already looks for `DATA_DIR` or Railway's automatic
  `RAILWAY_VOLUME_MOUNT_PATH` env var, so this is handled for the Railway
  setup in DEPLOY.md; if you host it elsewhere, make sure that volume is
  configured there too.
- No encryption at rest, no audit log, no GDPR data-export/delete tooling —
  needed before storing real staff data long-term.

## From prototype to production

If a trial with real staff goes well, moving this from "runs on my laptop" to
"the app my pub actually depends on" mainly means:

1. **Real hosting + a real database** (e.g. Postgres) instead of a JSON file,
   so multiple people can use it reliably at once with backups.
2. **Proper auth**: password reset, maybe SSO, stronger session handling.
3. **Compliance**: UK working time regulations, holiday accrual that's legally
   correct, audit trails — worth a conversation with an accountant/HR advisor
   before this touches real payroll.
4. **Decide on native apps vs. this web app** — the web app can go a long way,
   but push notifications for new schedules or approved requests really want
   a native (or PWA + push) app.
5. **GDPR basics**: a privacy policy, data export/delete for staff, since
   you'd be storing employee personal data.

Happy to help scope and build any of that next — just say the word.
