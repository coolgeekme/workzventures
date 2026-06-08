import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkle, PaperPlaneTilt, FileText, Lock, Upload, Trash, DownloadSimple, X,
} from "@phosphor-icons/react";
import { api, API } from "../lib/api";
import PrivateLockerUploadModal from "./PrivateLockerUploadModal";

const SUGGESTIONS = [
  "What are the strongest signals in what we have?",
  "What are the top three risks and how would I diligence each?",
  "What's missing from this picture — what should I research next?",
];

export default function ResearchCompanion({ researchId, companyName }) {
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const scrollRef = useRef(null);

  const loadAll = async () => {
    try {
      const [hist, lock] = await Promise.all([
        api.get(`/research/${researchId}/copilot`),
        api.get(`/research/${researchId}/locker`),
      ]);
      setMessages(hist.data || []);
      setFiles(lock.data || []);
    } catch (err) {
      // soft-fail; both endpoints 403 for sellers
    }
  };

  useEffect(() => { if (researchId) loadAll(); }, [researchId]); // eslint-disable-line

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);
    try {
      const r = await api.post(`/research/${researchId}/copilot`, { message: q });
      setMessages((m) => [...m, r.data.user_message, r.data.assistant_message]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Companion failed");
    } finally { setSending(false); }
  };

  const removeFile = async (fid) => {
    if (!window.confirm("Remove this file from your research locker?")) return;
    try {
      await api.delete(`/private-locker/files/${fid}`);
      setFiles((arr) => arr.filter((f) => f.id !== fid));
    } catch (err) {
      toast.error("Delete failed");
    }
  };

  const download = async (f) => {
    try {
      const token = localStorage.getItem("wz_token");
      const res = await fetch(`${API}/private-locker/files/${f.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Download failed");
    }
  };

  return (
    <div data-testid="research-companion" className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
      {/* Chat column */}
      <div className="wz-card p-0 overflow-hidden flex flex-col" style={{ minHeight: 460 }}>
        <div className="px-4 py-3 border-b border-[var(--wz-border)] flex items-center gap-2">
          <Sparkle size={16} className="text-[var(--wz-gold)]" weight="fill" />
          <div>
            <div className="text-sm font-medium">Research Companion</div>
            <div className="text-[10px] text-[var(--wz-text-tertiary)]">
              Buyer-only AI grounded on your brief, detailed analysis, and locker docs for <span className="text-[var(--wz-text-secondary)]">{companyName}</span>.
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="companion-messages">
          {messages.length === 0 && (
            <div className="text-xs text-[var(--wz-text-tertiary)] text-center py-8">
              No conversation yet. Ask anything — or tap a suggestion below.
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              data-testid={`companion-msg-${m.role}`}
              className={`text-sm leading-relaxed ${m.role === "user" ? "text-[var(--wz-text)]" : "text-[var(--wz-text-secondary)]"}`}
            >
              <div className="text-[10px] uppercase tracking-widest text-[var(--wz-text-tertiary)] mb-1">
                {m.role === "user" ? "You" : "Companion"}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.citations?.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.citations.map((c, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] px-1.5 py-0.5 border border-[var(--wz-gold)]/40 text-[var(--wz-gold)]"
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="text-xs text-[var(--wz-text-tertiary)] italic">Companion is thinking…</div>
          )}
        </div>

        {/* Suggestions */}
        {messages.length === 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="text-[11px] border border-[var(--wz-border)] hover:border-[var(--wz-gold)] px-2.5 py-1 text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)]"
                data-testid="companion-suggestion"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="border-t border-[var(--wz-border)] p-3 flex items-center gap-2"
        >
          <input
            data-testid="companion-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this company…"
            className="wz-input flex-1 text-sm"
          />
          <button
            data-testid="companion-send"
            type="submit"
            disabled={sending || !input.trim()}
            className="wz-btn wz-btn-gold text-xs disabled:opacity-50"
          >
            <PaperPlaneTilt size={12} /> Send
          </button>
        </form>
      </div>

      {/* Sidebar: locker files for this research */}
      <div className="wz-card p-0 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--wz-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-[var(--wz-gold)]" />
            <div className="text-sm font-medium">Locker · this company</div>
          </div>
          <button
            data-testid="companion-add-doc"
            onClick={() => setUploadOpen(true)}
            className="text-[11px] inline-flex items-center gap-1 border border-[var(--wz-border)] hover:border-[var(--wz-gold)] px-2 py-1"
          >
            <Upload size={11} /> Add
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {files.length === 0 ? (
            <div className="text-[11px] text-[var(--wz-text-tertiary)] text-center py-6 px-3 leading-relaxed">
              No private docs attached yet. Drop call notes, third-party reports, internal models —
              they&apos;ll be fed to the Companion automatically.
            </div>
          ) : (
            files.map((f) => (
              <div
                key={f.id}
                data-testid={`companion-file-${f.id}`}
                className="border border-[var(--wz-border)] px-2.5 py-2 mb-1.5 text-xs hover:border-[var(--wz-gold)]/50 transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <FileText size={12} className="text-[var(--wz-gold)] shrink-0" />
                  <div className="font-medium truncate" title={f.filename}>{f.filename}</div>
                </div>
                {f.note && (
                  <div className="text-[10px] text-[var(--wz-text-tertiary)] italic mt-1 line-clamp-2">{f.note}</div>
                )}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <button
                    onClick={() => download(f)}
                    className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)] p-1"
                    title="Download"
                  >
                    <DownloadSimple size={11} />
                  </button>
                  <button
                    onClick={() => removeFile(f.id)}
                    className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-rose)] p-1"
                    title="Remove"
                  >
                    <Trash size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {uploadOpen && (
        <PrivateLockerUploadModal
          listings={[]}
          defaultResearchId={researchId}
          defaultAttach="research"
          onClose={() => setUploadOpen(false)}
          onUploaded={(doc) => {
            setFiles((arr) => [doc, ...arr]);
            toast.success("Attached to this research target");
            setUploadOpen(false);
          }}
        />
      )}
    </div>
  );
}
