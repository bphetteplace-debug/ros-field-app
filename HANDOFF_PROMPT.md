# Handoff: ReliableTrack PDF rebuild

Paste this into Sonnet 4.6 in the browser add-on.

---

## PROMPT START

I'm replacing the PM/SC PDF in ReliableTrack with a layout that matches our
GoCanvas form. All code is written and tested. Your job is to commit the
files to GitHub and verify the deploy. Do NOT redesign anything or
relitigate technical decisions — they're locked.

### Repo
- GitHub: `bphetteplace-debug/ros-field-app` (private)
- Live: `pm.reliable-oilfield-services.com`
- Vercel project: `ros-field-app` under `bphetteplace-debugs-projects`

### Files to add (drag-and-drop new files)

| Path in repo | Action |
|---|---|
| `src/lib/submissionPdf.js` | NEW — create |
| `src/lib/rosLogo.js` | NEW — create (contains the inlined logo as base64) |

The user will upload via GitHub web UI "Add file" → "Upload files", dragging
the `src/` folder from the zip.

### Files to edit (small additions, NOT full replacements)

| Path | Edit |
|---|---|
| `src/pages/ViewSubmissionPage.jsx` | Add PDF download button + handler. Instructions in `patches/wiring.md` |
| `src/pages/FormPage.jsx` | After photos upload, generate PDF base64 and include in email POST. Instructions in `patches/wiring.md` |
| `api/send-report.js` | Destructure `pdfBase64` from req.body, add to Resend attachments. Instructions in `patches/wiring.md` |

Use targeted line edits in the GitHub web editor for these three files —
small additions in specific places, NOT full file replacements.

### CRITICAL CONSTRAINTS

1. **Do NOT use the CodeMirror 6 `cmTile` walking technique** for these
   three edits. They're small additions, not full replacements. Open the file
   in the GitHub editor, use Ctrl+F to find the right location, click in,
   type or paste the small addition, commit. The cmTile technique corrupted
   files in a previous session.

2. **`api/send-report.js` is CommonJS.** It must stay `.js` with
   `module.exports`. Do NOT rename it to `.cjs`. The existing
   `api/package.json` with `{"type":"commonjs"}` makes this work.

3. **NEVER require/import `pdf-lib` in any /api file.** The PDF is generated
   client-side (in the browser, by `submissionPdf.js`). The Vercel function
   just receives `pdfBase64` and forwards it to Resend. Importing pdf-lib in
   the lambda crashes it with `FUNCTION_INVOCATION_FAILED`. The user spent
   multiple previous sessions on this. Do not re-test this.

4. **`vercel.json` should already exclude /api/ from the SPA rewrite.**
   Verify, do not modify unless missing.

5. **PM-9137 is a stale test submission.** The user mentioned wanting it
   gone. Delete the row in Supabase (manually via SQL editor):
   ```sql
   delete from submissions where pm_number = 9137;
   ```
   Or whichever test ID it actually is — verify before deleting.

### Smoke test after deploy

1. Vercel goes green
2. Open a real PM submission's View page → "PDF" button appears (orange)
3. Tap PDF → file downloads, opens, shows: logo top-left, "ROS Work Order"
   title, "No. <pad>" top-right, black-bar section headers, Customer Info
   block with 3 columns and site sign + GPS photos side-by-side, Description,
   Completed Work with tech sigs and photos, Flare/Combustor PM sections for
   each flare, Parts table with thumbnails per row, Labor + Mileage blocks,
   Customer Sign-off, Cost summary on final page
4. Submit a fresh PM end-to-end → email arrives at both Brian and Caryl with
   PDF attached
5. Submit a warranty PM → final page shows "WARRANTY — NO CHARGE" stamp
   instead of cost totals
6. Submit a Service Call → PDF still says "ROS Work Order" (title is the
   same for both PM and SC per spec), no flare/heater sections rendered

### What's intentionally not changed

- No P&L, no cost-vs-charged split — pure customer-facing replication
- No edit/delete — same gap as before
- No offline mode
- Photo section naming follows the conventions in `patches/wiring.md`. If
  the existing FormPage uploads with different names, either adjust the
  uploads OR add the variant to the photo-filter helpers in
  `submissionPdf.js`. The generator already accepts both `arrestor-0-tag1`
  and `arr_0_tag1` style names for arrestor/flare photos.

## PROMPT END
