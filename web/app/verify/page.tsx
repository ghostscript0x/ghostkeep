'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, API } from '../../lib/api';

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState('');

  useEffect(() => {
    if (!token) { setState('bad'); return; }
    api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('ok'))
      .catch(() => setState('bad'));
  }, [token]);

  async function resend() {
    await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }).catch(() => {});
    setResent('If that email is waiting on confirmation, a fresh link is on its way.');
  }

  return (
    <div className="gk-card">
      <h2>Confirm your email ✉️</h2>
      {state === 'working' && <p className="gk-sub">Checking your link…</p>}
      {state === 'ok' && (<>
        <div className="gk-notice green">All confirmed — your account is ready.</div>
        <div className="gk-row"><a className="gk-btn" style={{ textDecoration: 'none' }} href="/dashboard">Continue to setup</a></div>
      </>)}
      {state === 'bad' && (<>
        <div className="gk-notice">That link didn&apos;t work — it may be old or already used. Ask for a fresh one:</div>
        <input className="gk-input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="gk-row"><button className="gk-btn" onClick={resend}>Send a new link</button></div>
        {resent && <p className="gk-msg ok">{resent}</p>}
      </>)}
      <p className="gk-sub" style={{ marginTop: 12 }}>API: {API}</p>
    </div>
  );
}

export default function Verify() {
  return <Suspense fallback={<div className="gk-card"><p className="gk-sub">Loading…</p></div>}><VerifyInner /></Suspense>;
}
