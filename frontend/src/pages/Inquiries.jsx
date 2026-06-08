import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Buildings, FileText, Trash, CaretDown, CaretUp, ChatCircleDots,
  PaperPlaneTilt, Paperclip, Info,
} from "@phosphor-icons/react";
import {
  INQUIRY_STATUS_LABEL,
  INQUIRY_STATUS_DESCRIPTION,
  INQUIRY_TRIAGE_LABEL,
  INQUIRY_TRIAGE_CONFIRM,
  inquiryStatusLabel,
} from "../lib/inquiryStatus";

const STATUSES = ["new", "reviewing", "engaged", "passed"];

export default function Inquiries() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [pushing, setPushing] = useState(null);
  const [openThread, setOpenThread] = useState(null);
  const isSeller = user?.role === "seller";

  const load = () => api.get("/inquiries").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const setStatus = async (i, status) => {
    if (INQUIRY_TRIAGE_CONFIRM[status]) {
      if (!window.confirm(INQUIRY_TRIAGE_CONFIRM[status])) return;
    }
    try {
      await api.patch(`/inquiries/${i.id}/status`, { status });
      toast.success(`${i.buyer_name} → ${inquiryStatusLabel(status)}`);
      load();
    } catch (err) {
      toast.error("Update failed");
    }
  };

  const pushToZoho = async (i) => {
    setPushing(i.id);
    try {
      const r = await api.post(`/composio/zoho/push-lead/${i.id}`);
      toast.success(r.data.pushed_to_zoho ? `${i.buyer_name} pushed to Zoho` : `${i.buyer_name} recorded locally — connect Zoho to push live`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Zoho push failed");
    } finally {
      setPushing(null);
    }
  };

  const openRoom = async (i) => {
    try {
      const r = await api.post(`/inquiries/${i.id}/open-room`);
      toast.success("Vault opened");
      window.location.href = `/app/rooms/${r.data.id}`;
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to open Vault");
    }
  };

  const removeInquiry = async (i) => {
    const verb = isSeller ? "Dismiss this inquiry?" : "Withdraw this inquiry?";
    if (!window.confirm(`${verb} You can still access proofs and audit logs.`)) return;
    try {
      await api.delete(`/inquiries/${i.id}`);
      toast.success(isSeller ? "Inquiry dismissed" : "Inquiry withdrawn");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div data-testid="inquiries-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3" style={{ color: isSeller ? "var(--wz-amber)" : "var(--wz-gold)" }}>
        {isSeller ? "Inbound inquiries" : "My inquiries"}
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        {isSeller ? "Buyer interest signals." : "Your conversations."}
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        {isSeller
          ? "Buyers reaching out about your listings. Triage and reply directly here."
          : "Listings you have inquired about. Send a message and the seller will reply right inside this thread."}
      </p>

      <div className="mt-8 space-y-4" data-testid="inquiry-list">
        {items.map((i) => (
          <div key={i.id} className="wz-card p-6" data-testid={`inquiry-${i.id}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span
                    className={`pill ${i.status === "engaged" ? "pill-positive" : i.status === "passed" ? "pill-negative" : i.status === "reviewing" ? "pill-gold" : "pill-amber"}`}
                    title={INQUIRY_STATUS_DESCRIPTION[i.status] || ""}
                  >
                    {INQUIRY_STATUS_LABEL[i.status] || i.status}
                  </span>
                  <span className="text-xs font-mono-wz text-[var(--wz-text-tertiary)]">{new Date(i.created_at).toLocaleString()}</span>
                  {i.message_count > 0 && (
                    <span className="pill pill-gold flex items-center gap-1" data-testid={`thread-count-${i.id}`}>
                      <ChatCircleDots size={10} weight="fill" /> {i.message_count}
                    </span>
                  )}
                </div>
                <div className="font-display text-xl tracking-tight">
                  {isSeller ? i.buyer_name : i.listing_name}
                </div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
                  {isSeller ? `${i.buyer_org} · ${i.buyer_email}` : "to seller"}
                  {!isSeller && i.listing_name && <> · re: <span className="text-[var(--wz-gold)]">{i.listing_name}</span></>}
                </div>
                <blockquote className="mt-4 border-l-2 border-[var(--wz-gold)] pl-4 text-sm italic text-[var(--wz-text-secondary)] leading-relaxed">
                  &quot;{i.message}&quot;
                </blockquote>
                {!isSeller && i.status === "passed" && (
                  <div
                    data-testid={`buyer-declined-note-${i.id}`}
                    className="mt-3 flex items-start gap-2 border border-[var(--wz-negative)]/40 bg-[var(--wz-negative)]/5 px-3 py-2 text-xs text-[var(--wz-text-secondary)] leading-relaxed"
                  >
                    <Info size={14} className="text-[var(--wz-negative)] mt-0.5 shrink-0" weight="fill" />
                    <span>
                      <span className="text-[var(--wz-text)] font-medium">The seller declined this inquiry.</span>{" "}
                      &ldquo;Passed&rdquo; is M&amp;A shorthand for &ldquo;we&apos;re passing on this&rdquo;. No Vault
                      will be opened for this listing. You can withdraw the inquiry or browse other listings.
                    </span>
                  </div>
                )}
                {!isSeller && i.status === "engaged" && !i.deal_room_id && (
                  <div
                    data-testid={`buyer-engaged-note-${i.id}`}
                    className="mt-3 flex items-start gap-2 border border-[var(--wz-positive)]/40 bg-[var(--wz-positive)]/5 px-3 py-2 text-xs text-[var(--wz-text-secondary)] leading-relaxed"
                  >
                    <Info size={14} className="text-[var(--wz-positive)] mt-0.5 shrink-0" weight="fill" />
                    <span>
                      <span className="text-[var(--wz-text)] font-medium">Seller accepted your inquiry.</span>{" "}
                      Waiting for them to open the Vault. You&apos;ll be able to accept the NDA and see documents as soon as they do.
                    </span>
                  </div>
                )}
                {!isSeller && i.deal_room_id && (
                  <div
                    data-testid={`buyer-vault-ready-note-${i.id}`}
                    className="mt-3 flex items-start gap-2 border border-[var(--wz-gold)]/50 bg-[var(--wz-gold)]/5 px-3 py-2 text-xs text-[var(--wz-text-secondary)] leading-relaxed"
                  >
                    <Info size={14} className="text-[var(--wz-gold)] mt-0.5 shrink-0" weight="fill" />
                    <span>
                      <span className="text-[var(--wz-text)] font-medium">Vault open.</span>{" "}
                      Accept the NDA inside the Vault to unlock files and the AI Co-pilot.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 shrink-0" data-testid={`triage-${i.id}`}>
                {isSeller && (
                  <>
                    <div className="overline">Triage</div>
                    {STATUSES.filter((s) => s !== i.status).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(i, s)}
                        className={`text-[10px] font-mono-wz uppercase tracking-widest border px-3 py-1 transition-colors ${s === "passed" ? "border-[var(--wz-border)] hover:border-[var(--wz-negative)] hover:text-[var(--wz-negative)]" : s === "engaged" ? "border-[var(--wz-border)] hover:border-[var(--wz-positive)] hover:text-[var(--wz-positive)]" : "border-[var(--wz-border)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)]"}`}
                        data-testid={`set-${i.id}-${s}`}
                        title={INQUIRY_TRIAGE_LABEL[s]}
                      >
                        → {INQUIRY_STATUS_LABEL[s] || s}
                      </button>
                    ))}
                    <button
                      onClick={() => pushToZoho(i)}
                      disabled={pushing === i.id || i.zoho_pushed}
                      data-testid={`zoho-${i.id}`}
                      className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Buildings size={11} /> {i.zoho_pushed ? "in Zoho" : pushing === i.id ? "Syncing…" : "Push to Zoho"}
                    </button>
                    {i.status === "engaged" && !i.deal_room_id && (
                      <button onClick={() => openRoom(i)} data-testid={`open-room-${i.id}`} className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-amber)] text-[var(--wz-amber)] px-3 py-1 hover:bg-[var(--wz-amber)] hover:text-black transition-colors flex items-center gap-1.5">
                        <FileText size={11} /> Open Vault
                      </button>
                    )}
                    {i.deal_room_id && (
                      <Link to={`/app/rooms/${i.deal_room_id}`} data-testid={`go-room-${i.id}`} className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-positive)] text-[var(--wz-positive)] px-3 py-1 hover:bg-[var(--wz-positive)] hover:text-black transition-colors flex items-center gap-1.5">
                        <FileText size={11} /> Open Vault →
                      </Link>
                    )}
                  </>
                )}
                {!isSeller && i.deal_room_id && (
                  <Link to={`/app/rooms/${i.deal_room_id}`} data-testid={`go-room-${i.id}`} className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-gold)] text-[var(--wz-gold)] px-3 py-1 hover:bg-[var(--wz-gold)] hover:text-black transition-colors flex items-center gap-1.5">
                    <FileText size={11} /> Open Vault →
                  </Link>
                )}
                <button
                  onClick={() => setOpenThread(openThread === i.id ? null : i.id)}
                  data-testid={`toggle-thread-${i.id}`}
                  className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] transition-colors flex items-center gap-1.5"
                >
                  {openThread === i.id ? <CaretUp size={11} /> : <CaretDown size={11} />}
                  {openThread === i.id ? "Hide thread" : "Reply / view thread"}
                </button>
                <button
                  onClick={() => removeInquiry(i)}
                  data-testid={`delete-inquiry-${i.id}`}
                  className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-negative)] hover:text-[var(--wz-negative)] transition-colors flex items-center gap-1.5"
                >
                  <Trash size={11} /> {isSeller ? "Dismiss" : "Withdraw"}
                </button>
              </div>
            </div>

            {openThread === i.id && <ThreadPanel inquiryId={i.id} myRole={user?.role} onChange={load} />}
          </div>
        ))}
        {items.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
            {isSeller ? "No inbound inquiries yet — list a company and run an outreach campaign to attract buyers." : "You have not sent any inquiries yet — browse the marketplace to get started."}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadPanel({ inquiryId, myRole, onChange }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/inquiries/${inquiryId}/messages`);
      setMessages(r.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [inquiryId]); // eslint-disable-line

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/inquiries/${inquiryId}/messages`, { body: text.trim() });
      setText("");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-5 pt-5 border-t border-[var(--wz-border)]" data-testid={`thread-${inquiryId}`}>
      <div className="overline mb-3 flex items-center gap-2">
        <ChatCircleDots size={12} /> Conversation
      </div>
      {loading ? (
        <div className="text-xs text-[var(--wz-text-tertiary)]">Loading thread…</div>
      ) : messages.length === 0 ? (
        <div className="text-xs text-[var(--wz-text-tertiary)] italic">No replies yet. Start the conversation below.</div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-2 mb-4" data-testid="thread-messages">
          {messages.map((m) => {
            const mine = m.author_role === myRole;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
                <div className={`max-w-[80%] p-3 border ${mine ? "border-[var(--wz-gold)]/40 bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)] bg-[var(--wz-surface)]"}`}>
                  <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mb-1 flex items-center gap-2">
                    <span>{m.author_name} · {m.author_role}</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-[var(--wz-text)] whitespace-pre-wrap leading-relaxed">{m.body}</div>
                  {m.attachment && (
                    <div className="mt-2 text-xs border-t border-[var(--wz-border)] pt-2 flex items-center gap-1.5 text-[var(--wz-gold)]">
                      <Paperclip size={10} /> {m.attachment.title} <span className="text-[var(--wz-text-tertiary)]">· {m.attachment.kind}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <form onSubmit={send} className="flex gap-2 items-start">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={myRole === "seller" ? "Reply to the buyer…" : "Ask the seller anything…"}
          className="wz-input flex-1 text-sm resize-none"
          data-testid={`thread-input-${inquiryId}`}
        />
        <button type="submit" disabled={sending || !text.trim()} data-testid={`thread-send-${inquiryId}`} className="wz-btn wz-btn-gold text-xs flex items-center gap-1.5 shrink-0">
          <PaperPlaneTilt size={13} /> {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
