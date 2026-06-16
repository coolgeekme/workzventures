import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, LinkSimple, Trash, Clock, Eye, Plus, X } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { marketingUrl } from "../lib/hostRouting";

/**
 * Modal for managing public preview links on a single listing.
 *
 *  - Agent generates a short-lived signed link (1h - 30d expiry)
 *  - Each link has a label so the agent remembers who they sent it to
 *  - Active links are listed with their view count + expiry + revoke action
 *  - Backend issues the URL using FRONTEND_URL; we re-derive it on the
 *    client via marketingUrl() so the link always points at the apex
 *    (nextcapos.com) regardless of which host the agent is on.
 */
export default function ShareLinkModal({ listingId, listingName, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [expiresHours, setExpiresHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [justCreatedToken, setJustCreatedToken] = useState(null); // show the URL once
  const [justCreatedUrl, setJustCreatedUrl] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/listings/${listingId}/preview-links`);
      setLinks(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load links");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [listingId]); // eslint-disable-line

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/listings/${listingId}/preview-links`, {
        label: label.trim() || undefined,
        expires_hours: Number(expiresHours),
      });
      const clientUrl = marketingUrl(`/preview/listing/${r.data.token}`);
      setJustCreatedToken(r.data.token);
      setJustCreatedUrl(clientUrl);
      if (navigator.clipboard) navigator.clipboard.writeText(clientUrl).catch(() => {});
      toast.success("Preview link created and copied to clipboard");
      setLabel("");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create link");
    }
    setBusy(false);
  };

  const revoke = async (plid) => {
    if (!window.confirm("Revoke this link? The principal will no longer be able to view it.")) return;
    try {
      await api.delete(`/listings/${listingId}/preview-links/${plid}`);
      toast.success("Link revoked");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Revoke failed");
    }
  };

  const copy = (url) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied")).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" data-testid="share-link-modal">
      <div className="wz-card max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 sm:p-7 relative">
        <button
          onClick={onClose}
          data-testid="share-link-close"
          className="absolute top-3 right-3 text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]"
        >
          <X size={18} />
        </button>

        <div className="overline mb-1">Public preview links</div>
        <h2 className="font-display text-2xl tracking-tighter mb-2">{listingName}</h2>
        <p className="text-sm text-[var(--wz-text-secondary)] leading-relaxed">
          Share a no-login link with the principal so they can see exactly what their
          listing looks like before they accept your invite. Links are signed, revocable,
          and expire automatically. They show listing metadata + the data-room file list
          (read-only — no downloads).
        </p>

        {justCreatedUrl && (
          <div className="mt-5 p-4 border border-[var(--wz-gold)] bg-[var(--wz-gold)]/10" data-testid="just-created-link">
            <div className="overline mb-2 text-[var(--wz-gold)]">Just created — share this URL</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={justCreatedUrl}
                onFocus={(e) => e.target.select()}
                className="wz-input font-mono-wz text-xs flex-1"
                data-testid="just-created-url"
              />
              <button
                onClick={() => copy(justCreatedUrl)}
                className="wz-btn wz-btn-ghost flex items-center gap-2 text-xs"
                data-testid="just-created-copy"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-2">
              This URL is shown once. After you close the modal you can still see it
              by token in the list below — but the safe copy moment is now.
            </div>
          </div>
        )}

        <form onSubmit={create} className="mt-6 space-y-3" data-testid="create-link-form">
          <div className="overline">Generate a new link</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              data-testid="create-link-label"
              type="text"
              placeholder="Label (optional, e.g. 'For John')"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="wz-input sm:col-span-2"
            />
            <select
              data-testid="create-link-expiry"
              value={expiresHours}
              onChange={(e) => setExpiresHours(e.target.value)}
              className="wz-input"
            >
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
              <option value={336}>14 days</option>
              <option value={720}>30 days</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            data-testid="create-link-submit"
            className="wz-btn wz-btn-gold inline-flex items-center gap-2"
          >
            <Plus size={14} /> {busy ? "Generating…" : "Generate link"}
          </button>
        </form>

        <div className="mt-7">
          <div className="overline mb-3">Active links · {links.length}</div>
          {loading ? (
            <div className="text-xs text-[var(--wz-text-tertiary)]">Loading…</div>
          ) : links.length === 0 ? (
            <div className="text-xs text-[var(--wz-text-tertiary)]">No active links.</div>
          ) : (
            <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]" data-testid="active-links">
              {links.map((l) => {
                const expired = l.is_expired;
                return (
                  <div key={l.id} className="p-3" data-testid={`active-link-${l.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{l.label || "(unlabeled)"}</div>
                        <div className="text-xs text-[var(--wz-text-tertiary)] flex flex-wrap gap-x-3 gap-y-1 mt-1">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={10} /> {expired ? "Expired " : "Expires "} {new Date(l.expires_at).toLocaleString()}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Eye size={10} /> {l.view_count} view{l.view_count === 1 ? "" : "s"}
                          </span>
                          {l.last_viewed_at && (
                            <span>Last seen {new Date(l.last_viewed_at).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => copy(l.url)}
                          disabled={expired}
                          title="Copy link"
                          data-testid={`active-link-copy-${l.id}`}
                          className="text-xs text-[var(--wz-gold)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <LinkSimple size={12} /> Copy
                        </button>
                        <button
                          onClick={() => revoke(l.id)}
                          title="Revoke"
                          data-testid={`active-link-revoke-${l.id}`}
                          className="text-xs text-[var(--wz-danger)] hover:underline inline-flex items-center gap-1"
                        >
                          <Trash size={12} /> Revoke
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
