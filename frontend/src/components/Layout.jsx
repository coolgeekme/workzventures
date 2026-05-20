import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  House, MagnifyingGlass, NotePencil, PaperPlaneTilt, Kanban,
  EnvelopeSimple, Plugs, Terminal, ChartLineUp, ListChecks, SignOut,
} from "@phosphor-icons/react";

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: House, group: "Core" },
  { to: "/app/research", label: "Research Hub", icon: MagnifyingGlass, group: "Intelligence" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Marketing" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Marketing" },
  { to: "/app/leads", label: "Lead Nurturing", icon: Kanban, group: "Pipeline" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Pipeline" },
  { to: "/app/composio", label: "Composio", icon: Plugs, group: "Platform" },
  { to: "/app/mcp", label: "MCP Console", icon: Terminal, group: "Platform" },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp, group: "Platform" },
  { to: "/app/audit", label: "Audit Logs", icon: ListChecks, group: "Platform" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr] grain" data-testid="app-shell">
      {/* Sidebar */}
      <aside className="border-r border-[var(--wz-border)] flex flex-col" data-testid="sidebar">
        <div className="px-6 pt-7 pb-5 border-b border-[var(--wz-border)]">
          <Link to="/app/dashboard" className="flex items-center gap-2" data-testid="brand-link">
            <div className="w-7 h-7 bg-[var(--wz-gold)] flex items-center justify-center text-black font-bold font-mono-wz text-sm">W</div>
            <div>
              <div className="font-display font-medium tracking-tighter text-lg leading-none">Workz</div>
              <div className="overline mt-1">Ventures · AI Agency</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {groups.map((g) => (
            <div key={g} className="mb-5">
              <div className="overline px-3 mb-2">{g}</div>
              <div className="space-y-px">
                {NAV.filter((n) => n.group === g).map((n) => {
                  const Icon = n.icon;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 text-sm transition-colors border-l-2 ${
                          isActive
                            ? "border-[var(--wz-gold)] text-white bg-[var(--wz-surface-hover)]"
                            : "border-transparent text-[var(--wz-text-secondary)] hover:text-white hover:bg-[var(--wz-surface)]"
                        }`
                      }
                    >
                      <Icon size={16} weight="regular" />
                      <span>{n.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--wz-border)] p-4">
          <div className="text-xs text-[var(--wz-text-secondary)] truncate" data-testid="user-name">{user?.name}</div>
          <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] uppercase tracking-widest truncate" data-testid="user-role">
            {user?.role} · {user?.organization || "no org"}
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => { logout(); navigate("/login"); }}
            className="mt-3 w-full flex items-center justify-between text-xs text-[var(--wz-text-secondary)] hover:text-white border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] px-3 py-2 rounded-sm transition-colors"
          >
            <span>Sign out</span>
            <SignOut size={14} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-col min-h-screen">
        <header className="border-b border-[var(--wz-border)] px-8 py-3 flex items-center justify-between" data-testid="topbar">
          <div className="flex items-center gap-4">
            <div className="dot-blink" />
            <div className="overline">live · {location.pathname}</div>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <span className="font-mono-wz text-[var(--wz-text-secondary)]">
              UTC {time.toISOString().substring(11, 19)}
            </span>
            <span className="pill pill-gold" data-testid="env-pill">Workz · Prod</span>
          </div>
        </header>
        <div className="flex-1 fade-in">{children}</div>
      </main>
    </div>
  );
}
