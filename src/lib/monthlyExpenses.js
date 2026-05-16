// monthly_expenses CRUD helpers. Schema in supabase/monthly_expenses.sql.

import { getAuthToken } from './submissions'

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function authHeaders(includeContent) {
  const token = getAuthToken()
  const h = {
    apikey: SUPA_KEY,
    Authorization: 'Bearer ' + (token || SUPA_KEY),
  }
  if (includeContent) h['Content-Type'] = 'application/json'
  return h
}

export const EXPENSE_CATEGORIES = ['Fixed', 'Payroll', 'Other']

export const EXPENSE_CATEGORY_STYLES = {
  Fixed:   { bg: '#dbeafe', fg: '#1d4ed8' },
  Payroll: { bg: '#ede9fe', fg: '#6d28d9' },
  Other:   { bg: '#f1f5f9', fg: '#475569' },
}

function deriveMonthYear(date) {
  if (!date) return null
  const s = String(date)
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? m[1] + '-' + m[2] : null
}

export async function fetchMonthlyExpenses({ monthYear, category, search, limit = 1000 } = {}) {
  const parts = ['select=*', `limit=${limit}`, 'order=date.desc.nullslast,created_at.desc']
  if (monthYear) parts.push('month_year=eq.' + encodeURIComponent(monthYear))
  if (category) parts.push('category=eq.' + encodeURIComponent(category))
  if (search) {
    const q = search.replace(/[(),]/g, ' ').trim()
    if (q) parts.push('or=(description.ilike.*' + encodeURIComponent(q) + '*,vendor.ilike.*' + encodeURIComponent(q) + '*,notes.ilike.*' + encodeURIComponent(q) + '*)')
  }
  const res = await fetch(SUPA_URL + '/rest/v1/monthly_expenses?' + parts.join('&'), { headers: authHeaders(false) })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('Fetch monthly expenses failed: HTTP ' + res.status + ' ' + t.slice(0, 200))
  }
  return await res.json()
}

export async function createMonthlyExpense(entry) {
  const payload = {
    ...entry,
    month_year: entry.month_year || deriveMonthYear(entry.date),
  }
  const res = await fetch(SUPA_URL + '/rest/v1/monthly_expenses', {
    method: 'POST',
    headers: { ...authHeaders(true), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('Create expense failed: HTTP ' + res.status + ' ' + t.slice(0, 200))
  }
  const rows = await res.json()
  return Array.isArray(rows) ? rows[0] : rows
}

export async function updateMonthlyExpense(id, patch) {
  const body = { ...patch }
  if ('date' in patch) body.month_year = deriveMonthYear(patch.date)
  const res = await fetch(SUPA_URL + '/rest/v1/monthly_expenses?id=eq.' + id, {
    method: 'PATCH',
    headers: { ...authHeaders(true), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('Update expense failed: HTTP ' + res.status + ' ' + t.slice(0, 200))
  }
  const rows = await res.json()
  return Array.isArray(rows) ? rows[0] : rows
}

export async function deleteMonthlyExpense(id) {
  const res = await fetch(SUPA_URL + '/rest/v1/monthly_expenses?id=eq.' + id, {
    method: 'DELETE',
    headers: authHeaders(false),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('Delete expense failed: HTTP ' + res.status + ' ' + t.slice(0, 200))
  }
  return true
}
