import pino from 'pino';

// Redact everything sensitive. Never log message text, payloads, QR, keys, tokens.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      '*.password', '*.password_hash', '*.token', '*.qr', '*.qrPayload',
      '*.messageText', '*.text', '*.content', '*.ciphertext', '*.sessionCredentials',
      '*.encrypted*', '*.key', '*.secret', '*.verifyCode', '*.plaintext',
      'req.headers.cookie', 'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
});
