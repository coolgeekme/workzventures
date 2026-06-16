import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Files, Eye, Clock, Lock, ShieldCheck } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { marketingUrl } from "../lib/hostRouting";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

/**
 * Public, no-auth listing preview. Reached at /preview/listing/:token.
 *
 * Backend `/api/preview/listings/{token}` returns sanitised listing data plus
 * the data-room file metadata (no downloads). Anyone with the URL can view;
 * no NextCapOS account needed. The agent generates and revokes these from
 * the listing card on /app/listings.
 */
export default function PublicListingPreview() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    api.get(`/preview/listings/${token}`)
      .then((r) => setState({ loading: false, data: r.data, error: null }))
      .catch((e) => setState({
        loading: false,
        data: null,
        error: e?.response?.data?.detail || "Preview link unavailable",
      }));
  }, [token]);

  const fmtBytes = (n) => {
    if (!n) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  if (state.loading) {
    return <CenteredShell><div className="text-sm text-[var(--wz-text-secondary)]">Loading preview…</div></CenteredShell>;
  }
  if (state.error) {
    return (
      <CenteredShell>
        <div className="wz-card p-7 text-center max-w-md">
          <Lock size={28} className="mx-auto text-[var(--wz-text-tertiary)] mb-3" />
          <h2 className="font-display text-xl tracking-tighter mb-2">Preview unavailable</h2>
          <p className="text-sm text-[var(--wz-text-secondary)] mb-5">{state.error}</p>
          <a href={marketingUrl("/")} className="wz-btn wz-btn-ghost text-xs">Back to home</a>
        </div>
      </CenteredShell>
    );
  }

  const { listing, data_room: files, preview } = state.data;
  return (
    <div className="min-h-screen grain" data-testid="public-listing-preview">
      <header className="border-b border-[var(--wz-border)] px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 bg-[var(--wz-bg)]/95 backdrop-blur z-10">
        <a href={marketingUrl("/")} className="flex items-center gap-2">
          <Logo size="sm" testid="preview-logo" />
        </a>
        <div className="flex items-center gap-3">
          <a
            href={marketingUrl("/login")}
            data-testid="preview-signin"
            className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)]"
          >
            Sign in
          </a>
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        <div
          className="border border-[var(--wz-gold)] bg-[var(--wz-gold)]/10 px-4 py-3 flex items-start gap-3"
          data-testid="preview-banner"
        >
          <Eye size={16} className="text-[var(--wz-gold)] shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong>Private preview.</strong> {preview.shared_by_name ? `${preview.shared_by_name} shared this listing with you` : "You're viewing a private listing preview"}
            {preview.label ? ` (${preview.label})` : ""}. Expires {new Date(preview.expires_at).toLocaleString()}.
            <span className="block mt-1 text-[var(--wz-text-tertiary)]">
              No account needed. Once you accept your collaborator invitation by email you'll see the full workspace.
            </span>
          </div>
        </div>

        <div className="wz-card p-6 sm:p-8" data-testid="preview-listing-card">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`pill ${listing.status === "live" ? "pill-positive" : listing.status === "under_loi" ? "pill-amber" : "pill-gold"}`}>{listing.status}</span>
            <span className="pill pill-gold">{listing.sector}</span>
            {listing.geography && <span className="pill pill-gold">{listing.geography}</span>}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium" data-testid="preview-company-name">
            {listing.company_name}
          </h1>
          {listing.headline && (
            <p className="text-sm text-[var(--wz-text-secondary)] mt-2">{listing.headline}</p>
          )}

          <div className="grid grid-cols-3 gap-3 mt-6">
            <PreviewMetric label="Asking" value={listing.asking_price_usd_m ? `$${listing.asking_price_usd_m}M` : "—"} />
            <PreviewMetric label="Revenue" value={listing.revenue_usd_m ? `$${listing.revenue_usd_m}M` : "—"} />
            <PreviewMetric label="EBITDA" value={listing.ebitda_usd_m ? `$${listing.ebitda_usd_m}M` : "—"} />
          </div>

          {listing.summary && (
            <div className="mt-6">
              <div className="overline mb-2">Summary</div>
              <p className="text-sm text-[var(--wz-text-secondary)] leading-relaxed">{listing.summary}</p>
            </div>
          )}

          {(listing.highlights || []).length > 0 && (
            <div className="mt-6">
              <div className="overline mb-3">Highlights</div>
              <ul className="space-y-2 text-sm">
                {listing.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-[var(--wz-text-secondary)]">
                    <span className="text-[var(--wz-amber)] shrink-0">▸</span>{h}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="wz-card p-6 sm:p-8" data-testid="preview-data-room">
          <div className="flex items-center justify-between mb-3">
            <div className="overline flex items-center gap-2">
              <Files size={14} className="text-[var(--wz-gold)]" /> Listing data room
            </div>
            <span className="text-xs text-[var(--wz-text-tertiary)]">{files.length} file{files.length === 1 ? "" : "s"}</span>
          </div>
          {files.length === 0 ? (
            <div className="text-xs text-[var(--wz-text-tertiary)]">No documents staged yet.</div>
          ) : (
            <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]">
              {files.map((f) => (
                <div key={f.id} className="p-3 flex items-start justify-between gap-3" data-testid={`preview-file-${f.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{f.filename}</div>
                    {f.note && <div className="text-xs text-[var(--wz-text-tertiary)] truncate">{f.note}</div>}
                  </div>
                  <div className="text-[11px] font-mono-wz text-[var(--wz-text-tertiary)] shrink-0">
                    {fmtBytes(f.size_bytes)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 text-[11px] text-[var(--wz-text-tertiary)] flex items-start gap-2">
            <Lock size={11} className="shrink-0 mt-0.5" />
            <span>Documents are NDA-gated. They become downloadable once you sign in and accept your collaborator invitation.</span>
          </div>
        </div>

        {(listing.collaborators || []).length > 0 && (
          <div className="wz-card p-6 sm:p-8" data-testid="preview-collaborators">
            <div className="overline mb-3">Team on this listing</div>
            <div className="space-y-2">
              {listing.collaborators.map((c, i) => (
                <div key={i} className="text-sm flex items-center justify-between">
                  <span>{c.name}</span>
                  <span className="overline">{c.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {listing.access_policy?.require_principal_approval && (
          <div className="wz-card p-5 flex items-start gap-3" data-testid="preview-policy">
            <ShieldCheck size={18} className="text-[var(--wz-gold)] shrink-0 mt-0.5" />
            <div className="text-xs text-[var(--wz-text-secondary)] leading-relaxed">
              <strong>Principal approval is required</strong> for every buyer requesting Vault access on this listing.
              Even with their NDA in hand, no buyer reaches the full data room without your sign-off.
            </div>
          </div>
        )}

        <div className="text-center text-[11px] text-[var(--wz-text-tertiary)] py-6">
          <Clock size={11} className="inline mr-1" />
          Preview expires {new Date(preview.expires_at).toLocaleString()}.
          To get full access, accept your invitation email and{" "}
          <a href={marketingUrl("/login")} className="text-[var(--wz-gold)] hover:underline">sign in</a>.
        </div>
      </div>
    </div>
  );
}

function CenteredShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 grain">{children}</div>
  );
}

function PreviewMetric({ label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-3">
      <div className="overline mb-1">{label}</div>
      <div className="font-display text-xl tracking-tight">{value}</div>
    </div>
  );
}
