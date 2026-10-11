export default function Privacy() {
  return (
    <div className="gk-card gk-legal">
      <h2>Privacy Policy</h2>
      <p className="gk-sub">Last updated: October 2026. Short version: we store the minimum, encrypt what we keep, our staff can&apos;t read your messages, and you can delete everything anytime.</p>

      <h3>1. What we store</h3>
      <ul>
        <li><b>Account:</b> email, password hash, verification and consent timestamps.</li>
        <li><b>Connection:</b> encrypted WhatsApp session credentials, connection status, last-connected time, redacted error codes.</li>
        <li><b>Destination:</b> your recovery number (masked everywhere except delivery) and whether it&apos;s verified.</li>
        <li><b>Only deleted-and-caught messages:</b> an encrypted recovery record plus delivery metadata. Nothing else becomes a stored record. Ever.</li>
      </ul>

      <h3>2. What we NEVER store</h3>
      <ul>
        <li>Ordinary chat content — messages sit in short-lived memory (max ~15 minutes) and are discarded if no deletion arrives. No chat history, no transcripts, no analytics on message text.</li>
        <li>Media bytes — forwarded instantly, never kept (view-once is skipped entirely).</li>
        <li>Passwords (only salted hashes), encryption keys in code or database, QR contents, or full message payloads in logs.</li>
      </ul>

      <h3>3. Encryption & the honest limitation</h3>
      <p>Recovery records and session credentials are encrypted with AES-256-GCM envelope encryption; keys live in server configuration, never in the database or frontend. <b>Limitation you must understand:</b> forwarding requires our worker to briefly handle message text, so the service operator could technically access it during processing. This is <b>not</b> end-to-end encrypted or zero-knowledge storage. What we <b>can</b> promise: staff tooling and the admin dashboard have no view, search, or decrypt path for your content — that absence is enforced in code and tested.</p>

      <h3>4. How long we keep things</h3>
      <p>Recovery records expire automatically (default 30 days) and are then permanently deleted. Logs are short-lived and contain IDs and statuses only. Deleting your records or account in the dashboard removes them immediately, including encrypted blobs and sessions.</p>

      <h3>5. Your rights</h3>
      <ul>
        <li>See your data: the dashboard and history pages show everything we hold on you.</li>
        <li>Delete your data: one tap deletes records; one more deletes the whole account.</li>
        <li>Withdraw consent: disconnect WhatsApp or delete your account — processing stops immediately.</li>
        <li>Ask us: contact the operator through the dashboard support channel for access, correction, or deletion requests.</li>
      </ul>

      <h3>6. Cookies & security</h3>
      <p>One strictly-necessary session cookie keeps you logged in (HTTP-only, 30 days). No advertising or tracking cookies. Traffic is TLS-encrypted; passwords use modern Argon2 hashing; logins are rate-limited.</p>

      <h3>7. Sharing</h3>
      <p>We don&apos;t sell data and don&apos;t share content with anyone. Content goes only to <b>your</b> verified destination. We disclose data only if legally compelled, and will challenge overbroad requests where possible.</p>

      <h3>8. Changes</h3>
      <p>If this policy changes materially, we&apos;ll note it on the dashboard. Continued use means you accept the updated policy.</p>
    </div>
  );
}
