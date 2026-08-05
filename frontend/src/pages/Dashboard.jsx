import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ArrowUpRight, Pulse } from "@phosphor-icons/react";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [deals, setDeals] = useState([]);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then((r) => setStats(r.data)),
      api.get("/deals").then((r) => setDeals(r.data)),
      api.get("/agents/activity").then((r) => setActivity(r.data.slice(0, 6))),
    ]).catch(() => {});
  }, []);

  const kpis = stats
    ? [
        { k: "$" + stats.aum_usd_b + "B", v: "AUM coverage", testid: "kpi-aum" },
        { k: stats.active_deals, v: "Active deals", testid: "kpi-deals" },
        { k: stats.pipeline_leads, v: "Pipeline leads", testid: "kpi-leads" },
        { k: stats.campaigns, v: "Campaigns", testid: "kpi-campaigns" },
        { k: stats.newsletters_sent, v: "Newsletters", testid: "kpi-newsletters" },
        { k: stats.research_count, v: "Research briefs", testid: "kpi-research" },
        { k: stats.agent_success_rate + "%", v: "Automation success", testid: "kpi-success" },
        { k: stats.exit_velocity_days + "d", v: "Exit velocity", testid: "kpi-exit" },
      ]
    : [];

  return (
    <div data-testid="dashboard-page" data-mcp-action="dashboard.kpis" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="overline mb-3">Control room · live telemetry</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">Dashboard</h1>
        </div>
        <div className="text-xs text-[var(--wz-text-secondary)] flex items-center gap-2">
          <Pulse size={14} className="text-[var(--wz-positive)]" />
          <span>streaming KPIs</span>
        </div>
      </div>

      <div className="wz-grid grid-cols-2 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.v} className="p-6" data-testid={k.testid}>
            <div className="overline mb-2">{k.v}</div>
            <div className="font-mono-wz text-2xl">{k.k}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mt-10">
        <div className="wz-card" data-testid="deals-panel">
          <div className="border-b border-[var(--wz-border)] px-6 py-4 flex items-center justify-between">
            <div>
              <div className="overline">Active deal book</div>
              <div className="font-display text-lg tracking-tight mt-1">Sourcing → Closing</div>
            </div>
            <ArrowUpRight size={16} className="text-[var(--wz-text-tertiary)]" />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--wz-text-tertiary)]">
                <th className="text-left overline py-3 px-6">Deal</th>
                <th className="text-left overline">Sector</th>
                <th className="text-left overline">Stage</th>
                <th className="text-right overline">Value</th>
                <th className="text-right overline pr-6">Geo</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-t border-[var(--wz-border)] hover:bg-[var(--wz-surface-hover)]">
                  <td className="py-3 px-6">{d.name}</td>
                  <td className="text-[var(--wz-text-secondary)]">{d.sector}</td>
                  <td><span className="pill pill-gold">{d.stage}</span></td>
                  <td className="text-right font-mono-wz">${d.value_usd_m}M</td>
                  <td className="text-right pr-6 font-mono-wz text-[var(--wz-text-secondary)]">{d.geography}</td>
                </tr>
              ))}
              {deals.length === 0 && (
                <tr><td colSpan="5" className="py-10 text-center text-[var(--wz-text-tertiary)] text-sm">No active deals</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="wz-card" data-testid="agent-feed">
          <div className="border-b border-[var(--wz-border)] px-6 py-4">
            <div className="overline">Automation activity</div>
            <div className="font-display text-lg tracking-tight mt-1">Recent automated tasks</div>
          </div>
          <div className="divide-y divide-[var(--wz-border)]">
            {activity.map((a) => (
              <div key={a.id} className="px-6 py-3 flex items-start justify-between text-sm">
                <div>
                  <div className="font-mono-wz text-xs text-[var(--wz-text-secondary)]">{a.agent}</div>
                  <div className="text-white mt-1">{a.task}</div>
                </div>
                <span className={`pill ${a.status === "completed" ? "pill-positive" : a.status === "failed" ? "pill-negative" : "pill-amber"}`}>
                  {a.status}
                </span>
              </div>
            ))}
            {activity.length === 0 && (
              <div className="px-6 py-10 text-center text-[var(--wz-text-tertiary)] text-sm">
                No agent activity yet — generate research, draft a newsletter, or launch a campaign to seed the feed.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
