// Pure-DOM toast: drop-in non-blocking replacement for `alert()`.
// Mountless — no React provider needed. Callable from anywhere (component,
// helper, or .then() callback). Click a toast to dismiss; otherwise it
// auto-dismisses on a type-dependent timer.

const PALETTE = {
  info: '#1a2332',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
};

const DEFAULT_TTL = {
  info: 3500,
  success: 3500,
  warning: 4500,
  error: 6000,
};

function ensureContainer() {
  let container = document.getElementById('ros-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ros-toast-container';
    container.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;max-width:92vw;width:max-content;align-items:center;';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', durationMs) {
  if (typeof document === 'undefined') return;
  const container = ensureContainer();
  const bg = PALETTE[type] || PALETTE.info;
  const el = document.createElement('div');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.style.cssText = `background:${bg};color:#fff;padding:0.75rem 1rem;border-radius:8px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.18);font-size:14px;line-height:1.4;white-space:pre-line;pointer-events:auto;cursor:pointer;max-width:100%;word-wrap:break-word;`;
  el.textContent = String(message);
  const ttl = durationMs ?? DEFAULT_TTL[type] ?? DEFAULT_TTL.info;
  const dismiss = () => {
    el.remove();
    if (!container.children.length) container.remove();
  };
  el.addEventListener('click', dismiss);
  container.appendChild(el);
  setTimeout(dismiss, ttl);
}

export const toast = {
  info: (msg, ms) => showToast(msg, 'info', ms),
  success: (msg, ms) => showToast(msg, 'success', ms),
  warning: (msg, ms) => showToast(msg, 'warning', ms),
  error: (msg, ms) => showToast(msg, 'error', ms),
};
