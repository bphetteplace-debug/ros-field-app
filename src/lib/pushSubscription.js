// src/lib/pushSubscription.js — client-side Web Push helpers.
//
// Subscribes the user's current browser to OS-level push notifications,
// then stores the subscription endpoint + keys in Supabase via the
// /api/push-subscribe lambda so the server can later use web-push to
// dispatch notifications even when the app is closed.
//
// Flow:
//   1. Caller invokes subscribeToPush().
//   2. We verify the browser supports Notifications + ServiceWorker + PushManager.
//   3. We ask for Notification permission (must be triggered by a user gesture).
//   4. We get the existing service worker registration (registered by main.jsx).
//   5. We call pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).
//   6. We POST the subscription to /api/push-subscribe with the Supabase JWT.
//   7. Browser keeps the subscription alive across reloads/restarts.

import { getAuthToken } from './submissions'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// VAPID applicationServerKey must be a Uint8Array, not the base64url string.
// Decode it once.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

export function getNotificationPermission() {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

// True if the browser is currently subscribed to push for this origin.
export async function isPushSubscribed() {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch { return false }
}

// Ask permission, subscribe with VAPID, POST to backend.
// Returns { ok: true } or { ok: false, reason }.
export async function subscribeToPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[push] VITE_VAPID_PUBLIC_KEY not configured')
    return { ok: false, reason: 'not-configured' }
  }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'denied' }

    const reg = await navigator.serviceWorker.ready
    // If a subscription already exists, reuse it — re-POST to backend so
    // the latest user_agent + updated_at land in the DB.
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    const json = sub.toJSON()
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
      body: JSON.stringify({
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        user_agent: navigator.userAgent || null,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[push] subscribe POST failed:', res.status, text.slice(0, 200))
      return { ok: false, reason: 'backend-error' }
    }
    return { ok: true }
  } catch (e) {
    console.warn('[push] subscribe failed:', e?.message || e)
    return { ok: false, reason: 'exception' }
  }
}

// Unsubscribe from this browser AND remove from the backend.
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { ok: true } // already unsubscribed
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    // Tell backend to drop the row.
    await fetch('/api/push-subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
    return { ok: true }
  } catch (e) {
    console.warn('[push] unsubscribe failed:', e?.message || e)
    return { ok: false, reason: 'exception' }
  }
}
