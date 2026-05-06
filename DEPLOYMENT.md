# Deployment Guide

This walks you through getting `pm.reliable-oilfield-services.com` live in ~30 minutes.

---

## Prerequisites

- [x] Node.js 20+ installed locally — [nodejs.org](https://nodejs.org)
- [x] GitHub account — [github.com](https://github.com)
- [x] Vercel account — [vercel.com](https://vercel.com), sign in with GitHub
- [x] Access to GoDaddy DNS for `reliable-oilfield-services.com`

---

## Step 1: Push to GitHub

```bash
cd ros-field-app

# Initialize git (if you haven't)
git init
git branch -M main
git add .
git commit -m "initial: ROS field app prototype"

# Create a new private repo on GitHub at github.com/new
# Name it `ros-field-app`. Don't initialize with README.

# Push to it
git remote add origin git@github.com:<your-username>/ros-field-app.git
git push -u origin main
```

If you get an SSH error, set up SSH keys first: [docs.github.com/en/authentication/connecting-to-github-with-ssh](https://docs.github.com/en/authentication/connecting-to-github-with-ssh).

Or use HTTPS instead:
```bash
git remote add origin https://github.com/<your-username>/ros-field-app.git
```

---

## Step 2: Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to your `ros-field-app` repo
3. Vercel auto-detects: **Vite**, build command `npm run build`, output directory `dist`. Don't change.
4. Click **Deploy**.

Wait ~2 minutes. You'll get a URL like `ros-field-app-xyz.vercel.app`. Open it. The form should render in local mode.

---

## Step 3: Connect your custom domain

In your Vercel project:

1. **Settings** → **Domains** → **Add**
2. Enter: `pm.reliable-oilfield-services.com`
3. Click **Add**
4. Vercel shows you a CNAME to configure. Copy the value (something like `cname.vercel-dns.com`).

In GoDaddy:

1. Log in → **My Products** → find `reliable-oilfield-services.com` → **DNS**
2. **Add** a new record:
   - Type: **CNAME**
   - Name: `pm`
   - Value: `cname.vercel-dns.com` (whatever Vercel gave you)
   - TTL: 1 hour (or default)
3. **Save**

DNS propagation takes 5–30 minutes. Refresh `https://pm.reliable-oilfield-services.com` until it loads.

---

## Step 4: Verify

Your live URL should:
- Show the ROS Field form
- Let you fill it out
- Show the Preview page when you tap Preview
- Print to PDF cleanly via the browser's Print → Save as PDF

It should NOT yet:
- Require a login (you're in local mode)
- Save submissions across reloads
- Persist photos beyond the current tab

That's expected. Backend wiring is `WEEK1_BACKEND.md`.

---

## Pushing updates

Once Vercel is connected, every `git push` to `main` auto-deploys:

```bash
git add .
git commit -m "fix: better photo compression"
git push
```

Vercel rebuilds and deploys in ~90 seconds. You'll see the new version at your URL.

For pull-request previews (deploy a branch to a temp URL before merging), just push to a different branch — Vercel makes a preview URL automatically.

---

## Troubleshooting

### Build fails on Vercel with "module not found"
- Check that `package.json` and `package-lock.json` (or `npm-shrinkwrap.json`) are committed.
- Run `npm install && npm run build` locally first to verify it builds.

### `pm.reliable-oilfield-services.com` shows "Domain not verified"
- DNS propagation takes time. Wait 30 min and try again.
- Verify the CNAME with `dig CNAME pm.reliable-oilfield-services.com` — should resolve to Vercel.

### Page loads but is blank
- Open browser dev tools → Console. Errors there tell the story.
- Most common: forgot to push the latest changes; Vercel deployed an old commit.

### Browser shows "Your connection is not private"
- DNS resolved but Vercel's SSL cert hasn't issued yet. Wait 10 min. It auto-issues.

---

## When you're ready for the backend

See `WEEK1_BACKEND.md` for the Supabase setup walkthrough.
