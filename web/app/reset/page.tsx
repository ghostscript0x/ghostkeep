'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

function ResetInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  async function submit() {
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      setOk(true); setMsg('Password changed. Log in with the new one.');
    } catch (e) { setMsg('⚠️ ' + (e as Error).message + ' — links expire after 1 hour; request a fresh one from the login page.'); }
  }

  return (
    <div className="gk-card">
      <h2>Choose a new password 🔑</h2>
      {!token && <p className="gk-sub">This page needs a reset link — check your email for the full link.</p>}
      {token && !ok && (<>
        <label className="gk-sub" htmlFor="gk-newpass">New password (at least 12 characters)</label>
        <div className="gk-passwrap">
          <input id="gk-newpass" className="gk-input" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="gk-eye" aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁️'}</button>
        </div>
        <div className="gk-row"><button className="gk-btn" onClick={submit}>Set new password</button></div>
      </>)}
      {msg && <p className={ok ? 'gk-msg ok' : 'gk-msg err'}>{msg}</p>}
      {ok && <p><a className="gk-link" href="/">Go to login →</a></p>}
    </div>
  );
}

export default function Reset() {
  return <Suspense fallback={<div className="gk-card"><p className="gk-sub">Loading…</p></div>}><ResetInner /></Suspense>;
}
