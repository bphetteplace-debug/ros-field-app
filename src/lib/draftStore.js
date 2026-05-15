// src/lib/draftStore.js
// IndexedDB-backed draft persistence for in-progress forms. The legacy
// localStorage drafts (ros_pm_draft, ros_jha_draft, ros_inspection_draft,
// ros_expense_draft) explicitly threw photos away on save because Files /
// Blobs can't be JSON-serialized and quickly bust the ~5MB localStorage
// quota anyway. This store keeps Blobs natively (IDB supports them), so a
// tech can refresh the page mid-job and not lose anything they've added.
//
// Schema: single object store `drafts` keyed by `formType`
//   ('pm' | 'jha' | 'inspection' | 'expense' | 'quote' | ...).
// Each row: { formType, fields, photos, updatedAt }
//   - fields: any JSON-serializable object (whatever the form wants)
//   - photos: any object/array containing Blobs — IDB persists them as-is
//             without serialization. Callers can use whatever shape suits
//             the form (array of Files, { section: [...] }, single Blob, etc.)
//
// We also try to migrate the legacy localStorage payload on first load if
// no IDB record exists yet, so techs mid-shift across the deploy don't
// lose their text fields.

const IDB_NAME = 'ros-drafts'
const IDB_STORE = 'drafts'
const IDB_VERSION = 1

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'formType' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })
}

// Map of legacy localStorage keys we know about, used by loadDraft for
// one-time migration. Keep adding entries here whenever a new form type
// uses draftStore so its prior localStorage drafts get picked up too.
const LEGACY_KEYS = {
  pm:         'ros_pm_draft',
  jha:        'ros_jha_draft',
  inspection: 'ros_inspection_draft',
  expense:    'ros_expense_draft',
}

export async function saveDraft(formType, fields, photos) {
  if (!formType) throw new Error('saveDraft: formType is required')
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put({
      formType,
      fields: fields || {},
      photos: photos || null,
      updatedAt: Date.now(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = e => reject(e.target.error)
  })
}

export async function loadDraft(formType) {
  if (!formType) throw new Error('loadDraft: formType is required')
  const db = await openIDB()
  const fromIdb = await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(formType)
    req.onsuccess = e => resolve(e.target.result || null)
    req.onerror = e => reject(e.target.error)
  })
  if (fromIdb) return fromIdb
  // Fall back to a legacy localStorage draft if one is present for this
  // formType. Migrates it into IDB so the next load is a hit and the
  // localStorage entry can age out naturally.
  const legacyKey = LEGACY_KEYS[formType]
  if (legacyKey && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(legacyKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        const migrated = { formType, fields: parsed || {}, photos: null, updatedAt: Date.now() }
        try { await saveDraft(formType, migrated.fields, null) } catch (_) {}
        return migrated
      }
    } catch (_) { /* malformed legacy draft — ignore */ }
  }
  return null
}

export async function clearDraft(formType) {
  if (!formType) throw new Error('clearDraft: formType is required')
  const db = await openIDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(formType)
    tx.oncomplete = () => resolve()
    tx.onerror = e => reject(e.target.error)
  })
  // Best-effort: also clear the legacy localStorage entry so we don't
  // re-migrate it on next load after the user submitted/cleared.
  const legacyKey = LEGACY_KEYS[formType]
  if (legacyKey && typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(legacyKey) } catch (_) {}
  }
}

// Debug / admin helper — return every draft currently stored.
export async function listDrafts() {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = e => resolve(e.target.result || [])
    req.onerror = e => reject(e.target.error)
  })
}
