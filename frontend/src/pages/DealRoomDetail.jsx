import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  FileText, Files, MagnifyingGlass, ListChecks, ShieldCheck,
  CloudArrowUp, CheckCircle, Warning, ArrowLeft, ChatCircleDots, PaperPlaneTilt,
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
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMode, setUploadMode] = useState("binary"); // 'binary' | 'text'
  const [signedName, setSignedName] = useState("");
  const [ndaAck, setNdaAck] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const load = () => api.get(`/deal-rooms/${id}`).then((r) => setRoom(r.data));
  const loadCopilot = () => api.get(`/deal-rooms/${id}/copilot`).then((r) => setMessages(r.data));

  useEffect(() => {
    load();
    loadCopilot();
    api.get("/drl-templates").then((r) => setTemplates(r.data));
  }, [id]);

  if (!room) return <div className="px-8 py-8 text-sm text-[var(--wz-text-secondary)]">Loading the Vault…</div>;

  const isBuyer = user?.id === room.buyer_id;
  const isSeller = user?.id === room.seller_id;
  const isParticipant = isBuyer || isSeller || user?.role === "admin";
  const accentClass = isSeller ? "text-[var(--wz-amber)]" : "text-[var(--wz-gold)]";

  const acceptNda = async () => {
    const typed = signedName.trim();
    if (typed.length < 2) {
      toast.error("Type your full legal name to sign the NDA");
      return;
    }
    if (!ndaAck) {
      toast.error("Tick the confirmation box to acknowledge the NDA");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/deal-rooms/${id}/accept-nda`, { signed_name: typed });
      toast.success(`NDA signed as ${r.data.signed_name} — the Vault is unlocked`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "NDA acceptance failed");
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    try {
      let r;
      if (uploadMode === "binary") {
        if (!uploadFile) {
          toast.error("Pick a file to upload");
          setBusy(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", uploadFile);
        fd.append("folder", upload.folder);
        if (upload.note) fd.append("note", upload.note);
        r = await api.post(`/deal-rooms/${id}/files/binary`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        if (!upload.filename || !upload.content) {
          toast.error("Filename and content required");
          setBusy(false);
          return;
        }
        r = await api.post(`/deal-rooms/${id}/files`, upload);
      }
      if (r.data.matched_request_id) toast.success(`Uploaded · auto-matched to DRL item`);
      else toast.success("Uploaded");
      setUpload({ filename: "", folder: upload.folder, content: "", note: "" });
      setUploadFile(null);
      // Reset native file input
      const fi = document.getElementById("dealroom-file-input");
      if (fi) fi.value = "";
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
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

  const askCopilot = async (e) => {
    e?.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    const q = question;
    setQuestion("");
    try {
      const r = await api.post(`/deal-rooms/${id}/copilot`, { message: q });
      setMessages((prev) => [...prev, r.data.user_message, r.data.assistant_message]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Co-pilot failed");
      setQuestion(q);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div data-testid="deal-room-detail" className="px-8 py-8">
      <Link to="/app/rooms" className="flex items-center gap-2 text-xs text-[var(--wz-text-tertiary)] hover:text-white mb-4" data-testid="back-to-rooms">
        <ArrowLeft size={12} /> All vaults
      </Link>

      <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div>
          <div className={`overline mb-2 ${accentClass}`}>The Vault · {room.sector || "—"}</div>
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
              <div className="mt-3 text-sm text-[var(--wz-text-secondary)] leading-relaxed border border-[var(--wz-border)] p-4 max-h-48 overflow-y-auto" data-testid="nda-terms">
                <p className="mb-2">This Confidentiality Agreement (this <span className="text-white">"Agreement"</span>) is entered into between <span className="text-white">{room.seller_org || room.seller_name}</span> ("Disclosing Party") and <span className="text-white">{user.organization || user.name}</span> ("Receiving Party"), effective on the date of execution below.</p>
                <p className="mb-2"><span className="text-white">1. Confidential Information.</span> All financial, legal, operational, technical, customer, and employee data shared in connection with the proposed transaction concerning <span className="text-white">{room.listing_name}</span> is "Confidential Information."</p>
                <p className="mb-2"><span className="text-white">2. Use Restriction.</span> Receiving Party shall use Confidential Information solely to evaluate this opportunity, restrict access to personnel with a need-to-know, and not disclose to any third party for 24 months.</p>
                <p className="mb-2"><span className="text-white">3. Return / Destruction.</span> Upon written request or termination of discussions, Receiving Party shall destroy or return all Confidential Information within 10 business days.</p>
                <p className="mb-2"><span className="text-white">4. Non-solicitation.</span> Receiving Party shall not, for 12 months, solicit for hire any employee of Disclosing Party with whom it had contact under this Agreement.</p>
                <p><span className="text-white">5. Governing Law.</span> This Agreement is governed by the laws of the State of Delaware. Disputes shall be resolved by binding arbitration in New York, NY.</p>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <label className="block">
                  <div className="overline mb-1">Type your full legal name to sign</div>
                  <input
                    type="text"
                    value={signedName}
                    onChange={(e) => setSignedName(e.target.value)}
                    placeholder={user.name || "Jane Q. Buyer"}
                    className="wz-input"
                    style={{ fontFamily: "var(--wz-font-display, serif)", fontStyle: "italic", fontSize: "1.1rem", letterSpacing: "0.02em" }}
                    data-testid="nda-signed-name"
                  />
                </label>
                <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mb-2">
                  signed at {new Date().toLocaleString()} UTC
                </div>
              </div>

              <label className="flex items-start gap-2 mt-3 text-xs text-[var(--wz-text-secondary)] cursor-pointer" data-testid="nda-ack-label">
                <input
                  type="checkbox"
                  checked={ndaAck}
                  onChange={(e) => setNdaAck(e.target.checked)}
                  className="mt-0.5"
                  data-testid="nda-ack-checkbox"
                />
                <span>I have read and agree to the NDA above. I acknowledge that typing my name constitutes an electronic signature under the U.S. ESIGN Act and equivalent local law.</span>
              </label>

              <button
                onClick={acceptNda}
                disabled={busy || !ndaAck || signedName.trim().length < 2}
                className="wz-btn wz-btn-gold mt-4"
                data-testid="accept-nda"
              >
                {busy ? "Signing…" : "Sign & unlock the Vault"}
              </button>
            </div>
          </div>
        </div>
      )}
      {room.status === "pending_nda" && isSeller && (
        <div className="wz-card p-5 mb-6 text-sm text-[var(--wz-text-secondary)]">
          Waiting for <span className="text-white">{room.buyer_name}</span> to sign the NDA before the room unlocks.
        </div>
      )}
      {room.status === "active" && room.nda_signed_name && (
        <div className="wz-card p-3 mb-6 text-xs text-[var(--wz-text-tertiary)] flex items-center gap-2" data-testid="nda-signed-badge">
          <ShieldCheck size={14} className="text-[var(--wz-positive)]" />
          NDA e-signed by <span className="text-white" style={{ fontStyle: "italic" }}>{room.nda_signed_name}</span> · {new Date(room.nda_accepted_by_buyer_at).toLocaleString()}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[var(--wz-border)] flex gap-1" data-testid="tabs">
        {[
          { v: "files", l: "Files", icon: Files, count: room.files.length },
          { v: "drl", l: "DRL", icon: ListChecks, count: room.requests.length },
          { v: "findings", l: "Findings", icon: MagnifyingGlass, count: room.findings.length },
          { v: "copilot", l: "Co-pilot", icon: ChatCircleDots, count: messages.length },
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
              {room.files.map((f) => {
                const downloadHref = f.gridfs_id
                  ? `${process.env.REACT_APP_BACKEND_URL}/api/deal-rooms/${id}/files/${f.id}/download`
                  : null;
                const token = localStorage.getItem("workz_token");
                const onDownload = async (e) => {
                  e.preventDefault();
                  try {
                    const resp = await api.get(`/deal-rooms/${id}/files/${f.id}/download`, { responseType: "blob" });
                    const blob = new Blob([resp.data], { type: f.content_type || "application/octet-stream" });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = f.filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Download failed");
                  }
                };
                return (
                  <div key={f.id} className="px-5 py-3 flex items-start justify-between gap-3" data-testid={`file-${f.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-[var(--wz-text-tertiary)] shrink-0" />
                        <div className="font-medium text-sm truncate">{f.filename}</div>
                      </div>
                      <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-1">
                        {f.folder} ·{" "}
                        {f.size_bytes ? `${(f.size_bytes / 1024).toFixed(1)} KB` : `${f.char_count || 0} chars`}
                        {f.page_count ? ` · ${f.page_count} pg` : ""} · {f.uploaded_by_role} ·{" "}
                        {new Date(f.uploaded_at).toLocaleString()}
                      </div>
                      {f.note && <div className="text-xs text-[var(--wz-text-secondary)] mt-1 italic">{f.note}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f.matched_request_id && (
                        <span className="pill pill-positive flex items-center gap-1"><CheckCircle size={10} weight="fill" /> matched</span>
                      )}
                      {downloadHref && (
                        <button
                          onClick={onDownload}
                          className="text-xs text-[var(--wz-gold)] hover:underline"
                          data-testid={`download-${f.id}`}
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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

              <div className="flex gap-1 mb-3 text-[10px]" data-testid="upload-mode-switch">
                <button
                  type="button"
                  onClick={() => setUploadMode("binary")}
                  className={`flex-1 py-1.5 border ${uploadMode === "binary" ? "border-[var(--wz-gold)] text-[var(--wz-gold)]" : "border-[var(--wz-border)] text-[var(--wz-text-tertiary)]"}`}
                  data-testid="upload-mode-binary"
                >
                  File · PDF/DOCX/TXT
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("text")}
                  className={`flex-1 py-1.5 border ${uploadMode === "text" ? "border-[var(--wz-gold)] text-[var(--wz-gold)]" : "border-[var(--wz-border)] text-[var(--wz-text-tertiary)]"}`}
                  data-testid="upload-mode-text"
                >
                  Paste text
                </button>
              </div>

              {uploadMode === "binary" ? (
                <label className="block mb-3">
                  <div className="overline mb-1">Select file (≤ 25 MB)</div>
                  <input
                    id="dealroom-file-input"
                    required
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.csv"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="wz-input text-xs"
                    data-testid="upload-file-input"
                  />
                  {uploadFile && (
                    <div className="mt-2 text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
                      {uploadFile.name} · {(uploadFile.size / 1024).toFixed(1)} KB · {uploadFile.type || "binary"}
                    </div>
                  )}
                </label>
              ) : (
                <>
                  <label className="block mb-3">
                    <div className="overline mb-1">Filename</div>
                    <input required className="wz-input" value={upload.filename} onChange={(e) => setUpload({ ...upload, filename: e.target.value })} placeholder="MSA_TopClient_2025.txt" data-testid="upload-filename" />
                  </label>
                  <label className="block mb-3">
                    <div className="overline mb-1">Extracted text content</div>
                    <textarea required rows={5} className="wz-input font-mono-wz text-xs" value={upload.content} onChange={(e) => setUpload({ ...upload, content: e.target.value })} placeholder="Paste the document text here" data-testid="upload-content" />
                  </label>
                </>
              )}

              <label className="block mb-3">
                <div className="overline mb-1">Folder</div>
                <select className="wz-input" value={upload.folder} onChange={(e) => setUpload({ ...upload, folder: e.target.value })} data-testid="upload-folder">
                  {FOLDERS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
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
              <MagnifyingGlass size={18} className={accentClass} />
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
                      <blockquote className="mt-3 border-l-2 border-[var(--wz-gold)] pl-4 text-xs italic text-[var(--wz-text-secondary)]" data-testid={`citation-${f.id}`}>
                        <span className="font-mono-wz text-[var(--wz-gold)] not-italic">
                          {f.citation.filename}{f.citation.page ? ` · p.${f.citation.page}` : ""}
                        </span>
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

      {/* TAB: Co-pilot */}
      {tab === "copilot" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6" data-testid="copilot-tab">
          <div className="wz-card flex flex-col" style={{ minHeight: "520px" }}>
            <div className="px-5 py-3 border-b border-[var(--wz-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChatCircleDots size={16} className={accentClass} />
                <div className="font-display tracking-tight">Vault Co-pilot</div>
              </div>
              <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">
                grounded in {room.files.length} file{room.files.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" data-testid="copilot-messages">
              {messages.length === 0 && (
                <div className="text-center text-sm text-[var(--wz-text-tertiary)] py-12">
                  Ask the Co-pilot anything about the uploaded materials. Answers cite the source file in brackets.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.role}`}>
                  <div className={`max-w-[78%] px-4 py-3 border ${
                    m.role === "user"
                      ? "border-[var(--wz-border)] bg-[var(--wz-surface-hover)]"
                      : "border-[var(--wz-gold)]/40 bg-[var(--wz-bg)]"
                  }`}>
                    <div className="overline mb-1">{m.role === "user" ? m.user_name || "you" : "Co-pilot"}</div>
                    <div className="text-sm leading-relaxed whitespace-pre-line">{m.content}</div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-[var(--wz-border)] flex flex-wrap gap-2">
                        {m.citations.map((c) => (
                          <span key={c.file_id} className="pill pill-gold">{c.filename}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {asking && (
                <div className="flex justify-start">
                  <div className="max-w-[78%] px-4 py-3 border border-[var(--wz-border)] flex items-center gap-2 text-xs text-[var(--wz-text-secondary)]">
                    <div className="dot-blink" /> Co-pilot is reading the documents…
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={askCopilot} className="border-t border-[var(--wz-border)] px-5 py-3 flex gap-2" data-testid="copilot-form">
              <input
                placeholder={room.files.length === 0 ? "Upload files first to enable the Co-pilot…" : "Ask anything about the documents…"}
                className="wz-input flex-1"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={asking || room.status === "pending_nda"}
                data-testid="copilot-input"
              />
              <button
                type="submit"
                disabled={asking || !question.trim() || room.status === "pending_nda"}
                className="wz-btn wz-btn-gold flex items-center gap-2"
                data-testid="copilot-send"
              >
                <PaperPlaneTilt size={14} /> {asking ? "…" : "Ask"}
              </button>
            </form>
          </div>

          <div className="wz-card p-5 h-fit" data-testid="copilot-hints">
            <div className="overline mb-3">Try asking</div>
            <div className="space-y-2 text-xs">
              {[
                "What's the customer concentration risk?",
                "Are there any unusual termination clauses?",
                "Summarize the financial highlights",
                "Flag any IP or compliance issues",
                "What's missing from the Vault?",
              ].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setQuestion(hint)}
                  className="block w-full text-left px-3 py-2 border border-[var(--wz-border)] hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] transition-colors"
                  data-testid={`hint-${hint.slice(0, 20)}`}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
