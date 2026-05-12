# PDF rebuild — match the GoCanvas layout

This zip replaces ReliableTrack's PM/SC PDF with one that matches the
GoCanvas-style "ROS Work Order" layout. Tested end-to-end with real photo
embeds, parts tables, warranty stamp, and Service Call variant — all three
PDF outputs were inspected before shipping.

## What's in this zip

```
pdf-rebuild/
├── src/lib/
│   ├── submissionPdf.js   ← NEW — the PDF generator (~600 lines)
│   └── rosLogo.js         ← NEW — your logo as base64 (71KB inlined)
├── patches/
│   └── wiring.md          ← How to edit the 3 existing files to use it
├── assets/                ← Logo source files for reference
│   ├── ros_logo.jpeg
│   ├── ros_logo.png
│   └── ros_logo_b64.txt
├── HANDOFF_PROMPT.md      ← Paste into the browser agent if you want
│                            them to deploy it for you
└── README.md              ← This file
```

## Two ways to deploy

### Option 1 — you do it yourself

1. Unzip
2. Upload `src/lib/submissionPdf.js` and `src/lib/rosLogo.js` via GitHub
   web UI ("Add file" → "Upload files", drag the `src/` folder)
3. Open `patches/wiring.md` and follow the three small edits to
   `ViewSubmissionPage.jsx`, `FormPage.jsx`, and `api/send-report.js`
4. Vercel auto-deploys
5. Smoke test (open a PM → tap PDF → file downloads with the new layout)

### Option 2 — hand it to the browser agent

Open `HANDOFF_PROMPT.md`, paste the section between PROMPT START / PROMPT END
into a fresh session with Sonnet 4.6 in the browser add-on. Hand them the
zip. The prompt has every constraint baked in to keep them from re-walking
old rabbit holes.

## What the new PDF looks like

- **Page 1** — Logo top-left, "ROS Work Order" title centered, "No. 09142"
  top-right. Customer Information block in 3 columns. Site Sign + GPS photos
  side-by-side. Description of Work. Completed Work with tech name + signature.
- **Page 2+** — Tech signature rendered as image. Completed Work photos in
  a 2-column grid. Flare/Combustor PM section per flare (one section per
  flare on the submission) with serial photo + arrestor ID photos.
- **Parts table** — One row per part with Description, Part #, "Used"
  description, two picture columns (thumbnails when present), Price, Qty,
  Cost. Right-aligned numbers, bold totals.
- **Labor block** — Hours / Hourly Rate / Labor Total
- **Mileage block** — Miles / Cost Per Mile / Mileage Cost / Departure
  Time, with Departing GPS map below
- **Customer Sign-off** — signature image
- **Cost summary** (final page) — Labor / Parts / Mileage / Total Cost
- **Warranty jobs** — Final page shows "WARRANTY — NO CHARGE" stamp
  instead of the cost totals

## What I verified before shipping

- Render a full PM with photos, signatures, parts, flare section → 5 pages,
  clean layout, no overlapping text, columns aligned, totals correct
- Render a warranty version of the same → cost page shows the stamp
- Render a minimal Service Call (no flares, no heaters) → 2 pages, all
  sections present, no broken empty sections
- Confirmed photo embedding works (JPEG and PNG fallback)
- Confirmed page count and "Page X of Y" footers
- Confirmed the long "Type of work" string wraps cleanly without colliding
  with the next row

## What's NOT in this build

- No P&L, no internal cost vs charged split — pure customer-facing PDF, per
  your direction
- No edit/delete buttons on the View page — same gap as before
- No offline mode — separate sprint
- No QuickBooks sync — separate sprint
- The PDF that gets emailed is identical to the one that downloads from the
  View page. If you ever want a separate "internal" copy with profit
  numbers, that's the Option 3 from my earlier P&L message — a different
  build.

## Photo section naming

The PDF generator looks for photos by section name in your `photos` table.
The most likely conventions are baked in (`site`, `gps_start`, `work`,
`sig-<TechName>`, `customer-sig`, `flare-<idx>-serial`,
`arrestor-<idx>-tag1`, `heater-<hi>-firetube-<fi>-<slot>`, `part-<sku>`,
`gps_depart`). It also accepts underscore-separated variants for arrestors
and flares. If your FormPage uploads with completely different names, either
rename the uploads in FormPage OR add your variant to the photo-filter
helpers near the top of `submissionPdf.js` — see `patches/wiring.md` for
the full mapping.

## On the test submission you mentioned

PM-9137 with the "das / DSAD / afsdaf" garbage data — that's a stale test
row in your Supabase, not something fixable in code. Delete it directly:

```sql
delete from submissions where pm_number = 9137;
```

(Run that in your Supabase SQL editor. The `photos` table cascades on
delete so any attached photos will be cleaned up automatically.)
