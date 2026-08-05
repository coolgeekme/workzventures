import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Pulse, ArrowUpRight, Tag, Question, NotePencil, PaperPlaneTilt } from "@phosphor-icons/react";

export default function SellerDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [listings, setListings] = useState([]);
  const [inquiries, setInquiries] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then((r) => setStats(r.data)),
      api.get("/listings").then((r) => setListings(r.data.slice(0, 5))),
      api.get("/inquiries").then((r) => setInquiries(r.data.slice(0, 5))),
    ]).catch(() => {});
  }, []);

  const kpis = stats ? [
    { k: stats.my_listings, v: "My deals", icon: Tag, testid: "kpi-listings" },
    { k: stats.live_listings, v: "Live", icon: Tag, testid: "kpi-live" },
    { k: stats.inbound_inquiries, v: "Inbound inquiries", icon: Question, testid: "kpi-inquiries" },
    { k: "$" + stats.pipeline_value_usd_m + "M", v: "Pipeline value", icon: ArrowUpRight, testid: "kpi-pipeline" },
    { k: stats.my_campaigns, v: "Campaigns", icon: PaperPlaneTilt, testid: "kpi-campaigns" },
    { k: stats.my_leads, v: "Leads", icon: ArrowUpRight, testid: "kpi-leads" },
    { k: stats.my_newsletters, v: "Newsletters", icon: NotePencil, testid: "kpi-newsletters" },
    { k: (stats.agent_success_rate || 0) + "%", v: "Agent success", icon: Pulse, testid: "kpi-success" },
  ] : [];

  return (
    <div data-testid="seller-dashboard" data-mcp-action="dashboard.kpis" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex items-end justify-between mb-8 gap-6 flex-wrap">
        <div>
          <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>Sell-side console</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
            Welcome back, {user?.name?.split(" ")[0]}.
          </h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">
            Market your portfolio, drive buyer engagement, and convert outreach into LOIs. The platform handles personalization and dispatch.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/app/listings" className="wz-btn wz-btn-gold flex items-center gap-2 text-sm" data-testid="cta-new-listing">
            <Tag size={14} /> New deal
          </Link>
          <Link to="/app/outreach" className="wz-btn-ghost wz-btn flex items-center gap-2 text-sm" data-testid="cta-new-campaign">
            <PaperPlaneTilt size={14} /> New campaign
          </Link>
        </div>
      </div>

      <div className="wz-grid grid-cols-2 md:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.v} className="p-6" data-testid={k.testid}>
              <div className="flex items-center justify-between mb-3">
                <div className="overline">{k.v}</div>
                <Icon size={14} className="text-[var(--wz-amber)]" />
              </div>
              <div className="font-mono-wz text-3xl">{k.k}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mt-10">
        <div className="wz-card" data-testid="my-listings-feed">
          <div className="border-b border-[var(--wz-border)] px-6 py-4 flex items-center justify-between">
            <div>
              <div className="overline">My portfolio</div>
              <div className="font-display text-lg tracking-tight mt-1">Listed companies</div>
            </div>
            <Link to="/app/listings" className="flex items-center gap-1 text-xs text-[var(--wz-amber)] hover:underline" data-testid="goto-listings">
              Manage <ArrowUpRight size={12} />
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--wz-text-tertiary)]">
                <th className="text-left overline py-3 px-6">Company</th>
                <th className="text-left overline">Sector</th>
                <th className="text-left overline">Status</th>
                <th className="text-right overline">Asking</th>
                <th className="text-right overline pr-6">Views · Inq</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((d) => (
                <tr key={d.id} className="border-t border-[var(--wz-border)] hover:bg-[var(--wz-surface-hover)]">
                  <td className="py-3 px-6 font-medium">{d.company_name}</td>
                  <td className="text-[var(--wz-text-secondary)]">{d.sector}</td>
                  <td><span className={`pill ${d.status === "live" ? "pill-positive" : d.status === "under_loi" ? "pill-amber" : "pill-gold"}`}>{d.status}</span></td>
                  <td className="text-right font-mono-wz">${d.asking_price_usd_m}M</td>
                  <td className="text-right pr-6 font-mono-wz text-[var(--wz-text-secondary)]">{d.view_count} · {d.inquiry_count}</td>
                </tr>
              ))}
              {listings.length === 0 && (
                <tr>
                  <td colSpan="5" className="py-10 text-center text-[var(--wz-text-tertiary)] text-sm">
                    <Link to="/app/listings" className="hover:text-[var(--wz-amber)]">List your first portfolio company →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="wz-card" data-testid="inbound-feed">
          <div className="border-b border-[var(--wz-border)] px-6 py-4 flex items-center justify-between">
            <div>
              <div className="overline">Inbound</div>
              <div className="font-display text-lg tracking-tight mt-1">Buyer inquiries</div>
            </div>
            <Link to="/app/inquiries" className="text-xs text-[var(--wz-amber)] hover:underline" data-testid="goto-inquiries">
              All →
            </Link>
          </div>
          <div className="divide-y divide-[var(--wz-border)]">
            {inquiries.map((i) => (
              <div key={i.id} className="px-6 py-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{i.buyer_name}</div>
                    <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{i.buyer_org} · re: <span className="text-[var(--wz-amber)]">{i.listing_name}</span></div>
                    <div className="text-xs text-[var(--wz-text-secondary)] mt-2 line-clamp-2 italic">&quot;{i.message}&quot;</div>
                  </div>
                  <span className={`pill ${i.status === "engaged" ? "pill-positive" : i.status === "passed" ? "pill-negative" : "pill-amber"}`}>{({new: "New", reviewing: "Reviewing", engaged: "Accepted", passed: "Declined"}[i.status]) || i.status}</span>
                </div>
              </div>
            ))}
            {inquiries.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-[var(--wz-text-tertiary)]">No inbound inquiries yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
