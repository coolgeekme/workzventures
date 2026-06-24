import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudArrowDown, ArrowSquareOut, ArrowsClockwise, Plug, X, Warning, FolderOpen } from "@phosphor-icons/react";
import { api } from "../lib/api";
import FolderPickerModal from "./FolderPickerModal";

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
  const [busy, setBusy] = useState(null); // "connect" | sid | null
  const [folderPicker, setFolderPicker] = useState(null); // {sid, sourceKind, label, ids, labels, includeSubfolders} | null
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
        source_kind: picker,
      });
      const src = r.data;
      if (src.oauth_not_configured) {
        // Composio couldn't initiate a real OAuth handshake — either the
        // project doesn't have an auth_config for this toolkit, OR the API
        // key is read-only. The backend's last_error has the precise fix.
        toast.warning(`${src.label} not configured in Composio`, {
          description: src.last_error || "Open dashboard.composio.dev → Auth Configs → New, set up this toolkit, then retry.",
          duration: 15000,
        });
      } else {
        toast.success(`Opened ${src.label} login in a new tab`, {
          description: "Complete the OAuth handshake — we'll detect it and prompt you to pick folders.",
        });
        if (src.redirect_url) window.open(src.redirect_url, "_blank", "noopener,noreferrer");
      }
      setPicker("");
      await load();
      if (!src.oauth_not_configured) startPolling(src.id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Connection failed");
    } finally {
      setBusy(null);
    }
  };

  // Open the folder picker for one source. Works for both brand-new
  // connections (no folders selected yet) and existing ones (user wants to
  // change which folders mirror).
  const openFolderPicker = (src) => {
    setFolderPicker({
      sid: src.id,
      sourceKind: src.source_kind,
      label: src.label,
      ids: src.folder_ids || (src.folder_id ? [src.folder_id] : []),
      labels: src.folder_labels || (src.folder_id ? [src.folder_id] : []),
      includeSubfolders: src.include_subfolders !== false,
    });
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
      if (r.data?.started) {
        toast.info("Sync started in the background", {
          description: "We'll keep pulling files. Stay on this page to watch the counter, or come back later.",
        });
        // Start polling — sync runs detached in the backend, so we follow
        // along via /external-sources GET (which reflects file_count + syncing).
        startSyncPolling(sid);
      } else {
        toast.success(`Pulled ${r.data?.pulled || 0} file${r.data?.pulled === 1 ? "" : "s"}`, {
          description: r.data?.errors?.length ? `${r.data.errors.length} errors — see panel.` : `${r.data?.total} total mirrored.`,
        });
        await load();
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  // Poll the sources list every 3s while a sync is in flight. Stops when the
  // backend flips `syncing` back to false.
  const startSyncPolling = (sid) => {
    if (pollRefs.current[`sync-${sid}`]) return;
    const tick = async () => {
      try {
        const r = await api.get(`/listings/${listingId}/external-sources`);
        const src = (r.data?.sources || []).find((s) => s.id === sid);
        setData((d) => ({ ...d, sources: r.data?.sources || d.sources }));
        if (!src || !src.syncing) {
          clearInterval(pollRefs.current[`sync-${sid}`]);
          delete pollRefs.current[`sync-${sid}`];
          if (src?.last_error) {
            toast.error("Sync completed with errors", { description: src.last_error });
          } else if (src) {
            toast.success(`Sync complete · ${src.file_count} file${src.file_count === 1 ? "" : "s"} mirrored`);
          }
        }
      } catch { /* retry next tick */ }
    };
    pollRefs.current[`sync-${sid}`] = setInterval(tick, 3000);
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
      // Resume sync polling if the user navigated away mid-sync and came back.
      if (s.syncing) startSyncPolling(s.id);
    });
  }, [loaded, data.sources.map((s) => `${s.status}:${s.syncing}`).join(",")]);

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
                </div>
                {/* Selected-folder summary. New multi-folder model first;
                   fall back to the legacy single folder_id for older
                   connections that haven't been re-picked yet. */}
                {((s.folder_labels?.length || s.folder_ids?.length || s.folder_id) && s.status === "active") ? (
                  <div className="text-[10px] mt-1 text-[var(--wz-text-secondary)] flex items-start gap-1 flex-wrap" data-testid={`source-folders-${s.id}`}>
                    <FolderOpen size={10} className="mt-0.5 shrink-0 opacity-60" />
                    {(s.folder_labels?.length ? s.folder_labels : (s.folder_ids?.length ? s.folder_ids : [s.folder_id])).slice(0, 4).map((lbl, i) => (
                      <span key={i} className="pill text-[10px]" style={{ background: "transparent", borderColor: "var(--wz-border)" }}>{lbl}</span>
                    ))}
                    {(s.folder_labels?.length || s.folder_ids?.length || 0) > 4 && (
                      <span className="pill text-[10px]" style={{ background: "transparent", borderColor: "var(--wz-border)" }}>
                        +{(s.folder_labels?.length || s.folder_ids?.length) - 4} more
                      </span>
                    )}
                    {s.include_subfolders === false ? (
                      <span className="text-[10px] opacity-60">(top-level only)</span>
                    ) : (
                      <span className="text-[10px] opacity-60">(incl. subfolders)</span>
                    )}
                  </div>
                ) : null}
                {s.last_error && (
                  <div className="text-[10px] mt-1 text-[var(--wz-danger)] flex items-start gap-1 break-all">
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
                      onClick={() => openFolderPicker(s)}
                      data-testid={`source-pick-folders-${s.id}`}
                      className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] flex items-center gap-1"
                      title="Choose which folders to mirror"
                    >
                      <FolderOpen size={12} />
                      {(s.folder_ids?.length || s.folder_id) ? "Edit folders" : "Pick folders"}
                    </button>
                  )}
                  {s.status === "active" && (
                    <button
                      onClick={() => sync(s.id)}
                      disabled={busy === s.id || s.syncing}
                      data-testid={`source-sync-${s.id}`}
                      className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] flex items-center gap-1 disabled:opacity-50"
                      title="Pull files into the Vault"
                    >
                      <ArrowsClockwise size={12} className={s.syncing ? "animate-spin" : ""} />
                      {s.syncing ? `Syncing… (${s.file_count})` : busy === s.id ? "Starting…" : "Sync now"}
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
            <button
              onClick={connect}
              disabled={!picker || busy === "connect"}
              data-testid="source-connect"
              className="wz-btn wz-btn-gold text-xs flex items-center gap-2 disabled:opacity-50"
            >
              <CloudArrowDown size={12} /> {busy === "connect" ? "Opening…" : "Connect"}
            </button>
          </div>
          <p className="text-[10px] text-[var(--wz-text-tertiary)] mt-2">
            After you sign in, you'll be prompted to pick which folder(s) to mirror — no folder IDs or paths to copy.
          </p>
        </div>
      )}

      {folderPicker && (
        <FolderPickerModal
          open
          listingId={listingId}
          sid={folderPicker.sid}
          sourceKind={folderPicker.sourceKind}
          providerLabel={folderPicker.label}
          initialFolderIds={folderPicker.ids}
          initialFolderLabels={folderPicker.labels}
          initialIncludeSubfolders={folderPicker.includeSubfolders}
          onClose={() => setFolderPicker(null)}
          onSaved={async () => {
            await load();
            startSyncPolling(folderPicker.sid);
          }}
        />
      )}
    </div>
  );
}
