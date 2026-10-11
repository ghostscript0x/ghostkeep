export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Raw server codes → plain sentences a non-technical user can act on.
// Unknown codes fall through unchanged (still debuggable).
const FRIENDLY: Record<string, string> = {
  invalid_credentials: 'Wrong email or password. Try again.',
  email_taken: 'That email already has an account. Try logging in instead.',
  invalid_input_consent_required: 'Please tick both agreement boxes to continue.',
  consent_required: 'Please accept to continue.',
  risk_consent_required: 'Please finish step 2 (accept the risks) first.',
  email_not_verified: 'Please confirm your email first (step 1).',
  invalid_token: 'That code didn’t work — it may be old or already used.',
  invalid_code: 'Wrong code. Check the message and try again.',
  invalid_phone: 'That phone number doesn’t look right. Use digits with country code, e.g. +15551234567.',
  pairing_unavailable_retry: 'WhatsApp is throttling pairing codes right now. Wait a few minutes and try again.',
  unauthorized: 'You’ve been logged out. Please log in again.',
  forbidden: 'You don’t have access to that.',
  no_verified_destination: 'Verify your recovery number first (step 4).',
  wa_not_connected: 'WhatsApp isn’t connected right now. Relink and retry.',
};

export async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const code = (await res.json().catch(() => ({ error: res.statusText }))).error ?? 'request_failed';
    throw new Error(FRIENDLY[code] ?? `Something went wrong (${code}). Please try again.`);
  }
  return res.json();
}
