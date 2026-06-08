import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { MagnifyingGlass, Plugs, X, ArrowSquareOut, ArrowLeft } from "@phosphor-icons/react";
import { COMPOSIO_APPS } from "../data/composio_apps";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

/**
 * Public "/apps" route — a searchable index of every Composio app that can be
 * connected via username + password (not OAuth). Publicly browsable, not linked from nav.
 */
export default function ConnectableApps() {
  const { user } = useAuth();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COMPOSIO_APPS;
    return COMPOSIO_APPS.filter((a) => a.toLowerCase().includes(needle));
  }, [q]);

  // Group alphabetically for browsable layout
  const groups = useMemo(() => {
    const g = {};
    for (const name of filtered) {
      const k = (name[0] || "").toUpperCase().match(/[A-Z]/) ? name[0].toUpperCase() : "#";
      (g[k] = g[k] || []).push(name);
    }
    return Object.entries(g).sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
  }, [filtered]);

  const body = (
    <div data-testid="apps-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto w-full">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>Internal · Composio app catalog</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
        <Plugs size={28} className="text-[var(--wz-amber)]" />
        Connectable apps
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        Every third-party app you can connect to NextCapOS via Composio using a username + password
        (and where applicable, an API key). <strong>{COMPOSIO_APPS.length.toLocaleString()}</strong> apps total.
      </p>

      {/* Search */}
      <div className="mt-6 relative max-w-xl">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wz-text-tertiary)] pointer-events-none"
        />
        <input
          data-testid="apps-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search 1,163 apps — gmail, salesforce, hubspot, …"
          className="wz-input pl-9 pr-9 w-full"
        />
        {q && (
          <button
            data-testid="apps-search-clear"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Result count */}
      <div className="mt-3 text-xs font-mono-wz text-[var(--wz-text-tertiary)]" data-testid="apps-count">
        {filtered.length === COMPOSIO_APPS.length
          ? `${filtered.length.toLocaleString()} apps`
          : `${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"} · ${COMPOSIO_APPS.length.toLocaleString()} total`}
      </div>

      {/* Index */}
      {filtered.length > 0 && groups.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1 text-[10px] font-mono-wz" data-testid="apps-az-index">
          {groups.map(([letter]) => (
            <a
              key={letter}
              href={`#letter-${letter}`}
              className="px-2 py-1 border border-[var(--wz-border)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-text)] uppercase tracking-widest text-[var(--wz-text-tertiary)]"
            >
              {letter}
            </a>
          ))}
        </div>
      )}

      {/* Groups */}
      <div className="mt-8 space-y-8" data-testid="apps-groups">
        {filtered.length === 0 ? (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]" data-testid="apps-empty">
            No apps match "<span className="text-[var(--wz-text)]">{q}</span>".
          </div>
        ) : (
          groups.map(([letter, items]) => (
            <section key={letter} id={`letter-${letter}`} data-testid={`apps-group-${letter}`}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="font-display text-xl tracking-tight text-[var(--wz-amber)]">{letter}</h2>
                <span className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
                  {items.length} app{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {items.map((name) => (
                  <a
                    key={name}
                    href={`https://app.composio.dev/app/${encodeURIComponent(name.toLowerCase())}`}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`app-${name}`}
                    className="group border border-[var(--wz-border)] hover:border-[var(--wz-amber)] px-3 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 min-w-0"
                  >
                    <span className="truncate">{name}</span>
                    <ArrowSquareOut
                      size={11}
                      className="text-[var(--wz-text-tertiary)] group-hover:text-[var(--wz-amber)] shrink-0"
                    />
                  </a>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="mt-12 text-xs text-[var(--wz-text-tertiary)] border-t border-[var(--wz-border)] pt-6 max-w-2xl">
        Each tile links to the Composio app page where you can authorize the connection. Already-wired
        integrations live on the{" "}
        {user ? (
          <Link to="/app/composio" className="underline">Integrations</Link>
        ) : (
          <Link to="/login" className="underline">Integrations</Link>
        )}{" "}
        page.
      </div>
    </div>
  );

  // Authenticated visitors get the page rendered inside the app shell (Layout
  // wraps it via App.js for `/app/*` routes). For unauthenticated visitors we
  // render a minimal public chrome around the body so the catalog stands alone.
  if (user) return body;

  return (
    <div className="min-h-screen grain" data-testid="apps-public-shell">
      <header className="border-b border-[var(--wz-border)] sticky top-0 z-30 backdrop-blur-md"
              style={{ background: "color-mix(in srgb, var(--wz-bg) 88%, transparent)" }}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0" data-testid="apps-public-brand">
            <Logo size="sm" testid="apps-public-logo" />
            <div className="min-w-0">
              <div className="font-display font-medium tracking-tighter text-base leading-none">NextCapOS</div>
              <div className="overline mt-1 truncate">Composio app catalog · public</div>
            </div>
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/" className="hidden sm:inline-flex text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] items-center gap-1.5">
              <ArrowLeft size={12} /> NextCapOS home
            </Link>
            <Link to="/login" data-testid="apps-public-signin" className="wz-btn wz-btn-gold text-xs px-3 py-1.5">
              Sign in
            </Link>
            <ThemeToggle testId="apps-public-theme" />
          </div>
        </div>
      </header>
      {body}
    </div>
  );
}
