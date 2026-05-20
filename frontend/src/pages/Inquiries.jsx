import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Buildings, FileText } from "@phosphor-icons/react";

const STATUSES = ["new", "reviewing", "engaged", "passed"];

export default function Inquiries() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [pushing, setPushing] = useState(null);
  const isSeller = user?.role === "seller";

  const load = () => api.get("/inquiries").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const setStatus = async (i, status) => {
    try {
      await api.patch(`/inquiries/${i.id}/status`, { status });
      toast.success(`${i.buyer_name} → ${status}`);
      load();
    } catch (err) {
      toast.error("Update failed");
    }
  };

  const pushToZoho = async (i) => {
    setPushing(i.id);
    try {
      const r = await api.post(`/composio/zoho/push-lead/${i.id}`);
      if (r.data.pushed_to_zoho) {
        toast.success(`${i.buyer_name} pushed to Zoho CRM as Lead`);
      } else {
        toast(`${i.buyer_name} recorded locally — connect Zoho CRM to push live`, { duration: 5000 });
      }
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
      toast.success("Deal room opened");
      window.location.href = `/app/rooms/${r.data.id}`;
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to open room");
    }
  };

  return (
    <div data-testid="inquiries-page" className="px-8 py-8">
      <div className="overline mb-3" style={{ color: isSeller ? "var(--wz-amber)" : "var(--wz-gold)" }}>
        {isSeller ? "Inbound inquiries" : "My inquiries"}
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        {isSeller ? "Buyer interest signals." : "Your conversations."}
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        {isSeller
          ? "Buyers reaching out about your listings. Triage from new → reviewing → engaged."
          : "Listings you have inquired about. Sellers will respond directly through the platform."}
      </p>

      <div className="mt-8 space-y-4" data-testid="inquiry-list">
        {items.map((i) => (
          <div key={i.id} className="wz-card p-6">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`pill ${i.status === "engaged" ? "pill-positive" : i.status === "passed" ? "pill-negative" : i.status === "reviewing" ? "pill-gold" : "pill-amber"}`}>{i.status}</span>
                  <span className="text-xs font-mono-wz text-[var(--wz-text-tertiary)]">
                    {new Date(i.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="font-display text-xl tracking-tight">
                  {isSeller ? i.buyer_name : i.listing_name}
                </div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
                  {isSeller ? `${i.buyer_org} · ${i.buyer_email}` : `to seller`}
                  {!isSeller && i.listing_name && <> · re: <span className="text-[var(--wz-gold)]">{i.listing_name}</span></>}
                </div>
                <blockquote className="mt-4 border-l-2 border-[var(--wz-gold)] pl-4 text-sm italic text-[var(--wz-text-secondary)] leading-relaxed">
                  "{i.message}"
                </blockquote>
              </div>
              {isSeller && (
                <div className="flex flex-col gap-2" data-testid={`triage-${i.id}`}>
                  <div className="overline">Triage</div>
                  {STATUSES.filter((s) => s !== i.status).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(i, s)}
                      className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)] transition-colors"
                      data-testid={`set-${i.id}-${s}`}
                    >
                      → {s}
                    </button>
                  ))}
                  <div className="overline mt-2">Sync</div>
                  <button
                    onClick={() => pushToZoho(i)}
                    disabled={pushing === i.id || i.zoho_pushed}
                    data-testid={`zoho-${i.id}`}
                    className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Buildings size={11} />
                    {i.zoho_pushed ? "in Zoho" : pushing === i.id ? "Syncing…" : "Push to Zoho CRM"}
                  </button>
                  {i.status === "engaged" && !i.deal_room_id && (
                    <button
                      onClick={() => openRoom(i)}
                      data-testid={`open-room-${i.id}`}
                      className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-amber)] text-[var(--wz-amber)] px-3 py-1 hover:bg-[var(--wz-amber)] hover:text-black transition-colors flex items-center gap-1.5"
                    >
                      <FileText size={11} /> Open Deal Room
                    </button>
                  )}
                  {i.deal_room_id && (
                    <Link
                      to={`/app/rooms/${i.deal_room_id}`}
                      data-testid={`go-room-${i.id}`}
                      className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-positive)] text-[var(--wz-positive)] px-3 py-1 hover:bg-[var(--wz-positive)] hover:text-black transition-colors flex items-center gap-1.5"
                    >
                      <FileText size={11} /> Deal Room →
                    </Link>
                  )}
                </div>
              )}
            </div>
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
