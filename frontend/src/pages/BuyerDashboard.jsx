import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Pulse, ArrowUpRight, MagnifyingGlass, Storefront, Question, EnvelopeSimple } from "@phosphor-icons/react";

export default function BuyerDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [marketplace, setMarketplace] = useState([]);
  const [research, setResearch] = useState([]);
  const [inquiries, setInquiries] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then((r) => setStats(r.data)),
      api.get("/marketplace").then((r) => setMarketplace(r.data.slice(0, 4))),
      api.get("/research/history").then((r) => setResearch(r.data.slice(0, 4))),
      api.get("/inquiries").then((r) => setInquiries(r.data.slice(0, 4))),
    ]).catch(() => {});
  }, []);

  const kpis = stats ? [
    { k: stats.marketplace_listings, v: "Live listings", testid: "kpi-marketplace", icon: Storefront },
    { k: stats.my_research_count, v: "My research briefs", testid: "kpi-research", icon: MagnifyingGlass },
    { k: stats.my_inquiries, v: "My inquiries", testid: "kpi-inquiries", icon: Question },
    { k: stats.newsletters_received, v: "Issues received", testid: "kpi-newsletter", icon: EnvelopeSimple },
  ] : [];

  return (
    <div data-testid="buyer-dashboard" data-mcp-action="dashboard.kpis" className="px-8 py-8">
      <div className="flex items-end justify-between mb-8 gap-6 flex-wrap">
        <div>
          <div className="overline mb-3">Buy-side console</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
            Welcome back, {user?.name?.split(" ")[0]}.
          </h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">
            Browse the marketplace, generate research, and signal intent. Workz pairs your interests with curated deal flow.
          </p>
        </div>
        <div className="text-xs text-[var(--wz-text-secondary)] flex items-center gap-2">
          <Pulse size={14} className="text-[var(--wz-positive)]" />
          <span>streaming KPIs</span>
        </div>
      </div>

      <div className="wz-grid grid-cols-2 md:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.v} className="p-6" data-testid={k.testid}>
              <div className="flex items-center justify-between mb-3">
                <div className="overline">{k.v}</div>
                <Icon size={14} className="text-[var(--wz-gold)]" />
              </div>
              <div className="font-mono-wz text-3xl">{k.k}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mt-10">
        <div className="wz-card" data-testid="marketplace-feed">
          <div className="border-b border-[var(--wz-border)] px-6 py-4 flex items-center justify-between">
            <div>
              <div className="overline">Marketplace · Live opportunities</div>
              <div className="font-display text-lg tracking-tight mt-1">Companies for sale</div>
            </div>
            <Link to="/app/marketplace" className="flex items-center gap-1 text-xs text-[var(--wz-gold)] hover:underline" data-testid="goto-marketplace">
              Open <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-[var(--wz-border)]">
            {marketplace.map((m) => (
              <Link
                to={`/app/marketplace`}
                key={m.id}
                className="block px-6 py-4 hover:bg-[var(--wz-surface-hover)] transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-display tracking-tight text-lg">{m.company_name}</div>
                    <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{m.headline}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-wz text-lg">${m.asking_price_usd_m}M</div>
                    <div className="overline mt-1">{m.sector} · {m.geography}</div>
                  </div>
                </div>
              </Link>
            ))}
            {marketplace.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-[var(--wz-text-tertiary)]">No live listings yet.</div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="wz-card" data-testid="recent-research">
            <div className="border-b border-[var(--wz-border)] px-6 py-4">
              <div className="overline">Recent research</div>
              <div className="font-display text-lg tracking-tight mt-1">Your briefs</div>
            </div>
            <div className="divide-y divide-[var(--wz-border)]">
              {research.map((r) => (
                <Link to="/app/research" key={r.id} className="block px-6 py-3 hover:bg-[var(--wz-surface-hover)]">
                  <div className="font-medium text-sm">{r.company_name}</div>
                  <div className="text-xs text-[var(--wz-text-secondary)] mt-1 line-clamp-1">{r.data?.one_liner}</div>
                </Link>
              ))}
              {research.length === 0 && (
                <Link to="/app/research" className="block px-6 py-6 text-center text-sm text-[var(--wz-text-tertiary)] hover:text-[var(--wz-gold)]">
                  Run your first AI brief →
                </Link>
              )}
            </div>
          </div>

          <div className="wz-card" data-testid="recent-inquiries">
            <div className="border-b border-[var(--wz-border)] px-6 py-4">
              <div className="overline">My inquiries</div>
              <div className="font-display text-lg tracking-tight mt-1">Conversations</div>
            </div>
            <div className="divide-y divide-[var(--wz-border)]">
              {inquiries.map((i) => (
                <div key={i.id} className="px-6 py-3">
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-sm">{i.listing_name}</div>
                    <span className={`pill ${i.status === "engaged" ? "pill-positive" : "pill-amber"}`}>{i.status}</span>
                  </div>
                </div>
              ))}
              {inquiries.length === 0 && (
                <Link to="/app/marketplace" className="block px-6 py-6 text-center text-sm text-[var(--wz-text-tertiary)] hover:text-[var(--wz-gold)]">
                  Browse marketplace →
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
