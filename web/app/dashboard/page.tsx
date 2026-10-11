'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className={`gk-step${done ? ' done' : ''}`}>
      <div className="gk-step-num">{done ? '✓' : n}</div>
      <div className="gk-step-body">
        <h3>{title} {done && <span className="gk-step-check">· Done</span>}</h3>
        {children}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [riskTick, setRiskTick] = useState(false);
  const [dest, setDest] = useState('');
  const [code, setCode] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => api('/me').then(setMe).catch(() => (location.href = '/'));
  useEffect(() => { refresh(); }, []);

  async function run(fn: () => Promise<void>, okMsg?: string) {
    setBusy(true); setMsg('');
    try { await fn(); if (okMsg) setMsg(okMsg); await refresh(); }
    catch (e) { setMsg('⚠️ ' + (e as Error).message); }
    finally { setBusy(false); }
  }

  if (!me) return <div className="gk-card"><p className="gk-sub">Loading your account…</p></div>;

  const emailOk: boolean = !!me.emailVerified;
  const riskOk: boolean = !!me.consents?.waRisk;
  const status: string = me.connectionStatus ?? 'disconnected';
  const linked = status === 'connected';
  const destOk: boolean = !!me.destination && me.destination.verificationStatus === 'verified';
  const doneCount = [emailOk, riskOk, linked, destOk].filter(Boolean).length;

  return (
    <div>
      <div className="gk-card">
        <h2>Let&apos;s get you set up 🎉</h2>
        <p className="gk-sub">Four small steps. Nothing technical — just follow along.</p>
        <div className="gk-progress">{[emailOk, riskOk, linked, destOk].map((d, i) => <i key={i} className={d ? 'on' : ''} />)}</div>
        <p className="gk-sub">{doneCount} of 4 steps complete</p>
      </div>

      <div className="gk-card">
        <Step n={1} done={emailOk} title="Confirm your email">
          {!emailOk ? (<>
            <p className="gk-sub">We need to know it&apos;s really you. Paste the verify code (shown after sign-up in dev mode):</p>
            <input className="gk-input" placeholder="Verify code" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
            <div className="gk-row">
              <button className="gk-btn" disabled={busy} onClick={() => run(() => api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verifyToken }) }), 'Email confirmed. Welcome in!')}>Confirm email</button>
            </div>
          </>) : <p className="gk-sub">Signed in as <b>{me.email}</b>. All good here.</p>}
        </Step>
      </div>

      <div className="gk-card">
        <Step n={2} done={riskOk} title="Understand the risks (please read)">
          {!riskOk ? (<>
            <div className="gk-notice"><ul>
              <li><b>GhostKeep is unofficial.</b> It is not made by, or connected to, WhatsApp or Meta.</li>
              <li><b>Your number could be limited or banned</b> by WhatsApp for using unofficial tools. That would be between you and WhatsApp — we can&apos;t prevent or undo it.</li>
              <li><b>Recovery is best-effort, never guaranteed.</b> If a message is deleted before we see it, it&apos;s gone for good.</li>
              <li><b>Only link a number you own</b> and have the right to connect. Don&apos;t use this on anyone else&apos;s account.</li>
            </ul></div>
            <label className="gk-check"><input type="checkbox" checked={riskTick} onChange={(e) => setRiskTick(e.target.checked)} />
              <span>I understand all four points above and I accept the risk. Full details in the <a href="/terms">Terms</a>.</span>
            </label>
            <div className="gk-row">
              <button className="gk-btn" disabled={busy || !riskTick} onClick={() => run(() => api('/settings/consents', { method: 'PUT', body: JSON.stringify({ waRisk: true }) }), 'Thanks — recorded.')}>I understand, continue</button>
            </div>
          </>) : <p className="gk-sub">Risk accepted and recorded. You can re-read the <a className="gk-link" href="/terms">Terms</a> anytime.</p>}
        </Step>
      </div>

      <div className="gk-card">
        <Step n={3} done={linked} title="Link your WhatsApp">
          <p className="gk-sub">We&apos;ll show a QR code. On your phone open <b>WhatsApp → Settings → Linked devices → Link a device</b> and scan it.</p>
          <div className="gk-row">
            <span>Status:</span>
            <span className={`gk-pill ${status}`}>{status.replace(/_/g, ' ')}</span>
          </div>
          {!riskOk && <p className="gk-sub">☝️ Finish step 2 first — the button unlocks after you accept the risks.</p>}
          <div className="gk-row">
            <button className="gk-btn" disabled={busy || !riskOk} onClick={() => run(async () => { const r = await api('/whatsapp/session/start', { method: 'POST' }); setQr(r.qrDataUrl || ''); setMsg(r.qrDataUrl ? 'QR ready — scan it with your phone.' : 'Already connected — nothing to scan.'); })}>Show QR code</button>
            <button className="gk-btn danger" disabled={busy} onClick={() => { if (confirm('Disconnect your WhatsApp from GhostKeep?')) run(() => api('/whatsapp/session', { method: 'DELETE' }), 'Disconnected.'); }}>Disconnect</button>
          </div>
          {qr && (<div className="gk-qr-wrap"><div className="gk-qr">
            <img src={qr} alt="WhatsApp pairing QR code" width={240} />
            <p>Scan within about a minute. If it expires, just tap “Show QR code” again.</p>
          </div></div>)}
        </Step>
      </div>

      <div className="gk-card">
        <Step n={4} done={destOk} title="Where should recovered messages go?">
          <p className="gk-sub">Enter the phone number that should receive recovered messages (usually your own number, with country code).</p>
          <p className="gk-sub">Current: <b>{me.destination ? `${me.destination.identifierPreview} (${me.destination.verificationStatus})` : 'not set yet'}</b></p>
          <label className="gk-sub" htmlFor="gk-dest">Phone number</label>
          <input id="gk-dest" className="gk-input" placeholder="+15551234567" inputMode="tel" value={dest} onChange={(e) => setDest(e.target.value)} />
          <div className="gk-row">
            <button className="gk-btn ghost" disabled={busy} onClick={() => run(() => api('/settings/recovery-destination', { method: 'PUT', body: JSON.stringify({ destination: dest }) }).then((r) => { if (r.devCode) setCode(r.devCode); }), 'Code sent over WhatsApp — enter it below.')}>Save & send code</button>
          </div>
          <label className="gk-sub" htmlFor="gk-code">6-digit code from WhatsApp</label>
          <input id="gk-code" className="gk-input" placeholder="123456" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="gk-row">
            <button className="gk-btn ghost" disabled={busy} onClick={() => run(() => api('/settings/recovery-destination/verify', { method: 'POST', body: JSON.stringify({ code }) }), 'Number verified. You’re all set! 🎉')}>Verify number</button>
          </div>
        </Step>
      </div>

      {msg && <div className="gk-card"><p className="gk-msg">{msg}</p></div>}

      <div className="gk-card">
        <h2>Your activity</h2>
        <div className="gk-stat">
          <div><b>{me.totalEvents}</b><span>deletion events seen</span></div>
          <div><b>{me.lastActivity ? new Date(me.lastActivity).toLocaleString() : '—'}</b><span>last activity</span></div>
        </div>
        <a className="gk-link" href="/history">See recovered messages →</a>
      </div>

      <div className="gk-card">
        <h2>Danger zone</h2>
        <p className="gk-sub">Delete your saved recoveries, or your whole account (this also wipes everything we hold on you).</p>
        <div className="gk-row">
          <button className="gk-btn danger" disabled={busy} onClick={() => { if (confirm('Delete all saved recovery records?')) run(() => api('/recovery-records', { method: 'DELETE' }), 'Records deleted.'); }}>Delete my records</button>
          <button className="gk-btn danger" disabled={busy} onClick={() => { if (confirm('Really delete your entire account and everything? This cannot be undone.')) run(() => api('/account', { method: 'DELETE' }).then(() => { location.href = '/'; }), undefined); }}>Delete my account</button>
        </div>
      </div>
    </div>
  );
}
