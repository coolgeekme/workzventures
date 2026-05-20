import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function AgentMonitor() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api.get("/agents/stats").then((r) => setStats(r.data));
    api.get("/agents/activity").then((r) => setActivity(r.data));
  }, []);

  return (
    <div data-testid="agents-page" className="px-8 py-8">
      <div className="overline mb-3">Agent monitor</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Autonomous task completion · live diagnostics.
      </h1>

      <div className="wz-grid grid-cols-2 md:grid-cols-4 mt-8">
        {stats && [
          ["Total runs", stats.total],
          ["Completed", stats.completed],
          ["Failed", stats.failed],
          ["Success rate", stats.success_rate + "%"],
        ].map(([k, v]) => (
          <div key={k} className="p-6" data-testid={`stat-${k}`}>
            <div className="overline mb-2">{k}</div>
            <div className="font-mono-wz text-2xl">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--wz-border)] mt-6 border border-[var(--wz-border)]">
        {(stats?.by_agent || []).map((a) => (
          <div key={a.agent} className="bg-[var(--wz-surface)] p-5">
            <div className="overline mb-2">{a.agent}</div>
            <div className="font-mono-wz text-xl">{a.count}</div>
          </div>
        ))}
      </div>

      <div className="wz-card mt-8" data-testid="activity-log">
        <div className="border-b border-[var(--wz-border)] px-6 py-4">
          <div className="overline">Activity log</div>
          <div className="font-display text-lg tracking-tight mt-1">Most recent autonomous tasks</div>
        </div>
        <div className="divide-y divide-[var(--wz-border)] font-mono-wz text-xs">
          {activity.map((a) => (
            <div key={a.id} className="px-6 py-3 grid grid-cols-12 gap-4 items-center">
              <div className="col-span-2 text-[var(--wz-text-secondary)]">{new Date(a.timestamp).toLocaleTimeString()}</div>
              <div className="col-span-2 text-[var(--wz-gold)]">{a.agent}</div>
              <div className="col-span-5 text-white normal-case">{a.task}</div>
              <div className="col-span-2 text-[var(--wz-text-secondary)]">{a.duration_ms}ms</div>
              <div className="col-span-1 text-right">
                <span className={`pill ${a.status === "completed" ? "pill-positive" : a.status === "failed" ? "pill-negative" : "pill-amber"}`}>{a.status}</span>
              </div>
              {a.friction && (
                <div className="col-span-12 mt-1 text-[var(--wz-negative)] text-[11px] uppercase tracking-widest">
                  friction: {a.friction}
                </div>
              )}
            </div>
          ))}
          {activity.length === 0 && (
            <div className="px-6 py-12 text-center text-[var(--wz-text-tertiary)]">No agent activity recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
