'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Tab = 'overview' | 'users' | 'sessions' | 'events' | 'audit';

function Dot({ state }: { state: string }) {
  const cls = state === 'up' || state === 'connected' || state === 'active' || state === 'verified' || state === 'delivered' || state === 'recovered'
    ? 'up' : state === 'down' || state === 'failed' || state === 'suspended' ? 'down' : 'warn';
  return <span className={`gk-dot ${cls}`} />;
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<any>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');

  const load = (t: Tab = tab, query: string = q) => {
    setMsg('');
    const path = t === 'overview' ? '/admin/overview'
      : t === 'users' ? `/admin/users?q=${encodeURIComponent(query)}`
      : t === 'sessions' ? '/admin/sessions'
      : t === 'events' ? '/admin/events' : '/admin/audit';
    api(path).then(setData).catch(() => setData({ error: 'This area is for staff only.' }));
  };
  useEffect(() => { load('overview', ''); }, []);
  const switchTab = (t: Tab) => { setTab(t); setData(null); load(t); };

  async function suspend(id: string, suspendIt: boolean) {
    if (!confirm(suspendIt ? 'Suspend this account? They lose access immediately.' : 'Restore this account?')) return;
    await api(`/admin/users/${id}/${suspendIt ? 'suspend' : 'unsuspend'}`, { method: 'POST' }).catch((e) => setMsg('⚠️ ' + (e as Error).message));
    load();
  }
  async function reconnect(userId: string) {
    setMsg('Reconnect requested — the user will get a fresh QR on their dashboard.');
    await api(`/admin/sessions/${userId}/reconnect`, { method: 'POST' }).catch((e) => setMsg('⚠️ ' + (e as Error).message));
  }

  const o = tab === 'overview' ? data : null;

  return (
    <div>
      <div className="gk-card">
        <h2>Staff overview 🔧</h2>
        <p className="gk-sub">Numbers and statuses only. Message contents, session keys and passwords can never appear here — enforced in code, not just policy.</p>
        <div className="gk-admintabs">
          {(['overview', 'users', 'sessions', 'events', 'audit'] as const).map((t) => (
            <button key={t} onClick={() => switchTab(t)} className={`gk-btn ghost gk-mini${tab === t ? ' active-tab' : ''}`}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {msg && <p className="gk-msg">{msg}</p>}
      </div>

      {tab === 'overview' && (
        <div className="gk-card">
          <h2>Right now</h2>
          {!o ? <p className="gk-sub">Loading…</p> : o.error ? <p className="gk-msg err">{o.error}</p> : (<>
            <div className="gk-grid4">
              <div className="gk-tile"><b>{o.users.total}</b><span>accounts</span><span className="sub">{o.users.suspended} suspended</span></div>
              <div className="gk-tile"><b>{o.sessions.connected}</b><span>WhatsApp linked</span><span className="sub">{o.sessions.disconnected} offline</span></div>
              <div className="gk-tile"><b>{o.events.total}</b><span>deletion events</span><span className="sub">{o.events.recovered} recovered</span></div>
              <div className="gk-tile"><b>{o.delivery.failed}</b><span>failed deliveries</span><span className="sub">v{o.version}</span></div>
            </div>
            <Health />
          </>)}
        </div>
      )}

      {tab === 'users' && (
        <div className="gk-card">
          <h2>Accounts</h2>
          <div className="gk-row" style={{ marginTop: 0, marginBottom: 12 }}>
            <input className="gk-input" style={{ flex: 1, minWidth: 200 }} placeholder="Search email or user ID…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load('users')} />
            <button className="gk-btn ghost" onClick={() => load('users')}>Search</button>
          </div>
          {!data ? <p className="gk-sub">Loading…</p> : (
            <div className="gk-tablewrap"><table className="gk-table">
              <thead><tr><th>Email</th><th>Status</th><th>WhatsApp</th><th>Joined</th><th></th></tr></thead>
              <tbody>{(data.users ?? []).map((u: any) => (
                <tr key={u.id}>
                  <td>{u.email}<br /><span className="gk-sub" style={{ fontSize: 12 }}>{u.id.slice(0, 8)}…</span></td>
                  <td><Dot state={u.status} />{u.status}</td>
                  <td>{u.connection_status ? (<><Dot state={u.connection_status} />{u.connection_status}</>) : '—'}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>{u.status === 'suspended'
                    ? <button className="gk-btn ghost gk-mini" onClick={() => suspend(u.id, false)}>Restore</button>
                    : <button className="gk-btn danger gk-mini" onClick={() => suspend(u.id, true)}>Suspend</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <div className="gk-card">
          <h2>Sessions</h2>
          <p className="gk-sub">Connection health only — credentials are never shown.</p>
          {!data ? <p className="gk-sub">Loading…</p> : (
            <div className="gk-tablewrap"><table className="gk-table">
              <thead><tr><th>User</th><th>Status</th><th>Last connected</th><th>Last error</th><th></th></tr></thead>
              <tbody>{(data.sessions ?? []).map((s: any) => (
                <tr key={s.user_id}>
                  <td style={{ fontSize: 12 }}>{s.user_id.slice(0, 8)}…</td>
                  <td><Dot state={s.connection_status} />{s.connection_status}</td>
                  <td>{s.last_connected_at ? new Date(s.last_connected_at).toLocaleString() : '—'}</td>
                  <td>{s.last_error_code ?? '—'}</td>
                  <td><button className="gk-btn ghost gk-mini" onClick={() => reconnect(s.user_id)}>Ask relink</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="gk-card">
          <h2>Deletion events & delivery</h2>
          <p className="gk-sub">Counts and statuses. Content is never queryable here.</p>
          {!data ? <p className="gk-sub">Loading…</p> : (
            <div className="gk-tablewrap"><table className="gk-table">
              <thead><tr><th>When</th><th>User</th><th>Result</th><th>Tries</th><th>Error</th></tr></thead>
              <tbody>{(data.events ?? []).map((e: any, i: number) => (
                <tr key={i}>
                  <td>{new Date(e.detected_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{String(e.user_id).slice(0, 8)}…</td>
                  <td><Dot state={e.event_status} />{e.event_status}</td>
                  <td>{e.delivery_attempt_count}</td>
                  <td>{e.last_delivery_error_code ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="gk-card">
          <h2>Audit trail</h2>
          <p className="gk-sub">Who did what, when. Every privileged action lands here.</p>
          {!data ? <p className="gk-sub">Loading…</p> : (
            <div className="gk-tablewrap"><table className="gk-table">
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
              <tbody>{(data.audit ?? []).map((a: any, i: number) => (
                <tr key={i}>
                  <td>{new Date(a.timestamp).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{String(a.admin_user_id).slice(0, 8)}…</td>
                  <td>{a.action_type}</td>
                  <td style={{ fontSize: 12 }}>{a.target_user_id ? String(a.target_user_id).slice(0, 8) + '…' : '—'}</td>
                  <td>{a.result}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

function Health() {
  const [h, setH] = useState<any>(null);
  useEffect(() => { api('/admin/health').then(setH).catch(() => {}); }, []);
  if (!h) return null;
  return (
    <div>
      <h3 style={{ margin: '14px 0 4px', fontSize: 14, color: 'var(--muted)' }}>SYSTEM HEALTH</h3>
      <div className="gk-health">
        <span><Dot state={h.db === 'up' ? 'up' : 'down'} />DB {h.db}</span>
        <span><Dot state={h.redis === 'up' ? 'up' : 'down'} />Redis {h.redis}</span>
        <span><Dot state={h.worker === 'up' ? 'up' : 'warn'} />Worker {h.worker}</span>
        <span>Queue: <b>&nbsp;{h.queueDepth}</b></span>
        <span>Cache: <b>&nbsp;{h.cacheSize}</b></span>
        <span>Uptime: <b>&nbsp;{Math.round(h.uptimeSec / 60)}m</b></span>
      </div>
    </div>
  );
}
