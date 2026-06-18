import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Plus, Tag, Trash, Files, CaretDown, CaretUp, CloudArrowUp, DownloadSimple, X, UsersThree, Eye, EyeSlash, ShareNetwork, Buildings, Vault } from "@phosphor-icons/react";
import ExternalSources from "../components/ExternalSources";
import { UPLOAD_ACCEPT, UPLOAD_HINT, UPLOAD_MAX_MB } from "../lib/uploadConfig";
import ListingCollaborators from "../components/ListingCollaborators";
import ShareLinkModal from "../components/ShareLinkModal";

const STATUSES = [
  { v: "draft", l: "Draft" },
  { v: "live", l: "Live" },
  { v: "under_loi", l: "Under LOI" },
  { v: "closed", l: "Closed" },
];

const emptyForm = {
  company_name: "", sector: "", geography: "", asking_price_usd_m: 0,
  revenue_usd_m: 0, ebitda_usd_m: 0, employees: 0,
  headline: "", summary: "", highlights: "", status: "draft",
};

export default function MyListings() {
  const { user } = useAuth();
  const isCollabOnly = user?.account_scope === "collaborator";
  const [listings, setListings] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [scopeFilter, setScopeFilter] = useState("all"); // all | mine | org | shared

  const load = () => api.get("/listings").then((r) => setListings(r.data));
  useEffect(() => { load(); }, []);

  const filteredListings = scopeFilter === "all"
    ? listings
    : listings.filter((l) => (l.workspace_scope || "mine") === scopeFilter);
  const counts = listings.reduce((acc, l) => {
    const s = l.workspace_scope || "mine";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        ...form,
        asking_price_usd_m: Number(form.asking_price_usd_m),
        revenue_usd_m: Number(form.revenue_usd_m) || null,
        ebitda_usd_m: Number(form.ebitda_usd_m) || null,
        employees: Number(form.employees) || null,
        highlights: form.highlights.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      await api.post("/listings", body);
      toast.success("Listing created");
      setForm(emptyForm);
      setShow(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const setStatus = async (l, status) => {
    try {
      await api.patch(`/listings/${l.id}`, {
        company_name: l.company_name, sector: l.sector, geography: l.geography,
        asking_price_usd_m: l.asking_price_usd_m, revenue_usd_m: l.revenue_usd_m,
        ebitda_usd_m: l.ebitda_usd_m, employees: l.employees,
        headline: l.headline, summary: l.summary, highlights: l.highlights || [],
        status,
      });
      toast.success(`${l.company_name} → ${status}`);
      load();
    } catch (err) {
      toast.error("Update failed");
    }
  };

  const remove = async (id) => {
    await api.delete(`/listings/${id}`);
    toast.success("Listing removed");
    load();
  };

  return (
    <div data-testid="listings-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="overline mb-3" style={{ color: isCollabOnly ? "var(--wz-gold)" : "var(--wz-amber)" }}>
            {isCollabOnly ? "Collaborator workspace" : "Seller workspace"}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
            {isCollabOnly ? "My collaborations" : "My listings"}
          </h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">
            {isCollabOnly
              ? "Listings you've been invited to collaborate on. You can use every in-listing tool — Vault, Data Room, Co-pilot, Preview-as-Buyer."
              : <>Add portfolio companies for sale. Flip a listing to <span className="text-[var(--wz-positive)]">Live</span> to expose it on the buyer marketplace.</>}
          </p>
        </div>
        {!isCollabOnly && (
          <button data-testid="add-listing" onClick={() => setShow(!show)} className="wz-btn wz-btn-gold flex items-center gap-2">
            <Plus size={14} /> New listing
          </button>
        )}
      </div>

      {show && (
        <form onSubmit={submit} data-testid="listing-form" className="wz-card p-6 mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Company name" required value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} tid="listing-name" />
          <Input label="Sector" required value={form.sector} onChange={(v) => setForm({ ...form, sector: v })} tid="listing-sector" />
          <Input label="Geography" required value={form.geography} onChange={(v) => setForm({ ...form, geography: v })} tid="listing-geo" />
          <Input label="Asking price (USD M)" type="number" required value={form.asking_price_usd_m} onChange={(v) => setForm({ ...form, asking_price_usd_m: v })} tid="listing-price" />
          <Input label="Revenue (USD M)" type="number" value={form.revenue_usd_m} onChange={(v) => setForm({ ...form, revenue_usd_m: v })} tid="listing-rev" />
          <Input label="EBITDA (USD M)" type="number" value={form.ebitda_usd_m} onChange={(v) => setForm({ ...form, ebitda_usd_m: v })} tid="listing-ebitda" />
          <Input label="Employees" type="number" value={form.employees} onChange={(v) => setForm({ ...form, employees: v })} tid="listing-emp" />
          <div>
            <div className="overline mb-2">Status</div>
            <select className="wz-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} data-testid="listing-status">
              {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
          <Input className="md:col-span-2" label="Headline" required value={form.headline} onChange={(v) => setForm({ ...form, headline: v })} tid="listing-headline" />
          <label className="md:col-span-2">
            <div className="overline mb-2">Summary</div>
            <textarea required rows={3} className="wz-input" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} data-testid="listing-summary" />
          </label>
          <label className="md:col-span-2">
            <div className="overline mb-2">Highlights (one per line)</div>
            <textarea rows={3} className="wz-input" value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} data-testid="listing-highlights" placeholder="32 hospital systems under contract&#10;FDA + CE marked&#10;Founder-led, succession-ready" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="wz-btn-ghost wz-btn">Cancel</button>
            <button type="submit" className="wz-btn wz-btn-gold" data-testid="listing-save">Create listing</button>
          </div>
        </form>
      )}

      {listings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="listing-scope-filter">
          {[
            ["all", "All", listings.length],
            ["mine", "Mine", counts.mine || 0],
            ["org", "Org", counts.org || 0],
            ["shared", "Shared with me", counts.shared || 0],
          ].map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setScopeFilter(key)}
              data-testid={`filter-${key}`}
              className={`text-[10px] font-mono-wz uppercase tracking-widest px-3 py-1.5 border transition-colors ${
                scopeFilter === key
                  ? "border-[var(--wz-gold)] text-[var(--wz-gold)] bg-[var(--wz-gold)]/10"
                  : "border-[var(--wz-border)] text-[var(--wz-text-secondary)] hover:border-[var(--wz-text-tertiary)]"
              }`}
            >
              {label} · {n}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="listing-grid">
        {filteredListings.map((l) => (
          <ListingCard key={l.id} listing={l} onRemove={remove} onSetStatus={setStatus} />
        ))}
        {filteredListings.length === 0 && listings.length > 0 && (
          <div className="text-xs text-[var(--wz-text-tertiary)] col-span-full" data-testid="listing-empty-filter">
            No listings match this filter.
          </div>
        )}
        {listings.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)] md:col-span-2">
            No listings yet — create your first one above.
          </div>
        )}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required, className = "", tid }) {
  return (
    <label className={`block ${className}`}>
      <div className="overline mb-2">{label}</div>
      <input
        type={type}
        required={required}
        className="wz-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={tid}
      />
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-2">
      <div className="overline mb-1">{label}</div>
      <div className="font-mono-wz text-sm">{value}</div>
    </div>
  );
}

/* ============================================================================
 * ListingCard — single listing tile with the "View as principal" preview mode.
 *
 * When viewAsPrincipal=true the agent's management chrome is hidden so the
 * agent can sanity-check what the principal owner experiences when they
 * accept the listing-collaborator invite:
 *   - Delete (trash) button hidden
 *   - Workflow status-change buttons hidden
 *   - Data Room upload form + per-file delete hidden
 *   - Collaborators: invite form, remove buttons, and access-policy save hidden
 *   - A gold dashed accent + sticky banner make the preview state obvious.
 * ========================================================================== */
function ListingCard({ listing: l, onRemove, onSetStatus }) {
  const [viewAsPrincipal, setViewAsPrincipal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const navigate = useNavigate();
  const cardBorder = viewAsPrincipal
    ? "wz-card p-6 border-dashed border-2 border-[var(--wz-gold)]"
    : "wz-card p-6";

  const openPreviewVault = async () => {
    setPreviewBusy(true);
    try {
      const r = await api.post(`/listings/${l.id}/preview-vault`);
      toast.success("Preview Vault ready", {
        description: "Opened a buyer-side QA Vault. NDA auto-accepted, staged docs cloned.",
      });
      navigate(`/app/rooms/${r.data.id}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to open preview vault");
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className={cardBorder} data-testid={`listing-card-${l.id}`} data-view-as-principal={viewAsPrincipal}>
      {viewAsPrincipal && (
        <div
          data-testid={`principal-preview-banner-${l.id}`}
          className="mb-4 px-3 py-2 border border-[var(--wz-gold)] bg-[var(--wz-gold)]/10 text-xs flex items-start gap-2"
        >
          <Eye size={14} className="text-[var(--wz-gold)] shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            <strong>Principal preview.</strong> This is what your client sees when they accept the
            listing invite. Agent-only management controls are hidden. Exit preview to manage.
          </span>
        </div>
      )}

      <div className="flex justify-between items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Tag size={14} className="text-[var(--wz-amber)]" />
            <span className={`pill ${l.status === "live" ? "pill-positive" : l.status === "under_loi" ? "pill-amber" : "pill-gold"}`}>{l.status}</span>
            <span className="pill pill-gold">{l.sector}</span>
            {l.workspace_scope === "org" && l.org_name && (
              <span
                className="pill pill-amber inline-flex items-center gap-1"
                title={`Owned by ${l.org_name}`}
                data-testid={`scope-badge-${l.id}`}
              >
                <Buildings size={10} /> {l.org_name}
              </span>
            )}
            {l.workspace_scope === "shared" && (
              <span
                className="pill"
                style={{ borderColor: "var(--wz-text-tertiary)", color: "var(--wz-text-tertiary)" }}
                title="Shared with you as a collaborator"
                data-testid={`scope-badge-${l.id}`}
              >
                Shared with me
              </span>
            )}
          </div>
          <div className="font-display text-2xl tracking-tight">{l.company_name}</div>
          <div className="text-sm text-[var(--wz-text-secondary)] mt-1">{l.headline}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {!viewAsPrincipal && (
            <button
              onClick={openPreviewVault}
              disabled={previewBusy}
              data-testid={`preview-vault-${l.id}`}
              title="Open a buyer-side preview Vault to QA copilot, DRL, and findings on this listing"
              className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] text-[var(--wz-text-secondary)] hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] px-2 py-1 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Vault size={11} /> {previewBusy ? "Opening…" : "Preview as buyer"}
            </button>
          )}
          {!viewAsPrincipal && (
            <button
              onClick={() => setShowShareModal(true)}
              data-testid={`share-link-${l.id}`}
              title="Generate a public preview link to share"
              className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] text-[var(--wz-text-secondary)] hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] px-2 py-1 transition-colors inline-flex items-center gap-1"
            >
              <ShareNetwork size={11} /> Share
            </button>
          )}
          <button
            onClick={() => setViewAsPrincipal((v) => !v)}
            data-testid={`view-as-principal-${l.id}`}
            title={viewAsPrincipal ? "Exit principal preview" : "Preview as the principal owner"}
            className={`text-[10px] font-mono-wz uppercase tracking-widest border px-2 py-1 transition-colors ${
              viewAsPrincipal
                ? "border-[var(--wz-gold)] text-[var(--wz-gold)] bg-[var(--wz-gold)]/10"
                : "border-[var(--wz-border)] text-[var(--wz-text-secondary)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)]"
            }`}
          >
            {viewAsPrincipal ? (
              <span className="inline-flex items-center gap-1"><EyeSlash size={11} /> Exit preview</span>
            ) : (
              <span className="inline-flex items-center gap-1"><Eye size={11} /> View as principal</span>
            )}
          </button>
          {!viewAsPrincipal && (
            <button
              onClick={() => onRemove(l.id)}
              className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)]"
              data-testid={`del-${l.id}`}
            >
              <Trash size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-5">
        <Metric label="Asking" value={`$${l.asking_price_usd_m}M`} />
        <Metric label="Revenue" value={l.revenue_usd_m ? `$${l.revenue_usd_m}M` : "—"} />
        <Metric label="EBITDA" value={l.ebitda_usd_m ? `$${l.ebitda_usd_m}M` : "—"} />
      </div>

      <p className="text-sm text-[var(--wz-text-secondary)] mt-4 leading-relaxed">{l.summary}</p>

      {(l.highlights || []).length > 0 && (
        <ul className="mt-4 space-y-1 text-xs">
          {l.highlights.map((h, i) => (
            <li key={i} className="flex gap-2 text-[var(--wz-text-secondary)]">
              <span className="text-[var(--wz-amber)]">▸</span>{h}
            </li>
          ))}
        </ul>
      )}

      <ListingDataRoom listingId={l.id} listingName={l.company_name} viewAsPrincipal={viewAsPrincipal} />
      <ListingCollabPanel listing={l} viewAsPrincipal={viewAsPrincipal} />

      {showShareModal && (
        <ShareLinkModal
          listingId={l.id}
          listingName={l.company_name}
          onClose={() => setShowShareModal(false)}
        />
      )}

      <div className="mt-5 pt-4 border-t border-[var(--wz-border)] flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs font-mono-wz text-[var(--wz-text-secondary)]">
          {l.view_count} views · {l.inquiry_count} inquiries
        </div>
        {!viewAsPrincipal && (
          <div className="flex flex-wrap gap-2" data-testid={`status-buttons-${l.id}`}>
            {STATUSES.filter((s) => s.v !== l.status).map((s) => (
              <button
                key={s.v}
                onClick={() => onSetStatus(l, s.v)}
                className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-2 py-1 hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)] transition-colors"
                data-testid={`set-${l.id}-${s.v}`}
              >
                → {s.l}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * ListingCollabPanel — collapsible wrapper around the collaborators editor
 * ========================================================================== */
function ListingCollabPanel({ listing, viewAsPrincipal = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-[var(--wz-border)]" data-testid={`listing-collab-${listing.id}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`collab-toggle-${listing.id}`}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--wz-surface-hover)] transition-colors"
      >
        <span className="flex items-center gap-2">
          <UsersThree size={16} className="text-[var(--wz-gold)]" />
          <span className="text-sm font-medium">Collaborators &amp; access policy</span>
          <span className="overline">share with the principal or your team</span>
        </span>
        {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
      </button>
      {open && (
        <div className="border-t border-[var(--wz-border)] p-4">
          <ListingCollaborators
            listingId={listing.id}
            sellerId={listing.seller_id}
            currentAccessPolicy={listing.access_policy}
            readOnly={viewAsPrincipal}
          />
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * ListingDataRoom — per-listing pre-stage area; auto-clones into vaults on open
 * ========================================================================== */
function ListingDataRoom({ listingId, listingName, viewAsPrincipal = false }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("financials");
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/listings/${listingId}/staged-files`);
      setFiles(r.data || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load data room");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { if (open && !loaded) load(); }, [open]); // eslint-disable-line

  const upload = async (e) => {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", chosen);
    fd.append("folder", folder);
    if (note) fd.append("note", note);
    try {
      await api.post(`/listings/${listingId}/staged-files/binary`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Staged · ${chosen.name}`, {
        description: "Stored in this listing's Data Room. It will auto-copy into a Vault the moment a buyer's inquiry is Accepted and you open one.",
        duration: 7000,
      });
      setChosen(null);
      setNote("");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = async (f) => {
    try {
      const r = await api.get(`/listings/${listingId}/staged-files/${f.id}/download`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: f.content_type || "application/octet-stream" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Download failed");
    }
  };

  const removeFile = async (fid) => {
    if (!window.confirm("Remove this staged document?")) return;
    try {
      await api.delete(`/listings/${listingId}/staged-files/${fid}`);
      setFiles((arr) => arr.filter((x) => x.id !== fid));
      toast.success("Removed");
    } catch (err) {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="mt-5 border border-[var(--wz-border)]" data-testid={`listing-dataroom-${listingId}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`dataroom-toggle-${listingId}`}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--wz-surface-hover)] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Files size={16} className="text-[var(--wz-amber)]" />
          <span className="text-sm font-medium">Listing data room</span>
          <span className="overline">{loaded ? `${files.length} staged` : "stage docs before NDA"}</span>
        </span>
        {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
      </button>

      {open && (
        <div className="border-t border-[var(--wz-border)] p-4 space-y-4">
          <div className="flex items-start gap-2 border border-[var(--wz-amber)]/40 bg-[var(--wz-amber)]/10 px-3 py-2.5 text-xs leading-relaxed">
            <Files size={14} className="text-[var(--wz-amber)] mt-0.5 shrink-0" />
            <div className="text-[var(--wz-text-secondary)]">
              <span className="text-[var(--wz-text)] font-medium">This is not a Vault yet.</span>{" "}
              Files here live in <em>this listing&apos;s</em> Data Room. A Vault is created per-buyer
              when you mark their inquiry as <span className="text-[var(--wz-positive)] font-medium">Accepted</span>{" "}
              and click <span className="font-medium">Open Vault</span>. Everything staged here is
              auto-copied into that Vault the moment it opens — so the buyer can read it as soon as they sign the NDA.
            </div>
          </div>
          <p className="text-xs text-[var(--wz-text-secondary)] leading-relaxed">
            Documents you upload here are <strong>encrypted at rest (AES-256-GCM)</strong> and auto-clone
            into every Vault opened on this listing — so when a buyer signs the NDA, your data room is
            already populated. Stage your CIM, financials, customer cohort, contracts here.
          </p>

          {/* Upload form — hidden in principal preview */}
          {!viewAsPrincipal && (
          <form onSubmit={upload} className="border border-[var(--wz-border)] p-3" data-testid={`dataroom-upload-${listingId}`}>
            <div className="flex items-center gap-2 mb-3">
              <CloudArrowUp size={14} className="text-[var(--wz-amber)]" />
              <div className="text-sm font-medium">Add document</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
              <label className="block">
                <div className="overline mb-1">File · {UPLOAD_HINT} · ≤ {UPLOAD_MAX_MB} MB</div>
                <input
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  onChange={(e) => setChosen(e.target.files?.[0] || null)}
                  className="wz-input"
                  data-testid={`dataroom-file-${listingId}`}
                />
              </label>
              <label className="block">
                <div className="overline mb-1">Folder</div>
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="wz-input"
                  data-testid={`dataroom-folder-${listingId}`}
                >
                  {["financials","legal","hr","it","operations","commercial","other"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy || !chosen}
                data-testid={`dataroom-submit-${listingId}`}
                className="wz-btn wz-btn-gold text-xs h-[38px] px-4 whitespace-nowrap"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional) — e.g., 'Q3 2025 financial deck'"
              className="wz-input mt-2 text-sm"
              data-testid={`dataroom-note-${listingId}`}
            />
          </form>
          )}

          {/* File list */}
          <div className="divide-y divide-[var(--wz-border)]" data-testid={`dataroom-files-${listingId}`}>
            {!loaded ? (
              <div className="py-6 text-center text-xs text-[var(--wz-text-tertiary)]">Loading…</div>
            ) : files.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--wz-text-tertiary)]">
                Nothing staged yet for <span className="text-[var(--wz-text-secondary)]">{listingName}</span>.
              </div>
            ) : (
              files.map((f) => (
                <div key={f.id} className="py-2 flex items-center justify-between gap-3 text-sm" data-testid={`dataroom-file-row-${f.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{f.filename}</span>
                      <span className="pill text-[10px]">{f.folder}</span>
                      {f.encrypted && <span className="pill pill-positive text-[10px]">AES-256</span>}
                      {f.source?.kind && (
                        <span
                          className="pill text-[10px]"
                          style={{ borderColor: "var(--wz-gold)", color: "var(--wz-gold)" }}
                          data-testid={`source-badge-${f.id}`}
                          title={`Mirrored from ${f.source.kind}`}
                        >
                          via {f.source.kind}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-0.5">
                      {(f.size_bytes / 1024).toFixed(1)} KB · {f.page_count || 0} pg · {new Date(f.uploaded_at).toLocaleString()}
                    </div>
                    {f.note && <div className="text-xs text-[var(--wz-text-secondary)] italic mt-0.5">{f.note}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => downloadFile(f)}
                      className="text-xs text-[var(--wz-gold)] hover:underline flex items-center gap-1"
                      data-testid={`dataroom-download-${f.id}`}
                    >
                      <DownloadSimple size={12} /> Download
                    </button>
                    {!viewAsPrincipal && (
                      <button
                        onClick={() => removeFile(f.id)}
                        className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)]"
                        title="Remove"
                        data-testid={`dataroom-delete-${f.id}`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* External file sources (Composio-mirrored) — render under the
              same expander so sellers see uploads + sources as one surface. */}
          <ExternalSources listingId={listingId} viewAsPrincipal={viewAsPrincipal} />
        </div>
      )}
    </div>
  );
}
