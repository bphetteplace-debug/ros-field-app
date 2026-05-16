// Floating ✨ chat button + slide-up drawer. Mounted in Layout, so it
// appears on every authenticated page. Customer-facing pages (/track,
// /share) are unauthenticated and don't get a Layout wrapper, so they
// never see this.
//
// State is intentionally local to this component — closing the drawer
// resets the conversation. (Persisting across tab open/close adds
// complexity for low real-world value; the techs ask one-off questions.)

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { toast } from '../lib/toast';

function getAuthToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    return JSON.parse(localStorage.getItem(key))?.access_token || null;
  } catch (_) { return null; }
}

const SUGGESTED_PROMPTS = [
  'What jobs did we do this week?',
  'What parts are low on my truck?',
  'When did we last service Diamondback?',
  'Who is currently on the road?',
];

export default function AssistantDrawer() {
  const { user, profile, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Don't render the button at all when there's no logged-in user.
  // (Layout only renders in the authenticated branch, but belt + braces.)
  const showButton = !!user;

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Focus textarea when drawer opens. Track the timer so it can be cleared
  // if the drawer closes within 100ms of opening — without cleanup the
  // focus() still fires (no-ops on a null ref, but lints noisily).
  useEffect(() => {
    if (!open || !textareaRef.current) return;
    const t = setTimeout(() => textareaRef.current && textareaRef.current.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  async function send(messageOverride) {
    const text = (messageOverride || input).trim();
    if (!text || sending) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setSending(true);

    const token = getAuthToken();
    if (!token) {
      setMessages([...newMessages, { role: 'assistant', content: 'You need to sign in again — your session expired.' }]);
      setSending(false);
      return;
    }

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          message: text,
          messages: newMessages.slice(0, -1), // history WITHOUT the just-sent message (server appends it)
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body && body.error ? body.error : 'Assistant request failed (HTTP ' + res.status + ')';
        setMessages([...newMessages, { role: 'assistant', content: '⚠️ ' + msg }]);
      } else {
        const reply = (body && typeof body.reply === 'string' && body.reply.trim()) || 'No response.';
        const events = (body && Array.isArray(body.toolEvents)) ? body.toolEvents : [];
        setMessages([...newMessages, { role: 'assistant', content: reply, toolEvents: events }]);
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: '⚠️ Network error: ' + (e.message || e) }]);
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    if (sending) return;
    setMessages([]);
    setInput('');
  }

  function handleKey(e) {
    // Enter sends, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!showButton) return null;

  // ─── BUTTON ───
  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open AI assistant"
      title="Ask the assistant"
      style={{
        position: 'fixed',
        bottom: 18,
        right: 18,
        zIndex: 9980,
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
        color: '#fff',
        border: 'none',
        boxShadow: '0 6px 18px rgba(99, 102, 241, 0.35), 0 2px 6px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        fontSize: 24,
        display: open ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
      }}
    >
      ✨
    </button>
  );

  if (!open) return button;

  // ─── DRAWER ───
  return (
    <>
      {button}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15, 31, 56, 0.55)',
          zIndex: 9990,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          bottom: 0, right: 0,
          width: '100%',
          maxWidth: 460,
          height: '85vh',
          maxHeight: 720,
          background: '#fff',
          zIndex: 9991,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* HEADER */}
        <div style={{
          background: 'linear-gradient(135deg, #1a2332 0%, #312e81 100%)',
          color: '#fff', padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✨</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.3 }}>Ask the assistant</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Read-only — looks up your data, doesn't change anything
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                disabled={sending}
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 22, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              aria-label="Close"
            >×</button>
          </div>
        </div>

        {/* MESSAGES */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginTop: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✨</div>
              <div style={{ fontWeight: 700, color: '#1a2332', marginBottom: 6 }}>How can I help, {profile?.full_name?.split(' ')[0] || 'there'}?</div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>
                I can look up jobs, customers, tech assignments, inventory, and recent activity.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320, margin: '0 auto' }}>
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => send(p)}
                    style={{ textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#1a2332', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
                  >
                    💬 {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {sending && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
              <span style={{
                display: 'inline-block', width: 14, height: 14,
                border: '2px solid #c4b5fd', borderTopColor: '#6366f1',
                borderRadius: '50%', animation: 'ocrSpin 0.9s linear infinite',
              }}></span>
              Thinking…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT */}
        <div style={{
          borderTop: '1px solid #e2e8f0',
          padding: '10px 12px',
          background: '#fff',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything — jobs, parts, customers, schedules…"
            disabled={sending}
            rows={1}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            style={{
              background: (sending || !input.trim()) ? '#9ca3af' : 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '10px 16px', fontSize: 14, fontWeight: 800,
              cursor: (sending || !input.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const bg = isUser ? '#e65c00' : '#fff';
  const color = isUser ? '#fff' : '#1a2332';
  const align = isUser ? 'flex-end' : 'flex-start';
  return (
    <div style={{ alignSelf: align, maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        background: bg, color,
        padding: '10px 14px',
        borderRadius: 14,
        borderBottomRightRadius: isUser ? 4 : 14,
        borderBottomLeftRadius: isUser ? 14 : 4,
        fontSize: 14, lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        border: isUser ? 'none' : '1px solid #e2e8f0',
        wordWrap: 'break-word',
      }}>{message.content}</div>
      {!isUser && Array.isArray(message.toolEvents) && message.toolEvents.length > 0 && (
        <div style={{ fontSize: 11, color: '#94a3b8', paddingLeft: 4 }}>
          🔍 {message.toolEvents.map(t => t.name).join(' · ')}
        </div>
      )}
    </div>
  );
}
