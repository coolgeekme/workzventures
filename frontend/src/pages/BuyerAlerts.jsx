import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bell, CheckCircle, TrashSimple, Crosshair, ArrowRight } from "@phosphor-icons/react";
import { api } from "../lib/api";

const SCORE_PILL = (s) => (s >= 75 ? "pill-positive" : s >= 50 ? "pill-gold" : "pill-amber");

export default function BuyerAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("all"); // all | unseen

  const load = async () => {
    try {
      const r = await api.get("/buyer-alerts", {
        params: filter === "unseen" ? { unseen_only: true } : {},
      });
      setAlerts(r.data || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load alerts");
    }
  };

  useEffect(() => { load(); }, [filter]); // eslint-disable-line

  const markSeen = async (aid) => {
    try {
      await api.patch(`/buyer-alerts/${aid}/seen`);
      setAlerts((arr) => arr.map((a) => (a.id === aid ? { ...a, seen: true } : a)));
    } catch (err) {
      toast.error("Failed");
    }
  };

  const remove = async (aid) => {
    if (!window.confirm("Dismiss this alert?")) return;
    try {
      await api.delete(`/buyer-alerts/${aid}`);
      setAlerts((arr) => arr.filter((a) => a.id !== aid));
      toast.success("Dismissed");
    } catch (err) {
      toast.error("Failed");
    }
  };

  const markAllSeen = async () => {
    try {
      const r = await api.post("/buyer-alerts/mark-all-seen");
      toast.success(`Marked ${r.data.updated} alerts as seen`);
      load();
    } catch (err) {
      toast.error("Failed");
    }
  };

  const unseenCount = alerts.filter((a) => !a.seen).length;

  return (
    <div data-testid="buyer-alerts-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>Buyer alerts inbox</div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
          <Bell size={26} className="text-[var(--wz-amber)]" />
          High-fit buyers detected
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            data-testid="filter-all"
            className={`text-xs px-3 py-1 border ${filter === "all" ? "border-[var(--wz-amber)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter("unseen")}
            data-testid="filter-unseen"
            className={`text-xs px-3 py-1 border ${filter === "unseen" ? "border-[var(--wz-amber)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
          >
            Unseen
          </button>
          {unseenCount > 0 && (
            <button
              onClick={markAllSeen}
              data-testid="mark-all-seen"
              className="wz-btn-ghost wz-btn text-xs flex items-center gap-2"
            >
              <CheckCircle size={12} /> Mark all seen
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        Alerts fire when a new buyer with a fit score ≥ 70 is discovered for one of your live listings. We
        rescan SEC EDGAR every 24 hours.
      </p>

      <div className="mt-6 space-y-3" data-testid="alerts-list">
        {alerts.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]" data-testid="empty-alerts">
            No alerts yet. Run a scan from{" "}
            <Link to="/app/buyers" className="underline">Buyer Discovery</Link>{" "}
            to seed the pipeline.
          </div>
        )}
        {alerts.map((a) => (
          <article
            key={a.id}
            data-testid={`alert-${a.id}`}
            className={`wz-card p-5 flex items-start justify-between gap-4 flex-wrap ${a.seen ? "opacity-70" : ""}`}
          >
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center gap-2 flex-wrap">
                {!a.seen && <span className="w-2 h-2 rounded-full bg-[var(--wz-amber)]" />}
                <h3 className="font-display text-lg tracking-tight">{a.buyer_name}</h3>
                <span className={`pill ${SCORE_PILL(a.score)}`}>{a.score}/100</span>
                <span className="pill">{a.country}</span>
                <span className="pill">{(a.source || "").replace("_", " ")}</span>
              </div>
              <div className="text-xs text-[var(--wz-text-secondary)] mt-1 flex items-center gap-1">
                <Crosshair size={11} /> matched to{" "}
                <Link
                  to={`/app/buyers?listing=${a.listing_id}`}
                  className="underline hover:text-[var(--wz-text)]"
                >
                  {a.listing_company}
                </Link>
              </div>
              <p className="text-sm text-[var(--wz-text-secondary)] mt-2 leading-relaxed">{a.rationale}</p>
              <div className="mt-2 text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
                detected {new Date(a.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[160px]">
              <Link
                to={`/app/buyers?listing=${a.listing_id}`}
                onClick={() => !a.seen && markSeen(a.id)}
                data-testid={`open-${a.id}`}
                className="wz-btn wz-btn-gold text-xs flex items-center gap-2 justify-center"
              >
                Open in discovery <ArrowRight size={11} />
              </Link>
              {!a.seen && (
                <button
                  onClick={() => markSeen(a.id)}
                  data-testid={`seen-${a.id}`}
                  className="wz-btn-ghost wz-btn text-xs flex items-center gap-2 justify-center"
                >
                  <CheckCircle size={11} /> Mark seen
                </button>
              )}
              <button
                onClick={() => remove(a.id)}
                data-testid={`dismiss-${a.id}`}
                title="Dismiss"
                className="text-xs py-1 border border-[var(--wz-border)] hover:border-[var(--wz-negative)] hover:text-[var(--wz-negative)] flex items-center justify-center gap-1"
              >
                <TrashSimple size={11} /> Dismiss
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
