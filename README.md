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
| Owner   | manager@pub.local | manager123 |
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
  — the app checks the phone's location and only allows it within 50 metres
  of the pub
- **Clock reminder notifications** (optional): turn these on from the Clock
  page and get a push notification shortly before a shift starts if you
  haven't clocked in yet, and shortly after it ends if you haven't clocked
  out — works even if the app/tab isn't open, once it's installed to your
  Home Screen (or just open in a normal desktop browser tab). Turn it off
  the same way, from the same button.
- View upcoming published shifts (schedule), including any **open shifts**
  — unassigned shifts anyone can request; your manager approves or declines
  each request, and you'll see the outcome here
- View a weekly timesheet of hours worked, with an estimated pay total
- **Set availability** for any week: mark a day Available or Not available,
  and optionally add the hours you could do if needed plus a note (e.g.
  "school run until 3pm" or "could do evenings only") — this shows up
  right on the rota grid when a manager's building shifts, on whichever
  day(s) it applies to
- Request holiday/sick/other leave, see remaining holiday balance, and track
  request status

Managers get all of the above too (via a "Clock in/out"/"My schedule"/"My
timesheet"/"My time off" set of links in their own nav), since managers
often work paid shifts themselves — the owner account is the only one left
out, as it's treated as admin-only.

**Managers & the owner** — there are two levels above staff:
- **Manager**: full day-to-day access — staff, rota, payroll/timesheets,
  time-off requests, holiday balances. The one thing a manager can't do is
  manage another manager (or the owner) — no viewing, editing, resetting
  their password, or deactivating them.
- **Owner**: everything a manager can do, plus managing manager-level
  accounts — promoting a staff member to manager, editing or deactivating a
  manager, and so on. There's meant to be one owner (you) — the "Role"
  option to make someone a manager only appears on your own account.

Both levels see the same set of pages:
- Dashboard: who's clocked in right now, pending requests, quick links
- Add/edit staff: set them up as **hourly** (with an hourly rate) or on a
  **fixed salary** (with an annual amount) — reset a password, deactivate
  leavers, and see holiday basis (accrual vs fixed allowance) at a glance.
  The owner also gets a **Role** option here to make someone a manager (or
  move a manager back to staff)
- Rota builder: a weekly grid, click any cell to add/edit/delete a shift,
  publish the week when it's ready (shifts stay as an internal draft until
  published — staff only see published shifts). Shifts can include an
  **unpaid break** (in minutes), which is deducted automatically from that
  day's paid hours on timesheets. For a shift that runs to midnight, set End
  time to **00:00**. Under each person's name, a small summary shows their
  **scheduled hours, estimated cost and shift count** for the week you're
  viewing — a quick at-a-glance check while you're building it, similar to
  Planday. The date header row **stays visible while you scroll** down a
  busy week. **Approved holiday/sick/other leave shows automatically** as a
  🌴/🤒/📋 chip on the relevant day/person, pulled straight from their
  approved time-off requests — nothing extra to add, and it won't stop you
  scheduling a shift on the same day if you need to. Each row has a "Remove from rota" link for
  staff you don't need to schedule (e.g. an admin-only account) — it just
  hides them from the grid, their account keeps working normally, and
  there's a one-click "+ Add to rota" to bring them back. Managers show up
  here too (and on Timesheets/Holiday) if they also work paid shifts — only
  the owner is left off, since that account is treated as admin-only.
  On a computer, you can also **drag a shift onto another day or person**
  to move it (native drag-and-drop — desktop only, on a phone/tablet just
  tap the shift to edit it as before); **copy a shift** with the small ⧉
  button and **paste** it onto any "+ Add shift"/"📋 Paste shift" cell to
  duplicate it; and **save a week as a template** (or apply a saved one to
  the week you're viewing) from the Templates card underneath the grid —
  applying a template only fills in shifts for people who don't already
  have one that day, so it's safe to reapply without creating duplicates.
  **Departments** (Bar, Kitchen, FOH, or whatever you call them) group
  staff on the rota grid with their own automatic colour — manage them
  from **Manage departments** (linked from the Staff and Rota pages), then
  assign each person a department from their staff page. Within a
  department, drag the **⋮⋮** handle next to someone's name to reorder
  them (desktop only) — staff can only be reordered within their own
  department group, not moved between groups this way.
  An **Unassigned** row at the top of the grid holds **open shifts** —
  add one with "+ Add open shift", and any staff member can request it
  from their Schedule page (once the week's published); approve or decline
  requests from the **Requests** page, or from the shift's own edit page.
  Approving assigns it to them and automatically declines anyone else who
  also asked. You can also just drag an existing shift onto the Unassigned
  row to open it back up, or drag an open shift onto someone's row to
  assign it directly, skipping the request step entirely.
- **Print rota**: a "🖨️ Print rota" button on the Rota builder gives you a
  clean, landscape-friendly printout of the week you're viewing — no menus
  or buttons, just who's working when.
- **Staff availability** shows directly on the rota grid — a green "✓
  Available" or red "🚫 Not available" tag on the relevant day/person,
  including any hours-if-needed and notes they added, so you can see it
  right where you're deciding who to schedule. It's informational only —
  you can still add a shift on a day someone's marked unavailable if you
  need to, the app just won't hide that they said they couldn't do it.
- Each staff member's page has a **manual clock in/out** override — add,
  **edit**, or remove clock events by hand, no location check. Useful when
  the location check isn't working for someone, or to fix a mistake (e.g.
  they forgot to clock in/out and their timesheet looks wrong) — the
  Timesheets page links each person's name straight to this.
- Approve or decline open shift requests, and approve or deny time-off
  requests, both from the **Requests** page
- **Holiday page**: everyone's balance at a glance (accrued/allowance, taken,
  remaining) plus a full log of every holiday request and its outcome
- Weekly timesheets report per staff member with estimated labour cost
  (salaried staff show their pro-rated weekly salary instead of hours × rate)
- **Approving worked shifts**: every completed clock in/out needs a
  manager's approval before it can go out in a payroll export — a "Shifts
  to approve" card appears at the top of the Timesheets page whenever
  there's one waiting, showing who, when, and the hours worked, with a
  **✓ Approve** button per shift or **✓ Approve all** to clear the whole
  week in one go. The same Approve control (and an "Approved"/"Needs
  approval" tag) also shows on each staff member's own page next to their
  clock events. Trying to export a range that still has unapproved shifts
  in it is blocked with a message naming exactly who/when needs checking
  first. Shifts recorded before this update were grandfathered in as
  already approved, so existing history isn't affected — this only applies
  to clock-outs from now on.
- **Export for payroll** on the Timesheets page: pick any date range and
  either "All staff" or one individual, then **⬇ Download CSV** to get a
  file with each person's hours worked and estimated total pay for that
  period (plus a grand total row). Opens straight in Excel or Google
  Sheets, or can be attached to an email — includes a UTF-8 BOM so the £
  sign displays correctly in Excel. Salaried staff are pro-rated to the
  exact length of the date range chosen (not assumed to be one week), so
  it works for a single week, a fortnight, a full month, or any custom
  period. Blocked until every worked shift in the range is approved (see
  above).

- **HR records** on each staff member's page: an emergency contact,
  health/safety notes (allergies, conditions relevant to work), a
  disciplinary log (add/remove dated entries), and a documents section for
  uploading contracts and other paperwork (PDF, Word, or image files) with a
  type/date/notes per file. Health info, disciplinary entries and documents
  are only visible to managers and the owner — never to staff.

**Everyone** gets an **Account** page (top right) to update their own name,
email and password, and to add their own emergency contact details (managers
can also set/edit this for someone from their staff page).

**Onboarding emails** — when a manager adds a new staff member (or resets
someone's password), the app can automatically email them their login
details, so no one has to copy/paste passwords by hand. This is off by
default and needs a one-time setup — see DEPLOY.md, "Turn on automatic
onboarding emails." Until that's done, everything works exactly the same,
you just share the login/password with the new starter yourself.

## How holiday accrual works

Holiday resets every **1 April**. Which model applies depends on how a staff
member is set up (Staff page → Pay type):

- **Salaried staff** get their full day allowance (e.g. 28 days) available
  from day one of the holiday year — the classic UK contractual model.
- **Hourly staff** don't get a fixed allowance. Instead they accrue
  **12.07% of the hours they actually work**, building up gradually across
  the year — this is the standard statutory rate for staff whose hours
  aren't fixed (5.6 weeks' leave ÷ 46.4 working weeks ≈ 12.07%). When they
  request holiday, they also enter how many hours it covers, which is
  deducted from their accrued balance. It's floored at 0 rather than going
  negative if someone takes leave faster than they've accrued it.

**Moving someone over from another system mid-year** (e.g. Planday)? Their
staff profile has a **Holiday adjustment** field — enter what they're
already owed there as of today (positive), or how much they've overdrawn
(negative), and it's added straight on top of what this app works out.
It's shown separately everywhere a balance appears (their own Time off
page, and your Holiday page) so it's always clear it's a manual figure,
not something the app calculated.

⚠️ **Please don't treat this as legal/payroll advice.** Holiday pay rules
for irregular-hours and part-year workers have real nuance in UK law
(notably the *Harpur Trust v Brazel* case), and getting this wrong has real
financial and legal consequences. This implementation is a reasonable,
transparent best-effort — worth sanity-checking with an accountant or
payroll advisor before it drives real pay decisions, especially as your
team grows.

## Geofenced clock in/out

Staff can only clock in or out while their phone/browser reports a location
within **50 metres** of the pub. This uses the browser's built-in location
feature (no app install, no extra permissions beyond the normal "allow this
site to use your location" prompt) — the location is only checked at the
moment they tap Clock In/Out, not tracked in the background.

If a staff member declines the location prompt, or their signal is too weak
to get a fix, they'll see a clear message explaining why it didn't work and
what to try (allow location access, move near a window, etc.) — they aren't
just silently blocked.

The pub's coordinates are set in `lib/geo.js` (`PUB_LAT` / `PUB_LNG`) — if
you ever need to adjust them (e.g. the app is used at a different site) or
change the 50m radius (`RADIUS_METERS`), that's the one place to edit.

**Note:** phone GPS accuracy varies — indoors or with a weak signal it can
occasionally be off by tens of metres, which may need a retry near a window
or door. If it keeps failing for someone, a manager can add the clock
in/out by hand from that staff member's page (see below) — this skips the
location check entirely, so use it as a fallback rather than routine.

## Known simplifications (it's a prototype)

These are deliberate shortcuts to get something testable quickly — worth
knowing about before you rely on this for real payroll or compliance:

- **Storage**: everything lives in a single `data.json` file, not a real
  database. Fine for one pub trying this out; it will not hold up to
  concurrent writes at scale or give you backups/history.
- **One owner in mind**: the app supports more than one owner-level account
  in principle, but the UI for promoting someone to owner deliberately
  isn't there — moving ownership to someone else would need a manual data
  edit. Fine for a single-pub setup; worth building a proper UI for if that
  ever needs to change.
- **Sessions are in-memory** — restarting the server logs everyone out.
- **No working-time rules, overtime, or TOIL logic** beyond unpaid shift
  breaks and holiday accrual — Planday enforces more of this; this prototype
  covers what you asked for first.
- **Holiday day-counts** (for salaried staff, and in the log) are simple
  calendar-day counts — they don't exclude weekends or bank holidays.
- **Hours booked off** for hourly staff's holiday requests are self-reported
  (staff type in the number), not derived automatically from a fixed working
  pattern, since their hours vary week to week.
- **No messaging/newsfeed, shift swaps, payroll export, or reporting/
  analytics dashboards** — you told me clock in/out, rota, and holiday
  requests mattered most, so I focused there first.
- **No self-service "forgot password" or self-signup** — if a staff member
  gets locked out, a manager resets their password for them (Staff page).
  With onboarding emails turned on (see above), that reset can be emailed to
  them automatically, but there's no flow where staff request their own
  reset link.
- **Storage note for hosting**: if you deploy this (see DEPLOY.md), the data
  file needs to live on a persistent volume — otherwise it's wiped on every
  redeploy. The app already looks for `DATA_DIR` or Railway's automatic
  `RAILWAY_VOLUME_MOUNT_PATH` env var, so this is handled for the Railway
  setup in DEPLOY.md; if you host it elsewhere, make sure that volume is
  configured there too.
- **Clock reminder notifications** use the standard Web Push API (no
  third-party notification service, so no ongoing cost or dependency) — but
  it's a browser feature with real platform limits: on iPhone/iPad it only
  works once the app's been added to the Home Screen (iOS 16.4+, plain
  Safari tabs can't receive push at all); on Android/desktop it works
  straight from the browser, installed or not. If someone's phone is off,
  in Do Not Disturb, or the browser force-quit, the reminder just won't
  arrive — same as any push notification.
- No encryption at rest, no audit log, no GDPR data-export/delete tooling —
  worth having before storing real staff data long-term, and especially
  relevant now that HR records (health notes, disciplinary entries, uploaded
  contracts) live in the same unencrypted storage. Health information counts
  as "special category data" under UK GDPR, so it's worth keeping only what
  you actually need on file, and treating access to the owner/manager
  accounts with real care — anyone with a manager login can see it.

## Going live with real staff

Once you're ready to stop testing and hand the app to your actual team, use
**Staff → Danger zone → Reset for go-live** (owner only). Tick which
account(s) to keep — normally just your own — and it removes everyone else
and clears every shift, clock in/out record, and time-off request, so
staff start with a clean slate. Type `RESET` to confirm; **this can't be
undone**, so double-check the tick boxes before submitting. After that, add
your real team via **Staff → Add a staff member** as normal.

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
