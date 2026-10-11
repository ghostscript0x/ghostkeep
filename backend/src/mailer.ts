import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';
import { logger } from './logger.js';

// SMTP mailer: verification + password-reset links. Built for deliverability:
// authenticated submission over TLS, pool with timeouts, background retries
// (3 attempts, growing delays), and a resend endpoint so a user is never
// stuck. If SMTP is not configured, routes fall back to dev-mode tokens.

const RETRIES = 3;
const DELAYS_MS = [2000, 10000, 30000];

let transporter: Transporter | null = null;
let smtpOk: boolean | null = null;

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/** Verify SMTP at boot so misconfiguration is visible immediately. */
export async function checkSmtp(): Promise<boolean> {
  if (!isSmtpConfigured()) { smtpOk = false; return false; }
  try {
    await getTransporter()!.verify();
    smtpOk = true;
    logger.info({ msg: 'smtp_ready' });
  } catch (e) {
    smtpOk = false;
    logger.error({ msg: 'smtp_verify_failed', err: String(e).slice(0, 160) });
  }
  return smtpOk;
}

export function smtpStatus(): boolean | null {
  return smtpOk;
}

async function sendWithRetry(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) return false;
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await tx.sendMail({
        from: `"GhostKeep" <${from}>`,
        to,
        subject,
        text,
        html,
        headers: { 'X-Auto-Response-Suppress': 'All' },
      });
      return true;
    } catch (e) {
      logger.error({ msg: 'smtp_send_failed', attempt, err: String(e).slice(0, 160) });
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, DELAYS_MS[attempt - 1]));
    }
  }
  return false;
}

/** Fire-and-forget: respond to the user immediately, retry in background. */
function background(to: string, subject: string, text: string, html: string, userId: string): void {
  void sendWithRetry(to, subject, text, html).then((ok) => {
    logger.info({ userId, msg: ok ? 'email_delivered' : 'email_gave_up' });
  });
}

const wrap = (preheader: string, title: string, emoji: string, body: string, cta: string, link: string, fineprint: string) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#070a08;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 12px;">
  <div style="text-align:center;padding:18px 0;">
    <div style="font-size:42px;line-height:1">👻</div>
    <div style="color:#e9f2ea;font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:6px">GhostKeep</div>
    <div style="color:#6b7f6e;font-size:13px;font-style:italic">Deleted doesn&apos;t have to mean gone.</div>
  </div>
  <div style="background:#101711;border:1px solid #1f2b21;border-radius:16px;padding:28px 26px;">
    <div style="font-size:30px">${emoji}</div>
    <h2 style="margin:10px 0 6px;color:#e9f2ea;font-size:21px;">${title}</h2>
    <p style="color:#9db3a0;font-size:15px;line-height:1.6;">${body}</p>
    <div style="text-align:center;margin:22px 0 8px;">
      <a href="${link}" style="display:inline-block;background:#43a866;color:#06120a;font-weight:800;font-size:16px;text-decoration:none;padding:15px 38px;border-radius:12px;">${cta}</a>
    </div>
    <p style="color:#6b7f6e;font-size:13px;line-height:1.6;">Button not working? Copy this link into your browser:<br>
    <a href="${link}" style="color:#8fd0a0;word-break:break-all;">${link}</a></p>
    <p style="color:#6b7f6e;font-size:12.5px;">${fineprint}</p>
  </div>
  <div style="text-align:center;padding:16px 0;">
    <p style="color:#4c5c4e;font-size:12px;margin:4px 0;">GhostKeep · unofficial tool, not affiliated with WhatsApp or Meta.</p>
    <p style="color:#4c5c4e;font-size:12px;margin:4px 0;">If you didn&apos;t ask for this email, just ignore it — nothing will happen.</p>
  </div>
</div>
</body></html>`;

export function sendVerifyEmail(to: string, userId: string, token: string): void {
  const link = `${config.webUrl}/verify?token=${encodeURIComponent(token)}`;
  background(
    to, 'Confirm your GhostKeep email',
    'One tap and your account is ready — then link your WhatsApp in about a minute.',
    wrap('Confirm it’s really you', 'Confirm your email', '✉️',
      'Tap the button below to confirm this address belongs to you. Then link your WhatsApp and you’re done — about a minute, no tech skills needed.',
      'Confirm email', link,
      'This link confirms your GhostKeep account. Links don’t expire, but each new request replaces the old one.'),
    userId,
  );
}

export function sendResetEmail(to: string, userId: string, token: string): void {
  const link = `${config.webUrl}/reset?token=${encodeURIComponent(token)}`;
  background(
    to, 'Reset your GhostKeep password',
    'Choose a new password — this link works for 1 hour.',
    wrap('Password reset requested', 'Reset your password', '🔑',
      'Tap below to choose a new password. The link expires in 1 hour. If you didn’t ask for this, ignore it — your password stays exactly as it is.',
      'Choose new password', link,
      'For safety, all your sessions are logged out whenever the password changes.'),
    userId,
  );
}
