import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Lock, Upload, Trash, DownloadSimple, Buildings, FolderSimple,
  ShieldCheck, Files, FileText, MagnifyingGlass,
} from "@phosphor-icons/react";
import { api, API } from "../lib/api";
import PrivateLockerUploadModal from "../components/PrivateLockerUploadModal";

function bytesFmt(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PrivateLocker() {
  const [files, setFiles] = useState([]);
  const [listings, setListings] = useState([]);
  const [scope, setScope] = useState("all"); // all | workspace | listing | research
  const [listingFilter, setListingFilter] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = async () => {
    try {
      const params = {};
      if (scope === "workspace") params.scope = "workspace";
      else if (scope === "listing" && listingFilter) params.listing_id = listingFilter;
      else if (scope === "listing") params.scope = "listing";
      else if (scope === "research") params.scope = "research";
      const r = await api.get("/private-locker/files", { params });
      setFiles(r.data || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load locker");
    }
  };

  const loadListings = async () => {
    try {
      const r = await api.get("/marketplace");
      setListings(r.data || []);
    } catch { /* silent */ }
  };

  useEffect(() => { loadListings(); load(); }, [scope, listingFilter]); // eslint-disable-line

  const deleteFile = async (fid) => {
    if (!window.confirm("Delete this file permanently?")) return;
    try {
      await api.delete(`/private-locker/files/${fid}`);
      setFiles((arr) => arr.filter((f) => f.id !== fid));
      toast.success("File removed");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  const download = async (f) => {
    try {
      const token = localStorage.getItem("wz_token");
      const res = await fetch(`${API}/private-locker/files/${f.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Download failed");
    }
  };

  const workspaceCount = useMemo(() => files.filter(f => f.scope === "workspace").length, [files]);
  const listingCount = useMemo(() => files.filter(f => f.scope === "listing").length, [files]);
  const researchCount = useMemo(() => files.filter(f => f.scope === "research").length, [files]);

  return (
    <div data-testid="private-locker-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto w-full">
      <div className="overline mb-3" style={{ color: "var(--wz-gold)" }}>Buyer-only · invisible to sellers</div>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-2">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
            <Lock size={26} className="text-[var(--wz-gold)]" />
            Private Locker
          </h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
            Your encrypted, buyer-only document drawer. Board memos, internal models, partner
            scoring sheets, third-party reports — store anything you don&apos;t want the seller to see.
          </p>
        </div>
        <button
          data-testid="locker-upload-btn"
          onClick={() => setUploadOpen(true)}
          className="wz-btn wz-btn-gold"
        >
          <Upload size={14} /> Upload file
        </button>
      </div>

      {/* Privacy assurance card */}
      <div
        data-testid="locker-privacy-banner"
        className="wz-card border-l-2 border-l-[var(--wz-gold)] mt-5 flex items-start gap-3 px-4 py-3"
      >
        <ShieldCheck size={18} className="text-[var(--wz-gold)] mt-0.5 shrink-0" />
        <div className="text-xs text-[var(--wz-text-secondary)] leading-relaxed">
          <span className="text-[var(--wz-text)] font-medium">Strictly private.</span>{" "}
          Files are AES-256-GCM encrypted at rest and OpenTimestamps-anchored. Only you can list,
          download, or delete them. Sellers, other buyers, and Workz operators cannot view this
          drawer. Server-side RBAC blocks all non-owner access at the API layer.
        </div>
      </div>

      {/* Filter strip */}
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <button
          data-testid="filter-all"
          onClick={() => { setScope("all"); setListingFilter(""); }}
          className={`text-xs px-3 py-1.5 border ${scope === "all" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          All ({files.length})
        </button>
        <button
          data-testid="filter-workspace"
          onClick={() => { setScope("workspace"); setListingFilter(""); }}
          className={`text-xs px-3 py-1.5 border flex items-center gap-1.5 ${scope === "workspace" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          <Files size={12} /> Workspace ({workspaceCount})
        </button>
        <button
          data-testid="filter-listing"
          onClick={() => setScope("listing")}
          className={`text-xs px-3 py-1.5 border flex items-center gap-1.5 ${scope === "listing" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          <Buildings size={12} /> Per-listing ({listingCount})
        </button>
        <button
          data-testid="filter-research"
          onClick={() => { setScope("research"); setListingFilter(""); }}
          className={`text-xs px-3 py-1.5 border flex items-center gap-1.5 ${scope === "research" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          <MagnifyingGlass size={12} /> Research targets ({researchCount})
        </button>
        {scope === "listing" && (
          <select
            data-testid="listing-filter-select"
            value={listingFilter}
            onChange={(e) => setListingFilter(e.target.value)}
            className="wz-input text-xs py-1.5 ml-1 min-w-[200px]"
          >
            <option value="">Any listing…</option>
            {listings.map((li) => (
              <option key={li.id} value={li.id}>{li.company_name || li.name || li.id}</option>
            ))}
          </select>
        )}
      </div>

      {/* File table */}
      <div className="wz-card mt-4 p-0 overflow-hidden">
        {files.length === 0 ? (
          <div data-testid="locker-empty" className="px-5 py-12 text-center">
            <FolderSimple size={28} className="text-[var(--wz-text-tertiary)] mx-auto mb-3" />
            <div className="text-sm text-[var(--wz-text-secondary)]">No files yet</div>
            <div className="text-xs text-[var(--wz-text-tertiary)] mt-1">
              Drop your internal DD docs here — sellers will never see them.
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-[var(--wz-surface-2)] text-[var(--wz-text-tertiary)] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-normal">File</th>
                <th className="text-left px-4 py-2.5 font-normal">Scope</th>
                <th className="text-left px-4 py-2.5 font-normal">Folder</th>
                <th className="text-left px-4 py-2.5 font-normal">Size</th>
                <th className="text-left px-4 py-2.5 font-normal">Note</th>
                <th className="text-right px-4 py-2.5 font-normal w-[1%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr
                  key={f.id}
                  data-testid={`locker-row-${f.id}`}
                  className="border-t border-[var(--wz-border)] hover:bg-[var(--wz-surface-hover)]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-[var(--wz-gold)] shrink-0" />
                      <div className="font-medium text-[var(--wz-text)] truncate max-w-[280px]">{f.filename}</div>
                    </div>
                    <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-0.5 flex items-center gap-2">
                      {f.encrypted && <span>AES-256-GCM</span>}
                      <span>·</span>
                      <span title={f.sha256_hex}>sha256:{(f.sha256_hex || "").slice(0, 10)}…</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {f.scope === "listing" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[var(--wz-border)] text-[10px]">
                        <Buildings size={10} /> {f.listing_name || f.listing_id?.slice(0, 8)}
                      </span>
                    ) : f.scope === "research" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[var(--wz-gold)]/50 text-[10px] text-[var(--wz-gold)]">
                        <MagnifyingGlass size={10} /> {f.research_company_name || "Research target"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[var(--wz-border)] text-[10px]">
                        <Files size={10} /> Workspace
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--wz-text-secondary)] capitalize">{f.folder}</td>
                  <td className="px-4 py-3 text-[var(--wz-text-secondary)]">{bytesFmt(f.size_bytes)}</td>
                  <td className="px-4 py-3 text-[var(--wz-text-secondary)] max-w-[280px] truncate">{f.note || "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      data-testid={`download-${f.id}`}
                      onClick={() => download(f)}
                      className="wz-btn wz-btn-ghost text-[11px] mr-1"
                      title="Download"
                    >
                      <DownloadSimple size={12} />
                    </button>
                    <button
                      data-testid={`delete-${f.id}`}
                      onClick={() => deleteFile(f.id)}
                      className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-rose)]"
                      title="Delete"
                    >
                      <Trash size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {uploadOpen && (
        <PrivateLockerUploadModal
          listings={listings}
          defaultListingId={scope === "listing" ? listingFilter : ""}
          onClose={() => setUploadOpen(false)}
          onUploaded={(doc) => {
            setFiles((arr) => [doc, ...arr]);
            toast.success("Uploaded to private locker");
            setUploadOpen(false);
          }}
        />
      )}
    </div>
  );
}

