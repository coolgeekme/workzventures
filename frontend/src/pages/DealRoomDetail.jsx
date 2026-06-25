import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  FileText, Files, MagnifyingGlass, ListChecks, ShieldCheck,
  CloudArrowUp, CheckCircle, Warning, ArrowLeft, ChatCircleDots, PaperPlaneTilt,
  Certificate, Clock, Eye, Lock, LockOpen,
} from "@phosphor-icons/react";
import { UPLOAD_ACCEPT, UPLOAD_HINT, UPLOAD_MAX_MB } from "../lib/uploadConfig";
import VaultActivity from "../components/VaultActivity";
import PdfPreview from "../components/PdfPreview";

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
  const [previewFile, setPreviewFile] = useState(null);
  // Page to deep-link to inside the PDF preview modal. Set by Co-pilot
  // citation clicks so [filename p.3] jumps straight to page 3.
  const [previewPage, setPreviewPage] = useState(1);
  // Findings snapshots (iter-34): list of completed Analyze runs, the
  // selected snapshot's job_id (latest by default), the diff vs prior,
  // and the count of files added since the latest run (drives the
  // "Re-analyze" banner).
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
  const [snapshotDetail, setSnapshotDetail] = useState(null); // { job, findings, diff }
  const [freshFilesCount, setFreshFilesCount] = useState(0);
  const [emailModal, setEmailModal] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [emailing, setEmailing] = useState(false);

  const load = () => api.get(`/deal-rooms/${id}`).then((r) => setRoom(r.data));
  const loadCopilot = () => api.get(`/deal-rooms/${id}/copilot`).then((r) => setMessages(r.data));
  const loadSnapshots = async () => {
    try {
      const r = await api.get(`/deal-rooms/${id}/findings-snapshots`);
      setSnapshots(r.data.snapshots || []);
      setFreshFilesCount(r.data.fresh_files_since_last_run || 0);
      // Auto-select the latest snapshot the first time we load.
      if ((r.data.snapshots || []).length > 0 && !selectedSnapshotId) {
        setSelectedSnapshotId(r.data.snapshots[0].id);
      }
    } catch { /* no snapshots yet */ }
  };
  const loadSnapshotDetail = async (jobId) => {
    if (!jobId) { setSnapshotDetail(null); return; }
    try {
      const r = await api.get(`/deal-rooms/${id}/findings-snapshots/${jobId}`);
      setSnapshotDetail(r.data);
    } catch { setSnapshotDetail(null); }
  };

  useEffect(() => {
    load();
    loadCopilot();
    loadSnapshots();
    api.get("/drl-templates").then((r) => setTemplates(r.data));
  }, [id]);

  // Load the selected snapshot's full detail (findings + diff vs prior)
  // when the user picks a different version from the dropdown.
  useEffect(() => {
    if (selectedSnapshotId) loadSnapshotDetail(selectedSnapshotId);
  }, [selectedSnapshotId]);

  // On mount, if a findings job is already in flight for this room (e.g.
  // user refreshed the page mid-run), re-attach to the polling loop so
  // they see the result land instead of being stranded.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const jr = await api.get(`/deal-rooms/${id}/findings-job`);
        const job = jr.data;
        if (cancelled || !job || !job.id) return;
        if (job.status !== "pending" && job.status !== "running") return;
        setBusy(true);
        toast.info("Resuming analysis already in progress…");
        while (!cancelled) {
          await new Promise((res) => setTimeout(res, 2500));
          let cur;
          try {
            cur = (await api.get(`/deal-rooms/${id}/findings-job/${job.id}`)).data;
          } catch { continue; }
          if (cur.status === "completed") {
            toast.success(`${cur.findings_count} findings generated`);
            await load();
            break;
          }
          if (cur.status === "failed") {
            toast.error(cur.error || "Analysis failed");
            break;
          }
        }
        setBusy(false);
      } catch { /* no in-flight job, nothing to do */ }
    })();
    return () => { cancelled = true; };
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

  const downloadCertificate = async () => {
    setBusy(true);
    try {
      const r = await api.get(`/deal-rooms/${id}/certificate`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (room?.listing_name || "deal").toLowerCase().replace(/\s+/g, "-");
      a.href = url;
      a.download = `workz-provenance-${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Provenance certificate downloaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not generate certificate");
    } finally {
      setBusy(false);
    }
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
      // Kick off the background job. We get back a job_id immediately —
      // Cloudflare's 100s edge timeout no longer matters because the AI
      // analysis runs in a background task and we just poll for status.
      const r = await api.post(`/deal-rooms/${id}/generate-findings`);
      const jobId = r.data.job_id;
      if (r.data.already_running) {
        toast.info("An analysis is already running — picking up where it left off…");
      } else {
        toast.info(`Analyzing ${r.data.files_to_analyze || ""} file${r.data.files_to_analyze === 1 ? "" : "s"}… we'll notify you the moment it completes.`);
      }
      // Poll every 2.5s. No client-side timeout — sellers can have
      // hundreds of large files and the Claude pass may take minutes.
      const pollFor = async (jid) => {
        while (true) {
          await new Promise((res) => setTimeout(res, 2500));
          let job;
          try {
            const jr = await api.get(`/deal-rooms/${id}/findings-job/${jid}`);
            job = jr.data;
          } catch (err) {
            // Network blip — keep polling rather than aborting. The job
            // is still running server-side.
            continue;
          }
          if (job.status === "completed") {
            toast.success(`${job.findings_count} findings generated from ${job.files_analyzed} files`);
            await load();
            // Reload snapshots so the new run shows up in the picker.
            await loadSnapshots();
            // Force the new snapshot to be selected — it'll be `job.id`.
            setSelectedSnapshotId(jid);
            return;
          }
          if (job.status === "failed") {
            toast.error(job.error || "Analysis failed");
            return;
          }
          // status pending|running → keep polling
        }
      };
      await pollFor(jobId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start analysis");
    } finally {
      setBusy(false);
    }
  };

  // PDF export — backend streams `application/pdf` with a content-disposition
  // header. We use fetch + blob so the URL retains the Bearer token via the
  // axios interceptor, then trigger a hidden anchor download.
  const exportFindingsPdf = async () => {
    if (!selectedSnapshotId) return;
    try {
      const r = await api.get(
        `/deal-rooms/${id}/findings-snapshots/${selectedSnapshotId}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      const cd = r.headers["content-disposition"] || "";
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m ? m[1] : `Findings_${selectedSnapshotId.slice(0, 8)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "PDF export failed");
    }
  };

  const sendFindingsEmail = async () => {
    const recipients = emailRecipients.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) { toast.error("Add at least one recipient"); return; }
    setEmailing(true);
    try {
      const r = await api.post(
        `/deal-rooms/${id}/findings-snapshots/${selectedSnapshotId}/email`,
        { recipients, note: emailNote || undefined },
      );
      toast.success(`Sent to ${r.data.sent} recipient${r.data.sent === 1 ? "" : "s"}`);
      if (r.data.failures?.length) {
        toast.warning(`${r.data.failures.length} delivery failure(s) — check spam / addresses`);
      }
      setEmailModal(false);
      setEmailRecipients("");
      setEmailNote("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Email send failed");
    } finally {
      setEmailing(false);
    }
  };

  const askCopilot = async (e) => {
    e?.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    const q = question;
    setQuestion("");
    try {
      // Kick off background job — returns {job_id, user_message} immediately.
      // Cloudflare's 100s edge timeout no longer applies because Claude
      // runs in a background task on the server.
      const r = await api.post(`/deal-rooms/${id}/copilot`, { message: q });
      const { job_id: jobId, user_message } = r.data;
      // Render the buyer's question right away so the chat feels live.
      setMessages((prev) => [...prev, user_message]);
      // Poll until terminal. No client-side timeout — big vaults can take
      // several minutes to analyze and that's expected.
      while (true) {
        await new Promise((res) => setTimeout(res, 2500));
        let job;
        try {
          job = (await api.get(`/deal-rooms/${id}/copilot-job/${jobId}`)).data;
        } catch {
          continue; // transient network blip — keep polling
        }
        if (job.status === "completed") {
          // Re-fetch the message history so the new assistant message
          // (written by the background task) appears with citations.
          await loadCopilot();
          break;
        }
        if (job.status === "failed") {
          toast.error(job.error || "Co-pilot failed");
          break;
        }
        // pending|running → keep polling
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Co-pilot failed");
      setQuestion(q);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div data-testid="deal-room-detail" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
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
        <div className="flex items-center gap-2 shrink-0">
          {isParticipant && (room.status === "active" || (isSeller && room.status === "pending_nda")) && (
            <button
              onClick={() => {
                setTab("files");
                setTimeout(() => {
                  document.querySelector('[data-testid="upload-form"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
                  document.querySelector('[data-testid="upload-file-input"]')?.focus();
                }, 50);
              }}
              data-testid="header-upload-btn"
              title="Upload a document into this Vault"
              className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
            >
              <CloudArrowUp size={14} /> <span className="hidden sm:inline">Upload document</span><span className="sm:hidden">Upload</span>
            </button>
          )}
          <button
            onClick={downloadCertificate}
            disabled={busy || room.status === "pending_nda"}
            data-testid="download-certificate-btn"
            title={room.status === "pending_nda" ? "Sign NDA to unlock the certificate" : "Download Bitcoin-anchored Provenance Certificate (PDF)"}
            className="wz-btn-ghost wz-btn text-xs flex items-center gap-2"
          >
            <Certificate size={14} /> <span className="hidden sm:inline">Provenance certificate</span><span className="sm:hidden">Certificate</span>
          </button>
          <span className={`pill ${room.status === "active" ? "pill-positive" : room.status === "closed" ? "pill-gold" : room.status === "preview" ? "pill-amber" : "pill-amber"}`}>
            {room.status.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Preview Vault banner — agent / seller QA mode */}
      {room.is_preview && (
        <div
          data-testid="preview-vault-banner"
          className="mb-6 px-4 py-3 border-2 border-dashed border-[var(--wz-gold)] bg-[var(--wz-gold)]/10 text-xs flex items-start gap-3"
        >
          <ShieldCheck size={18} className="text-[var(--wz-gold)] shrink-0 mt-0.5" />
          <div className="leading-relaxed text-[var(--wz-text-secondary)]">
            <strong className="text-[var(--wz-gold)]">Preview Vault.</strong>{" "}
            You&apos;re viewing this listing&apos;s Vault as a buyer would — NDA auto-accepted,
            staged docs cloned in. Use this to QA the buyer experience (Copilot, DRL,
            findings) before a real buyer engages. Activity here is flagged{" "}
            <code className="font-mono-wz">is_preview</code> and excluded from real deal metrics.
          </div>
        </div>
      )}

      {/* NDA gate */}
      {room.status === "pending_nda" && isBuyer && (
        <div className="wz-card p-6 mb-6 border-[var(--wz-amber)]" data-testid="nda-gate">
          <div className="flex items-start gap-4">
            <ShieldCheck size={28} className="text-[var(--wz-amber)] shrink-0 mt-1" />
            <div className="flex-1">
              <div className="font-display text-xl tracking-tight">Non-disclosure agreement required</div>
              <div className="mt-3 text-sm text-[var(--wz-text-secondary)] leading-relaxed border border-[var(--wz-border)] p-4 max-h-48 overflow-y-auto" data-testid="nda-terms">
                <p className="mb-2">This Confidentiality Agreement (this <span className="text-white">&ldquo;Agreement&rdquo;</span>) is entered into between <span className="text-white">{room.seller_org || room.seller_name}</span> (&ldquo;Disclosing Party&rdquo;) and <span className="text-white">{user.organization || user.name}</span> (&ldquo;Receiving Party&rdquo;), effective on the date of execution below.</p>
                <p className="mb-2"><span className="text-white">1. Confidential Information.</span> All financial, legal, operational, technical, customer, and employee data shared in connection with the proposed transaction concerning <span className="text-white">{room.listing_name}</span> is &ldquo;Confidential Information.&rdquo;</p>
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
        <div className="wz-card p-5 mb-6 text-sm text-[var(--wz-text-secondary)]" data-testid="seller-pending-nda-banner">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="text-[var(--wz-amber)] mt-0.5 shrink-0" />
            <div>
              <div className="text-white font-medium mb-1">
                Stage your data room while waiting for <span className="italic">{room.buyer_name}</span> to sign the NDA.
              </div>
              <div>
                You can upload documents and apply a DRL template now — they stay locked from the buyer until the NDA is e-signed. Findings, Co-pilot, and buyer downloads unlock automatically on signature.
              </div>
            </div>
          </div>
        </div>
      )}
      {room.status === "active" && room.nda_signed_name && (
        <div className="wz-card p-3 mb-6 text-xs text-[var(--wz-text-tertiary)] flex items-center gap-2" data-testid="nda-signed-badge">
          <ShieldCheck size={14} className="text-[var(--wz-positive)]" />
          NDA e-signed by <span className="text-white" style={{ fontStyle: "italic" }}>{room.nda_signed_name}</span> · {new Date(room.nda_accepted_by_buyer_at).toLocaleString()}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[var(--wz-border)] flex gap-1 overflow-x-auto -mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 lg:px-0 scrollbar-thin" data-testid="tabs">
        {[
          { v: "files", l: "Files", icon: Files, count: room.files.length },
          { v: "drl", l: "DRL", icon: ListChecks, count: room.requests.length },
          { v: "findings", l: "Findings", icon: MagnifyingGlass, count: room.findings.length },
          { v: "copilot", l: "Co-pilot", icon: ChatCircleDots, count: messages.length },
          { v: "activity", l: "Activity", icon: Clock, count: null },
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
              {t.count !== null && (
                <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">{t.count}</span>
              )}
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
                const downloadAllowed = f.download_allowed !== false ? f.download_allowed === true : false;
                const canDownload = isSeller || user?.role === "admin" || downloadAllowed;
                const onDownload = async (e) => {
                  e?.preventDefault?.();
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
                const onToggleAccess = async () => {
                  try {
                    await api.patch(`/deal-rooms/${id}/files/${f.id}/access`, {
                      download_allowed: !downloadAllowed,
                    });
                    toast.success(downloadAllowed
                      ? "Download disabled — buyer can preview but not download"
                      : "Download enabled — buyer can save this file");
                    load();
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Access policy update failed");
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
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      {f.matched_request_id && (
                        <span className="pill pill-positive flex items-center gap-1"><CheckCircle size={10} weight="fill" /> matched</span>
                      )}
                      {/* Access policy pill — visible to everyone, makes the buyer's expectations explicit. */}
                      <span
                        className="pill text-[10px] inline-flex items-center gap-1"
                        style={downloadAllowed
                          ? { background: "rgba(34,197,94,0.10)", color: "var(--wz-positive,#22C55E)", border: "1px solid var(--wz-positive,#22C55E)" }
                          : { background: "rgba(245,158,11,0.10)", color: "var(--wz-amber,#F59E0B)", border: "1px solid var(--wz-amber,#F59E0B)" }}
                        title={downloadAllowed ? "Download enabled" : "View-only — buyer cannot download"}
                        data-testid={`file-access-pill-${f.id}`}
                      >
                        {downloadAllowed ? <LockOpen size={10} /> : <Lock size={10} />}
                        {downloadAllowed ? "Download" : "View-only"}
                      </span>
                      {/* Seller-only toggle. Admin can also toggle. */}
                      {(isSeller || user?.role === "admin") && (
                        <button
                          onClick={onToggleAccess}
                          className="text-[10px] text-[var(--wz-text-secondary)] hover:text-white underline underline-offset-2"
                          data-testid={`toggle-access-${f.id}`}
                          title={downloadAllowed ? "Disable download for buyer" : "Allow buyer to download"}
                        >
                          {downloadAllowed ? "Disable" : "Allow"}
                        </button>
                      )}
                      {/* Preview is offered for any file with bytes OR
                          extracted text (seed/legacy files lack gridfs_id
                          but have extracted text — backend serves them). */}
                      {(f.gridfs_id || f.has_text) && (
                        <button
                          onClick={() => { setPreviewPage(1); setPreviewFile(f); }}
                          className="text-xs text-[var(--wz-text-secondary)] hover:text-white inline-flex items-center gap-1"
                          data-testid={`preview-${f.id}`}
                        >
                          <Eye size={12} /> Preview
                        </button>
                      )}
                      {f.gridfs_id && canDownload && (
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

          {/* Upload — seller may stage pre-NDA; buyer waits for NDA sign-off */}
          {isParticipant && (room.status === "active" || (isSeller && room.status === "pending_nda")) && (
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
                  File upload
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
                  <div className="overline mb-1">Select file (≤ {UPLOAD_MAX_MB} MB)</div>
                  <div className="text-[10px] text-[var(--wz-text-tertiary)] mb-1">{UPLOAD_HINT}</div>
                  <input
                    id="dealroom-file-input"
                    required
                    type="file"
                    accept={UPLOAD_ACCEPT}
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
                  <div key={r.id} className="px-5 py-3 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_100px] gap-2 sm:gap-4 items-start sm:items-center" data-testid={`drl-${r.id}`}>
                    <div>
                      <div className="text-sm">{r.title}</div>
                      <div className="overline mt-1">{r.workstream}</div>
                    </div>
                    <div className="hidden sm:block text-xs font-mono-wz text-[var(--wz-text-tertiary)]">
                      {r.matched_file_ids.length} file{r.matched_file_ids.length === 1 ? "" : "s"}
                    </div>
                    <span className={`pill ${r.status === "satisfied" ? "pill-positive" : "pill-amber"} shrink-0`}>{r.status}</span>
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
      {tab === "findings" && (() => {
        // Source of truth: when a snapshot is selected we render its findings;
        // otherwise fall back to room.findings (latest snapshot or legacy).
        const displayedFindings = snapshotDetail?.findings || room.findings;
        const activeJob = snapshotDetail?.job || room.latest_findings_snapshot;
        const diff = snapshotDetail?.diff;
        const execSummary = activeJob?.executive_summary;
        const sevBreakdown = activeJob?.severity_breakdown || { high: 0, medium: 0, low: 0 };
        const hasSnapshots = snapshots.length > 0;
        return (
        <div className="mt-6">
          {/* Smart banner: prompt re-analysis when ≥1 new file uploaded since latest run */}
          {hasSnapshots && freshFilesCount > 0 && isBuyer && (
            <div className="wz-card p-3 mb-4 border-l-2 border-[var(--wz-gold)] flex items-center justify-between gap-3 flex-wrap" data-testid="findings-fresh-banner">
              <div className="text-xs text-[var(--wz-text-secondary)]">
                <span className="font-mono-wz text-[var(--wz-gold)]">{freshFilesCount}</span> new file{freshFilesCount === 1 ? "" : "s"} since the last analysis · re-run to see fresh findings
              </div>
              <button
                onClick={generateFindings}
                disabled={busy}
                className="wz-btn wz-btn-secondary text-xs"
                data-testid="findings-fresh-rerun"
              >
                {busy ? "Re-analyzing…" : "Re-analyze"}
              </button>
            </div>
          )}

          <div className="wz-card p-5 mb-6" data-testid="findings-bar">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <MagnifyingGlass size={18} className={accentClass} />
                <div>
                  <div className="font-display tracking-tight">AI-generated diligence findings</div>
                  <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
                    Reads every uploaded file, returns risks with severity + workstream + cited excerpt.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hasSnapshots && (
                  <select
                    value={selectedSnapshotId || ""}
                    onChange={(e) => setSelectedSnapshotId(e.target.value)}
                    className="wz-input text-xs"
                    data-testid="findings-snapshot-picker"
                  >
                    {snapshots.map((s, i) => {
                      const dt = new Date(s.finished_at || s.created_at);
                      const label = i === 0
                        ? `Latest · ${dt.toLocaleDateString()} · ${s.findings_count || 0} findings`
                        : `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${s.findings_count || 0} findings`;
                      return <option key={s.id} value={s.id}>{label}</option>;
                    })}
                  </select>
                )}
                {selectedSnapshotId && (
                  <>
                    <button
                      onClick={exportFindingsPdf}
                      className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
                      data-testid="findings-export-pdf"
                      title="Download branded PDF report"
                    >
                      Export PDF
                    </button>
                    <button
                      onClick={() => setEmailModal(true)}
                      className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
                      data-testid="findings-email"
                      title="Email PDF to your team"
                    >
                      Email…
                    </button>
                  </>
                )}
                {isBuyer && (
                  <button onClick={generateFindings} disabled={busy || room.files.length === 0} className="wz-btn wz-btn-gold flex items-center gap-2 text-xs" data-testid="generate-findings">
                    {busy ? "Analyzing…" : hasSnapshots ? "Re-analyze" : "Generate findings"}
                  </button>
                )}
              </div>
            </div>
            {/* Severity breakdown + diff badge */}
            {activeJob && (
              <div className="mt-4 flex items-center gap-2 flex-wrap text-xs">
                <span className="pill pill-negative">{sevBreakdown.high || 0} high</span>
                <span className="pill pill-amber">{sevBreakdown.medium || 0} medium</span>
                <span className="pill pill-gold">{sevBreakdown.low || 0} low</span>
                {diff && (
                  <span className="text-[var(--wz-text-secondary)] ml-2" data-testid="findings-diff-badge">
                    vs prior:{" "}
                    {diff.new > 0 && <span className="text-[var(--wz-negative)]">+{diff.new} new</span>}
                    {diff.new > 0 && (diff.resolved > 0 || diff.unchanged > 0) && " · "}
                    {diff.resolved > 0 && <span className="text-[var(--wz-positive)]">-{diff.resolved} resolved</span>}
                    {diff.resolved > 0 && diff.unchanged > 0 && " · "}
                    {diff.unchanged > 0 && <span>{diff.unchanged} unchanged</span>}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Executive summary card */}
          {execSummary && (
            <div className="wz-card p-5 mb-6 border-l-2 border-[var(--wz-gold)]" data-testid="findings-exec-summary">
              <div className="overline mb-1">Executive summary</div>
              <p className="text-sm leading-relaxed">{execSummary}</p>
            </div>
          )}

          <div className="space-y-3" data-testid="findings-list">
            {displayedFindings.map((f) => (
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
                    {f.citation?.filename && (() => {
                      const cited = (room?.files || []).find(
                        (rf) => rf.id === f.citation.file_id || rf.filename === f.citation.filename,
                      );
                      const pageNum = Math.max(1, Number(f.citation.page) || 1);
                      const canOpen = !!cited;
                      return (
                        <blockquote
                          className="mt-3 border-l-2 border-[var(--wz-gold)] pl-4 text-xs italic text-[var(--wz-text-secondary)]"
                          data-testid={`citation-${f.id}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!canOpen) return;
                              setPreviewPage(pageNum);
                              setPreviewFile(cited);
                            }}
                            disabled={!canOpen}
                            title={canOpen
                              ? `Open ${f.citation.filename} at page ${pageNum}`
                              : `${f.citation.filename} — file no longer in vault`}
                            data-testid={`finding-citation-open-${f.id}`}
                            className={`font-mono-wz text-[var(--wz-gold)] not-italic ${
                              canOpen ? "hover:underline cursor-pointer" : "opacity-60 cursor-not-allowed"
                            }`}
                          >
                            {f.citation.filename}{f.citation.page ? ` · p.${f.citation.page}` : ""}
                          </button>
                          {f.citation.excerpt && <> — &ldquo;{f.citation.excerpt}&rdquo;</>}
                        </blockquote>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ))}
            {displayedFindings.length === 0 && (
              <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
                No findings yet — {isBuyer ? "tap Generate findings above once files are uploaded." : "the buyer will run the analysis after files are exchanged."}
              </div>
            )}
          </div>
        </div>
        );
      })()}

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
                        {m.citations.map((c, ci) => {
                          // Resolve the cited file to the real row so we
                          // can pass it to PdfPreview. Citations from
                          // older messages may carry only `filename`, so
                          // fall back to a name match.
                          const cited = (room?.files || []).find(
                            (rf) => rf.id === c.file_id || rf.filename === c.filename,
                          );
                          const pageNum = Math.max(1, Number(c.page) || 1);
                          const disabled = !cited;
                          return (
                            <button
                              key={`${c.file_id || c.filename}-${pageNum}-${ci}`}
                              type="button"
                              onClick={() => {
                                if (!cited) return;
                                setPreviewPage(pageNum);
                                setPreviewFile(cited);
                              }}
                              disabled={disabled}
                              title={disabled
                                ? `${c.filename} — file no longer in vault`
                                : `Open ${c.filename} at page ${pageNum}`}
                              data-testid={`copilot-citation-${m.id}-${ci}`}
                              className={`pill pill-gold transition-colors ${
                                disabled
                                  ? "opacity-50 cursor-not-allowed"
                                  : "hover:bg-[var(--wz-gold)] hover:text-[var(--wz-bg)] cursor-pointer"
                              }`}
                            >
                              {c.filename}
                              {pageNum > 1 && (
                                <span className="opacity-70 ml-1">· p.{pageNum}</span>
                              )}
                            </button>
                          );
                        })}
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
                data-copilot-status={asking ? "analyzing" : "idle"}
              >
                <PaperPlaneTilt size={14} /> {asking ? "Analyzing…" : "Ask"}
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

      {/* TAB: Activity — Bitcoin-anchored audit trail of every Vault action */}
      {tab === "activity" && (
        <VaultActivity roomId={id} accentClass={accentClass} />
      )}

      {/* Email findings PDF modal */}
      {emailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !emailing && setEmailModal(false)}
          data-testid="email-findings-modal"
        >
          <div
            className="wz-card max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-display tracking-tight text-lg">Email findings report</div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
                  Sends a branded PDF of this snapshot via NextCapOS. Each delivery is logged.
                </div>
              </div>
              <button
                type="button"
                onClick={() => !emailing && setEmailModal(false)}
                className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text-primary)]"
                data-testid="email-findings-close"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="overline block mb-1">Recipients</label>
                <input
                  type="text"
                  placeholder="alice@firm.com, bob@firm.com"
                  className="wz-input w-full text-sm"
                  value={emailRecipients}
                  onChange={(e) => setEmailRecipients(e.target.value)}
                  disabled={emailing}
                  data-testid="email-findings-recipients"
                />
                <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-1">
                  Comma, semicolon or space separated · max 10
                </div>
              </div>
              <div>
                <label className="overline block mb-1">Note (optional)</label>
                <textarea
                  rows={3}
                  placeholder="Sharing the latest diligence findings for review…"
                  className="wz-input w-full text-sm"
                  value={emailNote}
                  onChange={(e) => setEmailNote(e.target.value)}
                  disabled={emailing}
                  data-testid="email-findings-note"
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmailModal(false)}
                disabled={emailing}
                className="wz-btn wz-btn-secondary text-xs"
                data-testid="email-findings-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendFindingsEmail}
                disabled={emailing || !emailRecipients.trim()}
                className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
                data-testid="email-findings-send"
              >
                {emailing ? "Sending…" : "Send PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Watermarked in-browser PDF / Office preview modal */}
      <PdfPreview
        open={!!previewFile}
        onClose={() => { setPreviewFile(null); setPreviewPage(1); }}
        roomId={id}
        file={previewFile}
        initialPage={previewPage}
        onDownload={async () => {
          if (!previewFile) return;
          try {
            const resp = await api.get(`/deal-rooms/${id}/files/${previewFile.id}/download`, { responseType: "blob" });
            const blob = new Blob([resp.data], { type: previewFile.content_type || "application/octet-stream" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = previewFile.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
          } catch (err) {
            toast.error(err?.response?.data?.detail || "Download failed");
          }
        }}
      />
    </div>
  );
}
