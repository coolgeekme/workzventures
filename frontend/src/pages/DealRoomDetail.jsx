import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  FileText, Files, MagnifyingGlass, ListChecks, ShieldCheck,
  CloudArrowUp, Sparkle, CheckCircle, Warning, ArrowLeft,
} from "@phosphor-icons/react";

const FOLDERS = [
  { v: "financials", l: "Financials" },
  { v: "legal", l: "Legal" },
  { v: "hr", l: "HR" },
  { v: "it", l: "IT" },
  { v: "operations", l: "Operations" },
  { v: "commercial", l: "Commercial" },
  { v: "other", l: "Other" },
];

export default function DealRoomDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState("files");
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState({ filename: "", folder: "financials", content: "", note: "" });

  const load = () => api.get(`/deal-rooms/${id}`).then((r) => setRoom(r.data));

  useEffect(() => {
    load();
    api.get("/drl-templates").then((r) => setTemplates(r.data));
  }, [id]);

  if (!room) return <div className="px-8 py-8 text-sm text-[var(--wz-text-secondary)]">Loading deal room…</div>;

  const isBuyer = user?.id === room.buyer_id;
  const isSeller = user?.id === room.seller_id;
  const isParticipant = isBuyer || isSeller || user?.role === "admin";
  const accentClass = isSeller ? "text-[var(--wz-amber)]" : "text-[var(--wz-gold)]";

  const acceptNda = async () => {
    await api.post(`/deal-rooms/${id}/accept-nda`);
    toast.success("NDA accepted — data room unlocked");
    load();
  };

  const applyTemplate = async (templateId) => {
    setBusy(true);
    try {
      const r = await api.post(`/deal-rooms/${id}/drl`, { template_id: templateId });
      toast.success(`DRL applied — ${r.data.request_count} requests created`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const submitUpload = async (e) => {
    e.preventDefault();
    if (!upload.filename || !upload.content) return toast.error("Filename and content required");
    setBusy(true);
    try {
      const r = await api.post(`/deal-rooms/${id}/files`, upload);
      if (r.data.matched_request_id) toast.success(`Uploaded · auto-matched to DRL item`);
      else toast.success("Uploaded");
      setUpload({ filename: "", folder: upload.folder, content: "", note: "" });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally { setBusy(false); }
  };

  const generateFindings = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/deal-rooms/${id}/generate-findings`);
      toast.success(`${r.data.findings.length} findings generated from ${r.data.files_analyzed} files`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="deal-room-detail" className="px-8 py-8">
      <Link to="/app/rooms" className="flex items-center gap-2 text-xs text-[var(--wz-text-tertiary)] hover:text-white mb-4" data-testid="back-to-rooms">
        <ArrowLeft size={12} /> All deal rooms
      </Link>

      <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div>
          <div className={`overline mb-2 ${accentClass}`}>Deal Room · {room.sector || "—"}</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">{room.listing_name}</h1>
          <div className="text-xs text-[var(--wz-text-secondary)] mt-2">
            buyer <span className="text-white">{room.buyer_name}</span> ({room.buyer_org}) · seller <span className="text-white">{room.seller_name}</span> ({room.seller_org})
          </div>
        </div>
        <span className={`pill ${room.status === "active" ? "pill-positive" : room.status === "closed" ? "pill-gold" : "pill-amber"}`}>
          {room.status.replace("_", " ")}
        </span>
      </div>

      {/* NDA gate */}
      {room.status === "pending_nda" && isBuyer && (
        <div className="wz-card p-6 mb-6 border-[var(--wz-amber)]" data-testid="nda-gate">
          <div className="flex items-start gap-4">
            <ShieldCheck size={28} className="text-[var(--wz-amber)] shrink-0 mt-1" />
            <div className="flex-1">
              <div className="font-display text-xl tracking-tight">Non-disclosure agreement required</div>
              <p className="text-sm text-[var(--wz-text-secondary)] mt-2 leading-relaxed">
                Before accessing diligence materials on <span className="text-white">{room.listing_name}</span>, you agree to keep all shared information confidential, use it solely to evaluate the opportunity, and notify <span className="text-white">{room.seller_org}</span> if you cease evaluation.
              </p>
              <button onClick={acceptNda} className="wz-btn wz-btn-gold mt-4" data-testid="accept-nda">
                I agree — unlock data room
              </button>
            </div>
          </div>
        </div>
      )}
      {room.status === "pending_nda" && isSeller && (
        <div className="wz-card p-5 mb-6 text-sm text-[var(--wz-text-secondary)]">
          Waiting for <span className="text-white">{room.buyer_name}</span> to accept the NDA before the room unlocks.
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[var(--wz-border)] flex gap-1" data-testid="tabs">
        {[
          { v: "files", l: "Files", icon: Files, count: room.files.length },
          { v: "drl", l: "DRL", icon: ListChecks, count: room.requests.length },
          { v: "findings", l: "Findings", icon: MagnifyingGlass, count: room.findings.length },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              data-testid={`tab-${t.v}`}
              className={`px-4 py-3 text-sm flex items-center gap-2 border-b-2 transition-colors ${
                tab === t.v ? `${accentClass} border-current` : "text-[var(--wz-text-secondary)] border-transparent hover:text-white"
              }`}
            >
              <Icon size={14} /> {t.l}
              <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* TAB: Files */}
      {tab === "files" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="wz-card overflow-hidden" data-testid="files-list">
            <div className="px-5 py-3 border-b border-[var(--wz-border)] overline">Document inventory</div>
            <div className="divide-y divide-[var(--wz-border)]">
              {room.files.map((f) => (
                <div key={f.id} className="px-5 py-3 flex items-start justify-between gap-3" data-testid={`file-${f.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-[var(--wz-text-tertiary)] shrink-0" />
                      <div className="font-medium text-sm truncate">{f.filename}</div>
                    </div>
                    <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-1">
                      {f.folder} · {f.char_count} chars · {f.uploaded_by_role} · {new Date(f.uploaded_at).toLocaleString()}
                    </div>
                    {f.note && <div className="text-xs text-[var(--wz-text-secondary)] mt-1 italic">{f.note}</div>}
                  </div>
                  {f.matched_request_id && (
                    <span className="pill pill-positive flex items-center gap-1"><CheckCircle size={10} weight="fill" /> matched</span>
                  )}
                </div>
              ))}
              {room.files.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-[var(--wz-text-tertiary)]">No files uploaded yet.</div>
              )}
            </div>
          </div>

          {/* Upload */}
          {isParticipant && room.status === "active" && (
            <form onSubmit={submitUpload} className="wz-card p-5 h-fit" data-testid="upload-form">
              <div className="flex items-center gap-2 mb-3">
                <CloudArrowUp size={16} className={accentClass} />
                <div className="font-display text-base tracking-tight">Upload document</div>
              </div>
              <label className="block mb-3">
                <div className="overline mb-1">Filename</div>
                <input required className="wz-input" value={upload.filename} onChange={(e) => setUpload({ ...upload, filename: e.target.value })} placeholder="MSA_TopClient_2025.pdf" data-testid="upload-filename" />
              </label>
              <label className="block mb-3">
                <div className="overline mb-1">Folder</div>
                <select className="wz-input" value={upload.folder} onChange={(e) => setUpload({ ...upload, folder: e.target.value })} data-testid="upload-folder">
                  {FOLDERS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </label>
              <label className="block mb-3">
                <div className="overline mb-1">Extracted text content</div>
                <textarea required rows={5} className="wz-input font-mono-wz text-xs" value={upload.content} onChange={(e) => setUpload({ ...upload, content: e.target.value })} placeholder="Paste the document text here (we extract automatically once object-storage upload ships)" data-testid="upload-content" />
              </label>
              <label className="block mb-4">
                <div className="overline mb-1">Note (optional)</div>
                <input className="wz-input" value={upload.note} onChange={(e) => setUpload({ ...upload, note: e.target.value })} data-testid="upload-note" />
              </label>
              <button type="submit" disabled={busy} className="wz-btn wz-btn-gold w-full" data-testid="upload-submit">
                {busy ? "Uploading…" : "Upload + AI auto-match"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* TAB: DRL */}
      {tab === "drl" && (
        <div className="mt-6">
          {room.requests.length === 0 && isBuyer && (
            <div className="wz-card p-6 mb-6" data-testid="drl-templates">
              <div className="overline mb-3">Pick a sector template</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    disabled={busy}
                    onClick={() => applyTemplate(t.id)}
                    data-testid={`template-${t.id}`}
                    className="border border-[var(--wz-border)] p-4 text-left hover:border-[var(--wz-gold)] transition-colors"
                  >
                    <div className="font-display tracking-tight">{t.name}</div>
                    <div className="overline mt-1">{t.item_count} items</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {room.requests.length > 0 && (
            <div className="wz-card overflow-hidden" data-testid="drl-list">
              <div className="px-5 py-3 border-b border-[var(--wz-border)] flex items-center justify-between">
                <div className="overline">Diligence request list · {room.drl_template_id?.toUpperCase()}</div>
                <span className="font-mono-wz text-xs text-[var(--wz-text-secondary)]">
                  {room.requests.filter((r) => r.status === "satisfied").length} / {room.requests.length} satisfied
                </span>
              </div>
              <div className="divide-y divide-[var(--wz-border)]">
                {room.requests.map((r) => (
                  <div key={r.id} className="px-5 py-3 grid grid-cols-[1fr_120px_100px] gap-4 items-center" data-testid={`drl-${r.id}`}>
                    <div>
                      <div className="text-sm">{r.title}</div>
                      <div className="overline mt-1">{r.workstream}</div>
                    </div>
                    <div className="text-xs font-mono-wz text-[var(--wz-text-tertiary)]">
                      {r.matched_file_ids.length} file{r.matched_file_ids.length === 1 ? "" : "s"}
                    </div>
                    <span className={`pill ${r.status === "satisfied" ? "pill-positive" : "pill-amber"}`}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {room.requests.length === 0 && !isBuyer && (
            <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
              Waiting for the buyer to apply a DRL template.
            </div>
          )}
        </div>
      )}

      {/* TAB: Findings */}
      {tab === "findings" && (
        <div className="mt-6">
          <div className="wz-card p-5 mb-6 flex items-center justify-between flex-wrap gap-3" data-testid="findings-bar">
            <div className="flex items-center gap-3">
              <Sparkle size={18} className={accentClass} />
              <div>
                <div className="font-display tracking-tight">AI-generated diligence findings</div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
                  Reads every uploaded file, returns risks with severity + workstream + cited excerpt.
                </div>
              </div>
            </div>
            {isBuyer && (
              <button onClick={generateFindings} disabled={busy || room.files.length === 0} className="wz-btn wz-btn-gold flex items-center gap-2" data-testid="generate-findings">
                {busy ? "Analyzing…" : "Generate findings"}
              </button>
            )}
          </div>

          <div className="space-y-3" data-testid="findings-list">
            {room.findings.map((f) => (
              <div key={f.id} className="wz-card p-5" data-testid={`finding-${f.id}`}>
                <div className="flex items-start gap-3">
                  <Warning
                    size={18}
                    weight="fill"
                    className={
                      f.severity === "high" ? "text-[var(--wz-negative)]" :
                      f.severity === "medium" ? "text-[var(--wz-amber)]" :
                      "text-[var(--wz-text-tertiary)]"
                    }
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`pill ${f.severity === "high" ? "pill-negative" : f.severity === "medium" ? "pill-amber" : "pill-gold"}`}>{f.severity}</span>
                      <span className="pill pill-gold">{f.workstream}</span>
                    </div>
                    <div className="font-medium">{f.title}</div>
                    <p className="text-sm text-[var(--wz-text-secondary)] mt-2 leading-relaxed">{f.description}</p>
                    {f.citation?.filename && (
                      <blockquote className="mt-3 border-l-2 border-[var(--wz-gold)] pl-4 text-xs italic text-[var(--wz-text-secondary)]">
                        <span className="font-mono-wz text-[var(--wz-gold)] not-italic">{f.citation.filename}</span>
                        {f.citation.excerpt && <> — "{f.citation.excerpt}"</>}
                      </blockquote>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {room.findings.length === 0 && (
              <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
                No findings yet — {isBuyer ? "tap Generate findings above once files are uploaded." : "the buyer will run the analysis after files are exchanged."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
