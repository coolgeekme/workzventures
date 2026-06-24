import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FolderOpen, ArrowsCounterClockwise, ArrowLeft, House, Check, Warning, X,
} from "@phosphor-icons/react";
import { api } from "../lib/api";

/**
 * FolderPickerModal — Finder-style folder picker for external sources.
 *
 * One modal handles all 5 providers because the backend's /browse endpoint
 * normalizes their responses to {folders: [{id, name}], parent_id, can_browse, err}.
 *
 * Multi-select: seller checks every folder they want mirrored. The list of
 * checked IDs + their breadcrumb-style labels is sent to PATCH /folders.
 *
 * Include-subfolders: persisted alongside the selection so the sync code
 * knows whether to BFS into nested folders (Box/Drive/OneDrive) or pass
 * `recursive=true` natively (Dropbox).
 */
export default function FolderPickerModal({
  open, onClose, listingId, sid, sourceKind, providerLabel,
  initialFolderIds = [], initialFolderLabels = [],
  initialIncludeSubfolders = true,
  onSaved,
}) {
  // Navigation state
  const [stack, setStack] = useState([{ id: null, name: providerLabel || "Root" }]);
  const [folders, setFolders] = useState([]);
  const [canBrowse, setCanBrowse] = useState(true);
  const [browseErr, setBrowseErr] = useState(null);
  const [loading, setLoading] = useState(false);

  // Selection state (multi-select). Map of id → label so we can render and
  // round-trip labels back to the backend without re-resolving them.
  const [selected, setSelected] = useState(() => {
    const m = {};
    initialFolderIds.forEach((id, i) => {
      m[id] = initialFolderLabels?.[i] || id;
    });
    return m;
  });
  const [includeSubfolders, setIncludeSubfolders] = useState(initialIncludeSubfolders);
  const [saving, setSaving] = useState(false);
  // For SharePoint / unsupported providers, fall back to manual ID entry.
  const [manualId, setManualId] = useState("");

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setStack([{ id: null, name: providerLabel || "Root" }]);
    setBrowseErr(null);
    const m = {};
    initialFolderIds.forEach((id, i) => {
      m[id] = initialFolderLabels?.[i] || id;
    });
    setSelected(m);
    setIncludeSubfolders(initialIncludeSubfolders);
    setManualId("");
    fetchAt(null);
  }, [open, sid, sourceKind]);  // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAt = async (parentId) => {
    setLoading(true);
    setBrowseErr(null);
    try {
      const r = await api.get(
        `/listings/${listingId}/external-sources/${sid}/browse`,
        { params: parentId !== null && parentId !== undefined ? { parent_id: parentId } : {} },
      );
      const body = r.data || {};
      setCanBrowse(!!body.can_browse);
      setFolders(Array.isArray(body.folders) ? body.folders : []);
      setBrowseErr(body.err || null);
    } catch (err) {
      setBrowseErr(err?.response?.data?.detail || "Failed to load folders");
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const navigateInto = (folder) => {
    setStack((s) => [...s, folder]);
    fetchAt(folder.id);
  };

  const goUp = () => {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    fetchAt(next[next.length - 1].id);
  };

  const jumpTo = (idx) => {
    const next = stack.slice(0, idx + 1);
    setStack(next);
    fetchAt(next[next.length - 1].id);
  };

  // Toggle a folder's selection. The label encodes the full breadcrumb path
  // so the source-row shows "Marketing / Q4 Reports" rather than a bare ID.
  const toggleFolder = (folder) => {
    const breadcrumbLabel = [
      ...stack.slice(1).map((s) => s.name),
      folder.name,
    ].join(" / ") || folder.name;
    setSelected((curr) => {
      const next = { ...curr };
      if (next[folder.id]) {
        delete next[folder.id];
      } else {
        next[folder.id] = breadcrumbLabel;
      }
      return next;
    });
  };

  // Quick-add "this folder" — selects whatever level the user is currently
  // viewing. Useful when the seller has already navigated to the right
  // place and doesn't need to scroll further.
  const selectCurrent = () => {
    const here = stack[stack.length - 1];
    if (!here.id) {
      toast.info("Tip: select the provider root by leaving the selection empty — it'll sync everything.");
      return;
    }
    const breadcrumbLabel = stack.slice(1).map((s) => s.name).join(" / ") || here.name;
    setSelected((curr) => ({ ...curr, [here.id]: breadcrumbLabel }));
  };

  const addManualId = () => {
    const id = manualId.trim();
    if (!id) return;
    setSelected((curr) => ({ ...curr, [id]: `Folder ${id}` }));
    setManualId("");
  };

  const removeSelected = (id) => {
    setSelected((curr) => {
      const n = { ...curr }; delete n[id]; return n;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const ids = Object.keys(selected);
      const labels = ids.map((id) => selected[id]);
      await api.patch(`/listings/${listingId}/external-sources/${sid}/folders`, {
        folder_ids: ids,
        folder_labels: labels,
        include_subfolders: includeSubfolders,
      });
      toast.success("Folder selection saved · sync starting…", {
        description: ids.length
          ? `Mirroring ${ids.length} folder${ids.length === 1 ? "" : "s"}${includeSubfolders ? " (incl. subfolders)" : ""}`
          : "Mirroring the root of the connected drive.",
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save folder selection");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const selectedCount = Object.keys(selected).length;
  const here = stack[stack.length - 1];

  return (
    <div
      data-testid="folder-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-[var(--wz-bg)] border border-[var(--wz-border)] w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="border-b border-[var(--wz-border)] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="overline">Pick folders to mirror</div>
            <div className="text-sm font-medium mt-0.5">
              {providerLabel || sourceKind}
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="folder-picker-close"
            className="text-[var(--wz-text-secondary)] hover:text-[var(--wz-fg)]"
            aria-label="Close folder picker"
          >
            <X size={18} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="border-b border-[var(--wz-border)] px-5 py-2 flex items-center gap-1 text-xs overflow-x-auto">
          <button
            onClick={goUp}
            disabled={stack.length <= 1}
            data-testid="folder-picker-back"
            className="p-1 hover:bg-[var(--wz-surface)] disabled:opacity-30 mr-1"
            title="Go up one level"
          >
            <ArrowLeft size={14} />
          </button>
          {stack.map((s, i) => (
            <div key={`${s.id}-${i}`} className="flex items-center gap-1 shrink-0">
              {i === 0 && <House size={12} className="opacity-50" />}
              <button
                onClick={() => jumpTo(i)}
                className={`hover:text-[var(--wz-gold)] ${i === stack.length - 1 ? "text-[var(--wz-fg)] font-medium" : "text-[var(--wz-text-secondary)]"}`}
              >
                {s.name}
              </button>
              {i < stack.length - 1 && <span className="text-[var(--wz-text-tertiary)]">/</span>}
            </div>
          ))}
          {loading && (
            <ArrowsCounterClockwise size={12} className="animate-spin opacity-50 ml-auto" />
          )}
        </div>

        {/* Folder list — or manual fallback */}
        <div className="flex-1 overflow-y-auto" data-testid="folder-picker-list">
          {browseErr && (
            <div className="m-4 p-3 border border-[var(--wz-border)] text-xs text-[var(--wz-text-secondary)] flex items-start gap-2">
              <Warning size={14} className="shrink-0 mt-0.5 text-[var(--wz-danger)]" />
              <div>{browseErr}</div>
            </div>
          )}
          {!canBrowse && (
            <div className="p-5 space-y-3">
              <div>
                Browsing isn&apos;t available for {providerLabel}. Paste the folder
                ID manually instead — you can find it in the URL when you open
                the folder in {providerLabel}&apos;s web UI.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="Paste folder ID"
                  className="wz-input text-xs flex-1"
                  data-testid="folder-picker-manual-id"
                />
                <button
                  onClick={addManualId}
                  className="wz-btn wz-btn-secondary text-xs"
                  data-testid="folder-picker-manual-add"
                >Add</button>
              </div>
            </div>
          )}
          {canBrowse && !loading && folders.length === 0 && !browseErr && (
            <div className="p-8 text-center text-xs text-[var(--wz-text-secondary)]">
              No subfolders here. Use &ldquo;Select this folder&rdquo; below to mirror this level.
            </div>
          )}
          {canBrowse && folders.length > 0 && (
            <div className="divide-y divide-[var(--wz-border)]">
              {folders.map((f) => {
                const checked = !!selected[f.id];
                return (
                  <div
                    key={f.id}
                    data-testid={`folder-row-${f.id}`}
                    className="px-5 py-2.5 flex items-center gap-3 hover:bg-[var(--wz-surface)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFolder(f)}
                      className="cursor-pointer"
                      data-testid={`folder-checkbox-${f.id}`}
                      aria-label={`Select ${f.name}`}
                    />
                    <button
                      onClick={() => navigateInto(f)}
                      className="flex-1 flex items-center gap-2 text-left text-sm hover:text-[var(--wz-gold)]"
                      data-testid={`folder-open-${f.id}`}
                    >
                      <FolderOpen size={14} className="text-[var(--wz-text-secondary)] shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selection summary + controls */}
        <div className="border-t border-[var(--wz-border)] px-5 py-3 space-y-3 bg-[var(--wz-surface)]">
          {canBrowse && here.id && (
            <button
              onClick={selectCurrent}
              className="text-xs text-[var(--wz-gold)] hover:underline flex items-center gap-1"
              data-testid="folder-picker-select-current"
            >
              <Check size={12} /> Select this folder (“{here.name}”)
            </button>
          )}

          {selectedCount > 0 && (
            <div className="space-y-1">
              <div className="overline text-[10px]">Selected ({selectedCount})</div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto" data-testid="folder-picker-selected">
                {Object.entries(selected).map(([id, label]) => (
                  <span
                    key={id}
                    className="pill pill-positive text-[10px] flex items-center gap-1 max-w-full"
                    data-testid={`selected-pill-${id}`}
                  >
                    <span className="truncate max-w-[260px]" title={label}>{label}</span>
                    <button
                      onClick={() => removeSelected(id)}
                      className="hover:text-[var(--wz-danger)]"
                      aria-label={`Remove ${label}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => setIncludeSubfolders(e.target.checked)}
              data-testid="folder-picker-include-subfolders"
            />
            Include subfolders (recurse up to 4 levels deep)
          </label>

          <div className="flex items-center justify-between pt-1">
            <div className="text-[10px] text-[var(--wz-text-tertiary)]">
              {selectedCount === 0
                ? "Save with no selection → mirrors the entire drive root."
                : `Will mirror ${selectedCount} folder${selectedCount === 1 ? "" : "s"}.`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="wz-btn wz-btn-secondary text-xs"
                data-testid="folder-picker-cancel"
              >Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="wz-btn wz-btn-gold text-xs"
                data-testid="folder-picker-save"
              >
                {saving ? "Saving…" : "Save & Sync"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
