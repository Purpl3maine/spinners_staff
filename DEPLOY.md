# Going live at staff.spinnersdarwen.co.uk

This walks through putting the app on the internet using **Railway**
(railway.com) — a hosting platform with a plain dashboard, a persistent
volume so `data.json` survives restarts, and free automatic HTTPS on a
custom domain. Roughly **£4–5/month**.

I can't create the Railway account or touch your domain's DNS settings
myself (those need your login), so this is a checklist for you to work
through — it should take about 20–30 minutes. Ask me if anything doesn't
match what you're seeing and I'll help troubleshoot.

**Why a subdomain, not the bare domain?** I've set this up to go live at
`staff.spinnersdarwen.co.uk` rather than `spinnersdarwen.co.uk` itself. A
subdomain works with a standard DNS record on literally any registrar, so
there's nothing to go wrong. If `spinnersdarwen.co.uk` already has a website
on it, this also avoids touching that at all. We can point the bare domain
here too later if you'd rather — just say the word once this is live and
working.

## 1. Create a Railway account

Go to **[railway.com](https://railway.com)** and sign up (GitHub or email
both work). No card needed to sign up; you'll add a payment method when you
attach the paid Hobby plan in step 4.

## 2. Install the Railway CLI

On your own computer, in a terminal:

- **Mac:** `brew install railway`
- **Mac/Linux:** `bash <(curl -fsSL railway.com/install.sh)`
- **Windows:** use WSL (Windows Subsystem for Linux) and run the Mac/Linux
  command above, or `npm i -g @railway/cli` if you already have Node.js
  installed

Then log in — this opens your browser to confirm:

```bash
railway login
```

## 3. Deploy the app

Unzip the project I sent you, then from inside that `pubshift` folder:

```bash
cd pubshift
railway init
railway up
```

`railway init` asks you to name the project — "spinners-staff-app" is fine.
`railway up` uploads the folder and deploys it. It'll take a minute or two;
you'll see build logs stream past.

## 4. Add the Hobby plan and a persistent volume

Data (staff, shifts, requests) is stored in a single file. Without a volume,
that file gets wiped every time the app redeploys — so this step matters.

1. Open your project at **railway.com** in the browser.
2. If prompted, upgrade to the **Hobby plan** (~$5/month, includes what
   this app needs).
3. Click your service → **Settings** → **Volumes** → **New Volume**.
4. Set the mount path to `/data` and attach it to this service.

The app already knows to look for Railway's volume automatically — no extra
configuration needed. It'll pick up `/data` on the next restart.

## 5. Get a test URL first

Before touching DNS: Settings → **Networking** → **Generate Domain**. That
gives you a free `something.up.railway.app` address. Open it, log in with
the demo credentials from the README, and check everything works.

**Then, before real staff touch it:**
- Log in as the manager and go to **Account** (top right) to change the
  manager password from the demo one.
- Go to **Staff**, add your real team, and either delete/deactivate the demo
  staff or use **Reset password** on each to hand out fresh logins.

## 6. Point staff.spinnersdarwen.co.uk at it

1. In Railway: Settings → **Networking** → **Custom Domain** → enter
   `staff.spinnersdarwen.co.uk`. Railway will show you a **CNAME** record
   (and possibly a **TXT** record) to add — a target hostname and value.
2. Go to wherever spinnersdarwen.co.uk is registered or its DNS is managed
   (check your domain purchase confirmation email if you're not sure — common
   ones are GoDaddy, Namecheap, 123-reg, IONOS, or Cloudflare) and find the
   **DNS settings** for the domain.
3. Add a **CNAME record**: host/name = `staff`, value/target = whatever
   Railway showed you. Add the TXT record the same way if Railway asked for
   one.
4. Back in Railway, it'll show "verifying" then switch to a green check once
   DNS has propagated — usually minutes, occasionally a few hours. HTTPS is
   issued automatically once it's verified.

Once that's green, `https://staff.spinnersdarwen.co.uk` is live.

## What to expect afterwards

- Every time I ship you an update, redeploying means everyone gets logged
  out (sessions aren't saved to disk) — not a big deal, just worth knowing.
- The £5/month Hobby plan comfortably covers a small app like this; you
  shouldn't see much, if any, usage-based charge on top.
- If something looks broken after a deploy, Railway's dashboard has a
  **Deployments** tab with logs — screenshot it and send it over and I'll
  help debug.
