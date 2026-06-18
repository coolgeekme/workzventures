import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudArrowDown, ArrowSquareOut, ArrowsClockwise, Plug, X, Warning } from "@phosphor-icons/react";
import { api } from "../lib/api";

/**
 * ExternalSources — per-listing panel for connecting Composio-backed file
 * sources (Google Drive / OneDrive / SharePoint / Dropbox / Box / Zoho
 * WorkDrive). One seller-side OAuth, many readers.
 *
 *  Flow per source:
 *   1. Seller clicks Connect → backend creates a pending row and returns a
 *      Composio-hosted OAuth redirect URL.
 *   2. We open the URL in a new tab and start polling /poll every 4s.
 *   3. When status flips to "active", "Sync now" unlocks; clicking it pulls
 *      file metadata + bytes via Composio actions into the Listing Data Room.
 *   4. Files appear in the existing Vault list with a "via {Source}" badge.
 *      No additional OAuth for collabs/buyers.
 *
 *  Disconnect: revokes the connection on Composio and wipes mirrored bytes.
 *  Closing/deleting the listing triggers the same wipe automatically.
 */
export default function ExternalSources({ listingId, viewAsPrincipal = false }) {
  const [data, setData] = useState({ sources: [], supported: [] });
  const [loaded, setLoaded] = useState(false);
  const [picker, setPicker] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(null); // "connect" | sid | null
  const pollRefs = useRef({}); // sid -> interval handle

  const load = async () => {
    try {
      const r = await api.get(`/listings/${listingId}/external-sources`);
      setData(r.data || { sources: [], supported: [] });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load sources");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, [listingId]);

  // Start polling a pending source until it flips to active or we disconnect.
  const startPolling = (sid) => {
    if (pollRefs.current[sid]) return;
    const tick = async () => {
      try {
        const r = await api.post(`/listings/${listingId}/external-sources/${sid}/poll`);
        if (r.data?.status === "active") {
          clearInterval(pollRefs.current[sid]);
          delete pollRefs.current[sid];
          toast.success("Connected · ready to sync");
          await load();
        } else if (r.data?.status === "failed") {
          clearInterval(pollRefs.current[sid]);
          delete pollRefs.current[sid];
          toast.error("OAuth failed or revoked");
          await load();
        }
      } catch { /* swallow, will retry */ }
    };
    pollRefs.current[sid] = setInterval(tick, 4000);
    tick(); // kick once immediately
  };

  useEffect(() => () => {
    // Cleanup on unmount.
    Object.values(pollRefs.current).forEach(clearInterval);
    pollRefs.current = {};
  }, []);

  const connect = async () => {
    if (!picker) return;
    setBusy("connect");
    try {
      const r = await api.post(`/listings/${listingId}/external-sources`, {
        source_kind: picker, folder_id: folderId || null,
      });
      const src = r.data;
      toast.success(`Opened ${src.label} login in a new tab`, {
        description: "Complete the OAuth handshake — we'll detect it automatically.",
      });
      if (src.redirect_url) window.open(src.redirect_url, "_blank", "noopener,noreferrer");
      setPicker("");
      setFolderId("");
      await load();
      startPolling(src.id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Connection failed");
    } finally {
      setBusy(null);
    }
  };

  const reopenOAuth = (src) => {
    if (!src.redirect_url) {
      toast.error("No redirect URL stored — disconnect + reconnect.");
      return;
    }
    window.open(src.redirect_url, "_blank", "noopener,noreferrer");
    startPolling(src.id);
  };

  const sync = async (sid) => {
    setBusy(sid);
    try {
      const r = await api.post(`/listings/${listingId}/external-sources/${sid}/sync`);
      toast.success(`Pulled ${r.data?.pulled || 0} file${r.data?.pulled === 1 ? "" : "s"}`, {
        description: r.data?.errors?.length ? `${r.data.errors.length} errors — see panel.` : `${r.data?.total} total mirrored.`,
      });
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (src) => {
    if (!window.confirm(`Disconnect ${src.label}? All ${src.file_count} mirrored file(s) will be wiped from the Vault.`)) return;
    setBusy(src.id);
    try {
      await api.delete(`/listings/${listingId}/external-sources/${src.id}`);
      toast.success(`Disconnected · ${src.label}`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  // Auto-start polling for any source still pending on mount.
  useEffect(() => {
    if (!loaded) return;
    data.sources.forEach((s) => {
      if (s.status === "pending") startPolling(s.id);
    });
  }, [loaded, data.sources.map((s) => s.status).join(",")]);

  const unconnected = data.supported.filter(
    (s) => !data.sources.some((c) => c.source_kind === s.kind && c.status !== "failed"),
  );

  return (
    <div data-testid={`external-sources-${listingId}`} className="mt-6">
      <div className="overline mb-3 flex items-center gap-2">
        <Plug size={12} /> Connected file sources
      </div>
      <p className="text-xs text-[var(--wz-text-secondary)] mb-4 leading-relaxed">
        Link Google Drive, SharePoint, OneDrive, Dropbox, Box or Zoho WorkDrive once — files mirror into the Vault and collaborators / buyers see them without their own login. Disconnecting (or closing the listing) wipes every mirrored byte and revokes the OAuth grant.
      </p>

      {data.sources.length > 0 && (
        <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)] mb-4">
          {data.sources.map((s) => (
            <div key={s.id} data-testid={`source-${s.id}`} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  <span>{s.label}</span>
                  <span
                    className={`pill ${s.status === "active" ? "pill-positive" : s.status === "pending" ? "pill-amber" : "pill-amber"}`}
                    style={s.status === "failed" ? { color: "var(--wz-danger)", borderColor: "var(--wz-danger)" } : undefined}
                    data-testid={`source-status-${s.id}`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--wz-text-tertiary)] mt-0.5">
                  {s.file_count > 0 ? `${s.file_count} file${s.file_count === 1 ? "" : "s"} · ` : ""}
                  {s.last_sync_at ? `synced ${new Date(s.last_sync_at).toLocaleString()}` : "never synced"}
                  {s.folder_id ? ` · folder ${s.folder_id}` : ""}
                </div>
                {s.last_error && (
                  <div className="text-[10px] mt-1 text-[var(--wz-danger)] flex items-start gap-1">
                    <Warning size={10} className="mt-0.5 shrink-0" /> {s.last_error}
                  </div>
                )}
              </div>
              {!viewAsPrincipal && (
                <div className="flex items-center gap-2 shrink-0">
                  {s.status === "pending" && (
                    <button
                      onClick={() => reopenOAuth(s)}
                      data-testid={`source-reopen-${s.id}`}
                      className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] flex items-center gap-1"
                      title="Re-open the OAuth window"
                    >
                      <ArrowSquareOut size={12} /> Open OAuth
                    </button>
                  )}
                  {s.status === "active" && (
                    <button
                      onClick={() => sync(s.id)}
                      disabled={busy === s.id}
                      data-testid={`source-sync-${s.id}`}
                      className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] flex items-center gap-1 disabled:opacity-50"
                      title="Pull files into the Vault"
                    >
                      <ArrowsClockwise size={12} /> {busy === s.id ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                  <button
                    onClick={() => disconnect(s)}
                    disabled={busy === s.id}
                    data-testid={`source-disconnect-${s.id}`}
                    className="text-xs text-[var(--wz-danger)] hover:underline flex items-center gap-1 disabled:opacity-50"
                    title="Revoke OAuth + wipe mirrored bytes"
                  >
                    <X size={12} /> Disconnect
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!viewAsPrincipal && unconnected.length > 0 && (
        <div className="border border-dashed border-[var(--wz-border)] p-3">
          <div className="overline mb-2">Connect a new source</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              data-testid="source-picker"
              className="wz-input text-xs flex-1"
              value={picker}
              onChange={(e) => setPicker(e.target.value)}
            >
              <option value="">Choose a service…</option>
              {unconnected.map((s) => (
                <option key={s.kind} value={s.kind}>{s.label}</option>
              ))}
            </select>
            <input
              type="text"
              data-testid="source-folder-id"
              className="wz-input text-xs flex-1"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              placeholder="Folder ID / path (optional · leave blank for root)"
              title="If you want to scope the mirror to one folder, paste its ID. Leave blank to mirror your drive root."
            />
            <button
              onClick={connect}
              disabled={!picker || busy === "connect"}
              data-testid="source-connect"
              className="wz-btn wz-btn-gold text-xs flex items-center gap-2 disabled:opacity-50"
            >
              <CloudArrowDown size={12} /> {busy === "connect" ? "Opening…" : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
