import { useState, useRef } from "react";
import { toast } from "sonner";
import { Lock, X } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { UPLOAD_ACCEPT, UPLOAD_HINT, UPLOAD_MAX_MB } from "../lib/uploadConfig";

const FOLDERS = [
  { id: "notes", label: "Notes" },
  { id: "modeling", label: "Modeling" },
  { id: "memos", label: "Memos" },
  { id: "external", label: "External reports" },
  { id: "other", label: "Other" },
];

export default function PrivateLockerUploadModal({ listings, defaultListingId, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [listingId, setListingId] = useState(defaultListingId || "");
  const [folder, setFolder] = useState("memos");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error("Choose a file"); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (listingId) fd.append("listing_id", listingId);
      fd.append("folder", folder);
      if (note) fd.append("note", note);
      const r = await api.post("/private-locker/files", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div
      data-testid="locker-upload-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="wz-card w-full max-w-md p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-[var(--wz-gold)]" />
            <h2 className="font-display text-lg">Upload to private locker</h2>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]">
            <X size={16} />
          </button>
        </div>

        <div className="text-[10px] text-[var(--wz-text-tertiary)] mb-3 leading-relaxed">
          Only you will be able to access this file. Encrypted at rest with AES-256-GCM.
        </div>

        <label className="block text-xs text-[var(--wz-text-secondary)] mb-1.5">File <span className="text-[var(--wz-text-tertiary)]">· {UPLOAD_HINT} · ≤ {UPLOAD_MAX_MB} MB</span></label>
        <input
          ref={inputRef}
          data-testid="locker-file-input"
          type="file"
          accept={UPLOAD_ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-xs text-[var(--wz-text)] file:mr-3 file:py-1.5 file:px-3 file:border-0 file:bg-[var(--wz-surface-2)] file:text-[var(--wz-text)] file:text-xs file:cursor-pointer cursor-pointer mb-4"
        />

        <label className="block text-xs text-[var(--wz-text-secondary)] mb-1.5">Attach to listing (optional)</label>
        <select
          data-testid="locker-listing-select"
          value={listingId}
          onChange={(e) => setListingId(e.target.value)}
          className="wz-input w-full text-xs mb-4"
        >
          <option value="">Workspace — not tied to any listing</option>
          {listings.map((li) => (
            <option key={li.id} value={li.id}>{li.company_name || li.name || li.id}</option>
          ))}
        </select>

        <label className="block text-xs text-[var(--wz-text-secondary)] mb-1.5">Folder</label>
        <select
          data-testid="locker-folder-select"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          className="wz-input w-full text-xs mb-4"
        >
          {FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>

        <label className="block text-xs text-[var(--wz-text-secondary)] mb-1.5">Note (optional)</label>
        <textarea
          data-testid="locker-note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="wz-input w-full text-xs mb-4 resize-none"
          placeholder="Why this file matters, who shared it, key takeaway…"
        />

        <div className="flex items-center justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button
            data-testid="locker-submit-btn"
            type="submit"
            disabled={submitting || !file}
            className="wz-btn wz-btn-gold text-xs disabled:opacity-50"
          >
            {submitting ? "Encrypting…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
