# Wiring the new PDF generator into ReliableTrack

You now have a working PDF generator (`src/lib/submissionPdf.js`) and a logo
asset (`src/lib/rosLogo.js`). Both are drag-and-drop new files — they don't
replace anything.

But three existing files need small edits to actually use the new generator.

---

## 1. `src/pages/ViewSubmissionPage.jsx` — add a "PDF" download button

Find the View page's header bar — wherever you have your "← Back" button.
Add a "PDF" button next to it.

At the top of the file, add the import:

```jsx
import { generateSubmissionPdf } from '../lib/submissionPdf'
```

Inside the component, add a download handler near the top:

```jsx
const [downloading, setDownloading] = useState(false)

const handleDownloadPdf = async () => {
  setDownloading(true)
  try {
    const bytes = await generateSubmissionPdf(s)  // `s` is your submission state variable
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const pad = String(s.pm_number || '0').padStart(5, '0')
    a.download = `${s.template === 'SC' ? 'SC' : 'PM'}-${pad}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('PDF generation failed: ' + e.message)
  } finally {
    setDownloading(false)
  }
}
```

In the header bar JSX (alongside the Back button), add:

```jsx
<button onClick={handleDownloadPdf} disabled={downloading} style={pdfBtn}>
  {downloading ? '...' : 'PDF'}
</button>
```

With this style:

```js
const pdfBtn = {
  background: '#e65c00', color: '#fff', border: 'none',
  padding: '6px 12px', borderRadius: 4, fontSize: 13,
  fontWeight: 700, cursor: 'pointer', marginRight: 6,
}
```

---

## 2. `src/pages/FormPage.jsx` — generate PDF and POST to email function

Find your existing `handleSubmit` function. After `saveSubmission(...)` and
all the `uploadPhotos(...)` calls succeed (right before the email POST or the
`navigate(...)` call), generate the PDF and include it in the email body.

At the top of the file, add the imports:

```jsx
import { generateSubmissionPdfBase64 } from '../lib/submissionPdf'
import { fetchSubmission } from '../lib/submissions'
```

In the submit handler, after photos finish uploading:

```jsx
// Re-fetch the submission so the PDF generator sees the uploaded photos
let pdfBase64 = null
try {
  const full = await fetchSubmission(submission.id)
  pdfBase64 = await generateSubmissionPdfBase64(full)
} catch (e) {
  console.warn('PDF generation failed:', e)
  // Continue without PDF — the email will still send
}

// Existing email POST — add pdfBase64 to the body
fetch('/api/send-report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    submissionId: submission.id,
    userToken: token,
    pdfBase64,
  }),
}).catch(() => {})
```

The `fetchSubmission` call is important — at the moment you call
`saveSubmission`, the photos haven't been uploaded yet. You need to re-fetch
to get the populated photos array, otherwise the PDF will have no photos.

---

## 3. `api/send-report.js` — accept and attach the PDF

In your existing `send-report.js`, find the place where you build the Resend
request body (the JSON with `from`, `to`, `subject`, `html`). Add the
`attachments` array if `pdfBase64` was sent.

Find the line that destructures the request body:

```js
const { submissionId, userToken } = req.body || {}
```

Add `pdfBase64` to the destructure:

```js
const { submissionId, userToken, pdfBase64 } = req.body || {}
```

Find the spot where you build the Resend payload (the `body` object passed
to `fetch('https://api.resend.com/emails', ...)`). After setting `html`, add:

```js
if (pdfBase64) {
  const pad = String(i.pm_number || '0').padStart(5, '0')
  const tag = (i.template === 'SC') ? 'SC' : 'PM'
  body.attachments = [{
    filename: `${tag}-${pad}.pdf`,
    content: pdfBase64,
  }]
}
```

(Adjust the variable name `i` to whatever your submission object is called in
that function — looking at the previous build it might be `s` or `row` or
`submission`.)

That's it. The email goes out the same as before, but now with a PDF
attached when the client sent one.

---

## What the photo section names need to be

The PDF generator looks for photos by `section` value in the `photos` table.
Your FormPage already uploads with section names. Make sure they match these
patterns or update the generator to match yours:

| Section name in DB | Where it appears in PDF |
|---|---|
| `site` | Customer Information — left side photo (site sign) |
| `gps_start` | Customer Information — right side photo (GPS map) |
| `work` | Completed Work — photo grid |
| `sig-<TechName>` or `sig_<TechName>` | Completed Work — signature row |
| `customer-sig` or `customer_sig` | Customer Sign-off — signature image |
| `flare-<idx>-serial` | Flare/Combustor PM section — flare serial photo |
| `arrestor-<idx>-tag1` / `tag2` | Flare/Combustor PM section — arrestor ID photos |
| `heater-<hi>-firetube-<fi>-<slot>` | Heater Treater PM — firetube photos |
| `part-<sku>` | Parts table — per-row thumbnail |
| `gps_depart` | Mileage — departing GPS map |

If your form uses different naming (e.g. `arr_0_tag1` instead of
`arrestor-0-tag1`), the generator already accepts both styles for arrestors
and flares — search the file for `||` in the photo lookup helpers to see all
accepted patterns. For others, either rename your uploads in FormPage.jsx, or
add your variant to the photo-filter helpers at the top of `submissionPdf.js`.

---

## A note on bundle size

The logo is inlined as a 71KB base64 string in `src/lib/rosLogo.js`. Vite
will bundle this into your client JS. That's intentional — it means the PDF
generator works offline (no network fetch for the logo) and avoids the
"image missing in PDF" failure mode the previous build had.

If you ever want to slim it down, the logo is at `assets/ros_logo.png` —
re-encode it smaller (e.g. 150x150 PNG ≈ 15KB base64) and paste the new
string into `rosLogo.js`.
