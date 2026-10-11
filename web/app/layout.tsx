import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="gk-shell">
          <nav className="gk-nav">
            <a className="gk-brand" href="/dashboard">
              <div className="gk-logo">👻</div>
              <div><b>GhostKeep</b><small>Deleted doesn&apos;t have to mean gone.</small></div>
            </a>
            <div className="gk-nav-links">
              <a href="/dashboard">Home</a>
              <a href="/history">History</a>
            </div>
          </nav>
          <main>{children}</main>
          <footer className="gk-footer">
            <nav>
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="/dashboard">Home</a>
              <a href="/history">History</a>
            </nav>
            <p>GhostKeep is an unofficial tool. Not affiliated with WhatsApp or Meta.</p>
            <p>Recovery is best-effort and never guaranteed. Use only with accounts you own.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
