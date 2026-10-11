'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function History() {
  const [events, setEvents] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { api('/recovery/events').then((r) => setEvents(r.events)).catch(() => {}).finally(() => setLoaded(true)); }, []);
  return (
    <div className="gk-card">
      <h2>Recovered messages 💬</h2>
      <p className="gk-sub">Deleted messages we managed to catch, newest first. Only you can see these — not even our staff.</p>
      {!loaded && <p className="gk-sub">Loading…</p>}
      {loaded && events.length === 0 && (
        <div className="gk-notice green">Nothing here yet. When someone deletes a message we saw in time, it will show up here <b>and</b> in your WhatsApp recovery chat.</div>
      )}
      {events.map((e) => (
        <div key={e.id} className="gk-event">
          <div>
            <span className={`gk-pill ${e.status === 'recovered' ? 'connected' : e.status === 'duplicate' ? 'connecting' : 'disconnected'}`}>
              {e.status === 'recovered' ? 'Recovered ✓' : e.status}
            </span>{' '}
            <span className="meta">{new Date(e.detectedAt).toLocaleString()} · sent to WhatsApp: {e.deliveryStatus ?? '—'}</span>
          </div>
          {e.content ? (
            <div className="content">
              <div className="meta">From {e.sender}</div>
              {e.content}
            </div>
          ) : (
            <p className="empty">We saw that something was deleted, but it was gone before we could read it.</p>
          )}
        </div>
      ))}
      <p><a className="gk-link" href="/dashboard">← Back to setup</a></p>
    </div>
  );
}
