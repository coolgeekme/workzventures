import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Storefront, ChatCircle, Bookmark, MagnifyingGlass } from "@phosphor-icons/react";

export default function Marketplace() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [watchlist, setWatchlist] = useState([]);

  const load = () => Promise.all([
    api.get("/marketplace").then((r) => setItems(r.data)),
    api.get("/watchlist").then((r) => setWatchlist(r.data)),
  ]);

  useEffect(() => { load(); }, []);

  const isWatched = (id) => watchlist.some((w) => w.listing_id === id);

  const toggleWatch = async (l) => {
    if (isWatched(l.id)) {
      await api.delete(`/watchlist/${l.id}`);
      toast.success("Removed from watchlist");
    } else {
      await api.post(`/watchlist/${l.id}`);
      toast.success("Added to watchlist");
    }
    load();
  };

  const inquire = async () => {
    if (!selected || !message.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/marketplace/${selected.id}/inquire`, { message });
      toast.success(`Inquiry sent to ${selected.seller_name || "the seller"}`);
      setMessage("");
      setSelected(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = items.filter((i) =>
    !filter || [i.company_name, i.sector, i.geography, i.headline].some((f) => f?.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div data-testid="marketplace-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3">Marketplace</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
        <Storefront size={28} className="text-[var(--wz-gold)]" />
        Live companies for sale.
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        Curated by NextCapOS analysts and continuously refreshed by AI agents. Express interest to open a private channel with the seller.
      </p>

      <div className="mt-8 wz-card p-4 flex items-center gap-3" data-testid="filter-bar">
        <MagnifyingGlass size={16} className="text-[var(--wz-text-tertiary)]" />
        <input
          placeholder="Filter by company, sector, geography…"
          className="bg-transparent flex-1 outline-none text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="market-filter"
        />
        <div className="overline">{filtered.length} of {items.length}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6" data-testid="market-grid">
        {filtered.map((l) => (
          <article key={l.id} className="wz-card p-6 flex flex-col" data-testid={`market-card-${l.id}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="pill pill-gold">{l.sector}</span>
              <button
                onClick={() => toggleWatch(l)}
                className={`text-${isWatched(l.id) ? "[var(--wz-gold)]" : "[var(--wz-text-tertiary)]"} hover:text-[var(--wz-gold)] transition-colors`}
                data-testid={`watch-${l.id}`}
                title={isWatched(l.id) ? "Unwatch" : "Watch"}
              >
                <Bookmark size={16} weight={isWatched(l.id) ? "fill" : "regular"} />
              </button>
            </div>
            <div className="font-display text-xl tracking-tight">{l.company_name}</div>
            <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{l.headline}</div>

            <div className="grid grid-cols-3 gap-2 mt-4">
              <Metric label="Asking" value={`$${l.asking_price_usd_m}M`} />
              <Metric label="Revenue" value={l.revenue_usd_m ? `$${l.revenue_usd_m}M` : "—"} />
              <Metric label="EBITDA" value={l.ebitda_usd_m ? `$${l.ebitda_usd_m}M` : "—"} />
            </div>

            <p className="text-xs text-[var(--wz-text-secondary)] mt-4 leading-relaxed line-clamp-3 flex-1">{l.summary}</p>

            <div className="mt-5 pt-4 border-t border-[var(--wz-border)] flex items-center justify-between">
              <div className="overline">{l.geography} · {l.employees || "—"} ppl</div>
              <button
                onClick={() => setSelected(l)}
                className="wz-btn wz-btn-gold text-xs flex items-center gap-1"
                data-testid={`inquire-${l.id}`}
              >
                <ChatCircle size={12} /> Inquire
              </button>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="md:col-span-3 wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
            No listings match your filter.
          </div>
        )}
      </div>

      {/* Inquiry modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur z-50 flex items-center justify-center p-6" onClick={() => setSelected(null)} data-testid="inquire-modal">
          <div className="wz-card p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-2">Inquiry</div>
            <h2 className="font-display text-2xl tracking-tight">{selected.company_name}</h2>
            <div className="text-xs text-[var(--wz-text-secondary)] mt-1">to {selected.seller_name} · {selected.seller_org}</div>
            <textarea
              rows={5}
              placeholder="Hi Mira — we're a $4B EMEA growth fund actively looking at HealthTech consolidation plays. Helios fits our thesis precisely. Could we open the Vault for a NDA-gated conversation?"
              className="wz-input mt-5 font-sans"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-testid="inquire-message"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSelected(null)} className="wz-btn-ghost wz-btn">Cancel</button>
              <button onClick={inquire} disabled={submitting || !message.trim()} className="wz-btn wz-btn-gold" data-testid="inquire-send">
                {submitting ? "Sending…" : "Send inquiry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-2">
      <div className="overline mb-1">{label}</div>
      <div className="font-mono-wz text-xs">{value}</div>
    </div>
  );
}
