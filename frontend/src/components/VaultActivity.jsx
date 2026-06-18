import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import {
  Clock, ShieldCheck, FileText, CloudArrowDown, CloudArrowUp,
  ChatCircleDots, MagnifyingGlass, Eye, Trash, GoogleLogo,
  DropboxLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, Cube,
  CaretDown, ArrowClockwise,
} from "@phosphor-icons/react";

/**
 * Vault Activity tab — institutional-VDR-style audit timeline.
 *
 * Source: GET /api/deal-rooms/{rid}/activity
 * Polling: 30s cadence, only when this tab is visible.
 * Auth: server already restricts to room participants.
 *
 * Shows every action that touched this Vault: opens, NDA signatures, file
 * uploads/downloads/previews, AI Co-pilot questions, AI Findings runs.
 * Both buyer and seller see the same set — full transparency is the
 * institutional norm and a key trust signal.
 */

const CATEGORY_META = {
  vault:    { label: "Vault",     dot: "var(--wz-gold)" },
  nda:      { label: "NDA",       dot: "var(--wz-positive)" },
  file:     { label: "Files",     dot: "var(--wz-info, #3B82F6)" },
  copilot:  { label: "Co-pilot",  dot: "var(--wz-amber)" },
  findings: { label: "Findings",  dot: "var(--wz-negative, #EF4444)" },
  other:    { label: "Other",     dot: "var(--wz-text-tertiary)" },
};

const SOURCE_BADGES = {
  googledrive: { label: "Google Drive", Icon: GoogleLogo,           tint: "#1A73E8" },
  onedrive:    { label: "OneDrive",     Icon: MicrosoftOutlookLogo, tint: "#0078D4" },
  sharepoint:  { label: "SharePoint",   Icon: MicrosoftTeamsLogo,   tint: "#0078D4" },
  dropbox:     { label: "Dropbox",      Icon: DropboxLogo,          tint: "#0061FF" },
  box:         { label: "Box",          Icon: Cube,                 tint: "#0061D5" },
};

function actionIcon(action) {
  if (action === "dealroom.nda.accept") return ShieldCheck;
  if (action === "dealroom.file.upload" || action === "dealroom.file.add") return CloudArrowUp;
  if (action === "dealroom.file.download") return CloudArrowDown;
  if (action === "dealroom.file.preview") return Eye;
  if (action === "dealroom.file.delete") return Trash;
  if (action === "vault.copilot.ask") return ChatCircleDots;
  if (action === "dealroom.findings.generate") return MagnifyingGlass;
  if (action === "dealroom.open" || action === "dealroom.preview.open" || action === "dealroom.view") return FileText;
  return Clock;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDetail(ev) {
  const m = ev.meta || {};
  if (m.filename) {
    if (ev.action === "dealroom.file.add" && m.via && m.via !== "manual") {
      const badge = SOURCE_BADGES[m.via];
      return (
        <span className="inline-flex items-center gap-1.5 text-[var(--wz-text-secondary)]">
          <span className="font-medium text-white">{m.filename}</span>
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
            style={{ background: "rgba(255,255,255,0.06)", color: badge?.tint || "var(--wz-text-tertiary)" }}
            title={`Synced via ${badge?.label || m.via}`}
          >
            {badge?.Icon ? <badge.Icon size={10} /> : null}
            {badge?.label || m.via}
          </span>
        </span>
      );
    }
    return <span className="font-medium text-white">{m.filename}</span>;
  }
  if (ev.action === "dealroom.nda.accept" && m.signed_name) {
    return <span>Signed as <em className="text-white not-italic font-medium">{m.signed_name}</em></span>;
  }
  if (ev.action === "vault.copilot.ask" && m.q) {
    return <span className="italic text-[var(--wz-text-secondary)]">&ldquo;{m.q.slice(0, 90)}{m.q.length > 90 ? "…" : ""}&rdquo;</span>;
  }
  if (ev.action === "dealroom.findings.generate" && typeof m.count === "number") {
    return <span>{m.count} finding{m.count === 1 ? "" : "s"} generated</span>;
  }
  return null;
}

export default function VaultActivity({ roomId, accentClass }) {
  const [data, setData] = useState({ events: [], counts: { total: 0, by_action: {}, by_actor: {} } });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/deal-rooms/${roomId}/activity`, { params: { limit: 200 } });
      setData(r.data);
    } catch (_e) {
      // silent — participant_check failure surfaces elsewhere
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // 30s polling while tab is mounted
    return () => clearInterval(t);
  }, [roomId]);

  const filtered = useMemo(() => {
    if (filter === "all") return data.events;
    return data.events.filter((e) => e.category === filter);
  }, [data.events, filter]);

  const visible = showAll ? filtered : filtered.slice(0, 50);

  const filters = [
    { v: "all", l: "All", count: data.events.length },
    { v: "nda", l: "NDA", count: data.events.filter((e) => e.category === "nda").length },
    { v: "file", l: "Files", count: data.events.filter((e) => e.category === "file").length },
    { v: "copilot", l: "Co-pilot", count: data.events.filter((e) => e.category === "copilot").length },
    { v: "findings", l: "Findings", count: data.events.filter((e) => e.category === "findings").length },
    { v: "vault", l: "Vault access", count: data.events.filter((e) => e.category === "vault").length },
  ];

  return (
    <div className="mt-6" data-testid="activity-tab">
      {/* Header strip */}
      <div className="wz-card p-4 mb-4 flex items-center justify-between" data-testid="activity-header">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--wz-text-tertiary)]">
            Bitcoin-anchored audit trail
          </div>
          <div className="text-sm text-[var(--wz-text-secondary)] mt-0.5">
            Every action on this Vault is logged in a tamper-evident chain.{" "}
            <span className="text-white font-medium">{data.counts.total}</span> event{data.counts.total === 1 ? "" : "s"}{" "}
            across <span className="text-white font-medium">{Object.keys(data.counts.by_actor || {}).length}</span> participant
            {Object.keys(data.counts.by_actor || {}).length === 1 ? "" : "s"}.
          </div>
        </div>
        <button
          onClick={load}
          className="text-xs text-[var(--wz-text-secondary)] hover:text-white inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--wz-border)] hover:border-current rounded-sm transition-colors"
          data-testid="activity-refresh"
          aria-label="Refresh activity"
        >
          <ArrowClockwise size={12} /> Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-thin" data-testid="activity-filters">
        {filters.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            data-testid={`activity-filter-${f.v}`}
            className={`whitespace-nowrap px-3 py-1.5 text-xs border rounded-sm transition-colors ${
              filter === f.v
                ? `${accentClass} border-current`
                : "text-[var(--wz-text-secondary)] border-[var(--wz-border)] hover:text-white hover:border-[var(--wz-text-secondary)]"
            }`}
          >
            {f.l} <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)] ml-1">{f.count}</span>
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="wz-card overflow-hidden" data-testid="activity-timeline">
        {loading && data.events.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--wz-text-tertiary)]">Loading activity…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--wz-text-tertiary)]">
            No activity yet for this filter.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--wz-border)]">
            {visible.map((ev) => {
              const Icon = actionIcon(ev.action);
              const cat = CATEGORY_META[ev.category] || CATEGORY_META.other;
              const detail = formatDetail(ev);
              return (
                <li
                  key={ev.id}
                  className="px-5 py-3.5 flex items-start gap-3 hover:bg-[var(--wz-row-hover,rgba(255,255,255,0.02))] transition-colors"
                  data-testid={`activity-event-${ev.id}`}
                >
                  <div className="relative mt-0.5">
                    <span
                      className="block w-1.5 h-1.5 rounded-full"
                      style={{ background: cat.dot }}
                      title={cat.label}
                    />
                  </div>
                  <Icon size={15} className="text-[var(--wz-text-secondary)] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">
                      <span className="font-medium">{ev.actor?.name || "Someone"}</span>
                      <span className="text-[var(--wz-text-secondary)]"> · {ev.label}</span>
                    </div>
                    <div className="text-xs text-[var(--wz-text-tertiary)] mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{ev.actor?.role}{ev.actor?.organization ? ` · ${ev.actor.organization}` : ""}</span>
                      <span>·</span>
                      <span title={ev.created_at}>{timeAgo(ev.created_at)}</span>
                      {detail && (<><span>·</span><span className="truncate max-w-[420px]">{detail}</span></>)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > 50 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full px-5 py-3 text-xs text-[var(--wz-text-secondary)] hover:text-white border-t border-[var(--wz-border)] inline-flex items-center justify-center gap-1.5"
            data-testid="activity-show-all"
          >
            Show all {filtered.length} events <CaretDown size={12} />
          </button>
        )}
      </div>

      {/* Footer note — sales/trust talking point baked into the UI */}
      <div className="mt-3 text-[11px] text-[var(--wz-text-tertiary)] leading-relaxed">
        Every event is hash-chained and periodically anchored to the Bitcoin
        blockchain via OpenTimestamps. Tampering with any past entry breaks the
        chain — verifiable from the <span className="text-white">Security</span> page.
      </div>
    </div>
  );
}
