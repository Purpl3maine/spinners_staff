# Going live at staff.spinnersdarwen.co.uk

This is a browser-only path — no terminal, no typing commands, just signing
up for two free websites and clicking buttons. It takes about 30–40 minutes
and costs roughly **£4–5/month** once it's live.

I can't create these accounts or touch your domain's DNS myself (they need
your login), so this is a checklist for you to work through. Take it one
numbered section at a time — send me a screenshot any time something on
your screen doesn't match what's described, and I'll help from there.

**Why a subdomain, not the bare domain?** This is set up to go live at
`staff.spinnersdarwen.co.uk` rather than `spinnersdarwen.co.uk` itself, so
that adding it can't interfere with anything already on the main domain, and
so the DNS step is a standard record any registrar supports. We can point
the bare domain here too later, once this is live and working.

---

## Part 1 — Put the project on GitHub

GitHub is just a place to store the project's files online — a bit like
Dropbox, but it's what the hosting service in Part 2 will read from.

1. Go to **[github.com](https://github.com)** and sign up for a free account
   (email + password).
2. Once logged in, click the **+** icon top-right → **New repository**.
3. Name it `spinners-staff-app`. Leave it set to **Private**. Don't tick
   "Add a README file." Click **Create repository**.
4. On the new (empty) repository page, click the link that says
   **"uploading an existing file."**
5. Unzip the `pubshift.zip` file I sent you, so you have a normal folder
   called `pubshift` on your computer.
6. Open that `pubshift` folder, select **everything inside it** (not the
   folder itself — go inside it first, then select all the files and
   sub-folders you see), and drag that selection onto the GitHub upload box
   in your browser.
7. Wait for the upload to finish, then scroll down and click
   **Commit changes**.

You now have the project safely stored on GitHub.

---

## Part 2 — Deploy it with Railway

1. Go to **[railway.com](https://railway.com)** and sign up — choose
   **"Sign up with GitHub"** so the two are connected automatically. No card
   needed yet.
2. Click **New Project** → **Deploy from GitHub repo**.
3. If asked, click **Configure GitHub App** and give Railway permission to
   see the `spinners-staff-app` repository you just created.
4. Select `spinners-staff-app` from the list. Railway will start building
   and deploying it automatically — you'll see logs scrolling by. Give it a
   couple of minutes.

## Part 3 — Add storage that survives updates

Staff data (clock records, shifts, requests) is stored in a file. Without
this step, that file gets wiped every time the app updates — so it matters.

1. If prompted, upgrade to the **Hobby plan** (~$5/month — this is where you
   add a payment card).
2. Click on your service (the box representing the app) → **Settings** tab
   → **Volumes** → **New Volume**.
3. Set the mount path to `/data` and confirm.

Nothing else needed here — the app already knows to use it automatically.

## Part 4 — Try it out before anyone else does

1. Still in Settings, find **Networking** → click **Generate Domain**. This
   gives you a free web address like `something.up.railway.app`.
2. Open that address, and log in using the demo details in the project's
   README file (open `README.md` in the unzipped folder, or ask me to
   remind you).
3. Once you're happy it works: log in as the manager, open **Account**
   (top right) and change the manager password. Then go to **Staff** and
   either add your real team (removing/deactivating the demo ones) or use
   **Reset password** on each demo account to hand out to real people.

## Part 5 — Point staff.spinnersdarwen.co.uk at it

1. Back in Railway: **Settings** → **Networking** → **Custom Domain** →
   type in `staff.spinnersdarwen.co.uk`. Railway will show you a **CNAME**
   record (and maybe a **TXT** record) — a hostname and a value.
2. Go to wherever spinnersdarwen.co.uk was registered (check the confirmation
   email from when you bought it if you're not sure — common ones are
   GoDaddy, Namecheap, 123-reg, IONOS, Cloudflare) and find its **DNS
   settings**.
3. Add a **CNAME record** there: host/name = `staff`, value = whatever
   Railway showed you. Add the TXT record the same way if one was shown.
4. Back in Railway, it'll say "verifying," then show a green check once the
   DNS change has taken effect — usually minutes, sometimes a few hours.
   HTTPS (the padlock) is set up automatically once verified.

Once that's green, `https://staff.spinnersdarwen.co.uk` is live.

---

## What to expect afterwards

- Every time I send you an update, you'll re-upload the changed files to
  GitHub the same way as Part 1, and Railway redeploys automatically —
  everyone gets logged out when that happens, which is normal.
- Any time something looks broken after an update, Railway's dashboard has
  a **Deployments** tab with logs — a screenshot of that is the most useful
  thing to send me.

---

## If you're comfortable with a terminal (optional, faster)

Everything above can also be done in a few minutes using Railway's
command-line tool instead of GitHub + the dashboard. Only worth it if
you're already familiar with using a terminal:

```bash
railway login
cd pubshift
railway init
railway up
```

Then continue from Part 3 above (adding the volume, domain, etc. — those
steps are the same either way).
