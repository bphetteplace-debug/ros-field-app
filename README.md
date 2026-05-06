# ROS Field App

**Reliable Oilfield Services field documentation system — replacing GoCanvas.**

This is your in-house preventive maintenance documentation app. Built with React + Vite + Tailwind on the frontend, Supabase (Postgres + Auth + Storage) on the backend, deployed on Vercel.

---

## What's in this repo

```
ros-field-app/
├── src/
│   ├── App.jsx              # Routing + auth gate
│   ├── main.jsx             # Entry point
│   ├── index.css            # Tailwind base + ROS design system
│   ├── lib/
│   │   ├── supabase.js      # Supabase client + auth helpers
│   │   ├── auth.jsx         # useAuth hook + AuthProvider
│   │   ├── imageCompress.js # Photo compression util
│   │   └── utils.js         # fmt money, dates, etc
│   ├── data/
│   │   ├── catalog.js       # Your 247-SKU price book
│   │   └── constants.js     # Customers, trucks, techs, work types
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── FormPage.jsx     # Fill out a PM
│   │   ├── PreviewPage.jsx  # PDF-style preview + print
│   │   └── SubmissionsListPage.jsx
│   └── components/
│       ├── Layout.jsx
│       ├── Section.jsx
│       ├── Field.jsx
│       ├── Banner.jsx
│       ├── PartsPicker.jsx
│       └── EquipmentCard.jsx
├── docs/
│   ├── schema.sql           # Supabase database schema (Week 1)
│   └── parts_catalog.csv    # Bulk import file for parts
├── DEPLOYMENT.md            # Step-by-step Vercel + DNS deploy
└── README.md                # This file
```

---

## Quick start (Day 0 — local development)

You need Node.js 20+ installed. Get it from [nodejs.org](https://nodejs.org).

```bash
# Install dependencies
npm install

# Run dev server
npm run dev
```

Open the URL printed in your terminal (usually `http://localhost:5173`). You should see the form. Fill it out, hit Preview, hit Print.

**Local mode is active.** No login required, nothing persists, photos live in browser memory. This is intentional — Day 0 lets you deploy and validate the UX before backend setup.

---

## Two operating modes

This app is designed to work in two modes based on whether `VITE_SUPABASE_URL` is set:

### Local mode (no env vars)
- No login required, opens straight to the form
- Submissions exist only in browser memory
- Photos exist only in browser memory
- Reload = lose everything
- **Use case**: Day 0 deploy. Crew can test the UX. Print PDFs and email them manually.

### Cloud mode (env vars set)
- Login required (Supabase Auth)
- Submissions persist to Postgres
- Photos persist to Supabase Storage with compression
- Submissions list shows all your PMs
- Customers can be auto-emailed PDFs
- **Use case**: Production. Real GoCanvas replacement.

You'll start in local mode. Once you complete `WEEK1_BACKEND.md`, set the env vars and the app upgrades to cloud mode.

---

## Deployment

See `DEPLOYMENT.md` for the full step-by-step. Short version:

1. Push to GitHub
2. Import repo into Vercel
3. Vercel auto-detects Vite and deploys
4. Add `pm.reliable-oilfield-services.com` as a custom domain
5. Add CNAME in GoDaddy DNS
6. Done — live URL in ~10 minutes

---

## Path forward

- **This weekend** (Day 0): Get the app deployed to `pm.reliable-oilfield-services.com` in local mode. Crew tests the UX.
- **Week 1**: Provision Supabase, run schema, set env vars. App switches to cloud mode.
- **Week 2**: Wire up the auto-save loop and submissions list against real data.
- **Week 3**: Server-side PDF generator + email delivery.
- **Week 4**: Offline mode + admin dashboard.
- **Week 5**: Add BMS / Thief Hatch / PSV form templates.
- **Week 6**: Cutover from GoCanvas.

See `ROS_App_DIY_Kickoff.md` (the planning doc) for the full timeline.

---

## When you get stuck

- 5 min: ask Cursor's chat panel
- 15 min: ask Claude Code (`claude` in your terminal)
- 30 min: take a break, come back fresh
- Beyond that: the issue is usually environmental (env vars, DNS propagation, Supabase RLS) — diagnose those first

---

## Tech notes

- **React 18** with hooks. No Redux, no Zustand. Context for auth, useState for everything else.
- **React Router v6** for routing. Routes defined in `App.jsx`.
- **Tailwind 3** for styling. Custom design tokens in `tailwind.config.js`.
- **Supabase** for backend. Client-side SDK only — no custom backend server needed for V1.
- **Lucide React** for icons.
- **Browser Image Compression** for client-side photo resize before upload.

No TypeScript yet. Keep it simple for V1; convert later if the codebase grows past ~10K LOC.
