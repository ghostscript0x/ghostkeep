'use client';
import { useState } from 'react';
import { api } from '../lib/api';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [tos, setTos] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [msg, setMsg] = useState('');
  const [isErr, setIsErr] = useState(false);
  const [cls, setCls] = useState('');

  async function submit() {
    setIsErr(false); setCls('');
    try {
      if (mode === 'login') {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        location.href = '/dashboard';
      } else if (mode === 'register') {
        if (!tos || !privacy) { setIsErr(true); setMsg('Please tick both boxes so we know you agree.'); return; }
        const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, consents: { tos: true, privacy: true } }) });
        if (r.emailSent) { setCls('ok'); setMsg('Account created — check your inbox for the confirmation link (and spam, just in case).'); }
        else { setCls('ok'); setMsg('Account created. ' + (r.verifyToken ? 'Dev mode: your verify code is ' + r.verifyToken + ' — paste it on the dashboard.' : 'Check your email for the verify link.')); }
      } else {
        const r = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setMsg(r.emailSent ? 'Reset link sent — check your inbox (and spam). It works for 1 hour.' : 'If that email exists, a reset was prepared.' + (r.resetToken ? ' Dev code: ' + r.resetToken : ''));
      }
    } catch (e) {
      setIsErr(true);
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="gk-card">
      <h2>{mode === 'login' ? 'Welcome back 👋' : mode === 'register' ? 'Create your account' : 'Reset your password'}</h2>
      <p className="gk-sub">
        {mode === 'login'
          ? 'Log in to see your WhatsApp connection and recovered messages.'
          : mode === 'register'
            ? 'One account, one WhatsApp number. Takes about a minute — no tech skills needed.'
            : 'We’ll prepare a reset for that email address.'}
      </p>
      <div className="gk-tabs">
        {(['login', 'register', 'reset'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`gk-btn ghost${mode === m ? ' active-tab' : ''}`}>
            {m === 'login' ? 'Log in' : m === 'register' ? 'Sign up' : 'Forgot password'}
          </button>
        ))}
      </div>
      <label className="gk-sub" htmlFor="gk-email">Email address</label>
      <input id="gk-email" className="gk-input" placeholder="you@example.com" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== 'reset' && (<>
        <label className="gk-sub" htmlFor="gk-pass">Password (at least 12 characters)</label>
        <div className="gk-passwrap">
          <input id="gk-pass" className="gk-input" placeholder="Choose a strong password" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="gk-eye" aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁️'}</button>
        </div>
      </>)}
      {mode === 'register' && (<>
        <label className="gk-check"><input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} />
          <span>I have read and agree to the <a href="/terms">Terms of Service</a>, including that GhostKeep is unofficial, recovery is never guaranteed, and I use it at my own risk.</span>
        </label>
        <label className="gk-check"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          <span>I have read the <a href="/privacy">Privacy Policy</a> and understand what is stored, what is never stored, and that staff cannot see my recovered messages.</span>
        </label>
      </>)}
      <div className="gk-row">
        <button className="gk-btn" onClick={submit}>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Send reset'}</button>
      </div>
      {msg && <p className={`gk-msg${isErr ? ' err' : ''} ${cls}`}>{msg}</p>}
      <p className="gk-sub" style={{ marginTop: 14 }}>Protected by plain-English rules: <a className="gk-link" href="/privacy">Privacy</a> · <a className="gk-link" href="/terms">Terms</a></p>
    </div>
  );
}
