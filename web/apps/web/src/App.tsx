const STYLES = `
  :root {
    --signal-orange: #c84b31;
    --structural-navy: #173f67;
    --ledger-cream: #f5f2ec;
    --surface: #ffffff;
    --ink: #17212b;
    --line: #ddd7cc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ledger-cream);
    color: var(--ink);
    font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
    line-height: 1.5;
  }
  .shell { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .banner {
    display: inline-block;
    background: var(--signal-orange);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
  }
  h1 {
    font-size: clamp(1.75rem, 5vw, 2.5rem);
    line-height: 1.15;
    margin: 1rem 0 0.5rem;
    color: var(--structural-navy);
  }
  .lede { margin: 0 0 2rem; font-size: 1.0625rem; max-width: 42rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 3px solid var(--structural-navy);
    border-radius: 0.25rem;
    padding: 1rem 1.1rem;
    min-width: 0;
  }
  .card h2 { font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--structural-navy); margin: 0 0 0.5rem; }
  .card p { margin: 0; font-size: 0.9375rem; }
  code {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    background: var(--ledger-cream);
    border: 1px solid var(--line);
    border-radius: 0.2rem;
    padding: 0.1rem 0.35rem;
    font-size: 0.875em;
    overflow-wrap: anywhere;
  }
  .note {
    margin-top: 2rem;
    border-top: 1px solid var(--line);
    padding-top: 1rem;
    font-size: 0.875rem;
  }
`;

export function App() {
  return (
    <>
      <style>{STYLES}</style>
      <main className="shell">
        <span className="banner" data-testid="environment-banner">
          Development preview
        </span>
        <h1>DROMEX Web</h1>
        <p className="lede">
          This page confirms the local web foundation runs. It is not the product, and
          nothing here reads or writes real business records.
        </p>

        <div className="grid">
          <section className="card">
            <h2>Liveness</h2>
            <p>
              <code>GET /health</code> reports whether the process is running. It never
              consults the database.
            </p>
          </section>
          <section className="card">
            <h2>Readiness</h2>
            <p>
              <code>GET /ready</code> verifies PostgreSQL answers, and returns 503 with a
              generic body when it does not.
            </p>
          </section>
          <section className="card">
            <h2>Sign-in</h2>
            <p>
              Not built yet. The approach is still an open question, so no accounts,
              sessions, or recovery exist.
            </p>
          </section>
        </div>

        <p className="note">
          Android remains the working application and is unaffected by anything here.
        </p>
      </main>
    </>
  );
}
