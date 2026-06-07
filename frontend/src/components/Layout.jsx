import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import {
  House, MagnifyingGlass, NotePencil, PaperPlaneTilt, Kanban,
  EnvelopeSimple, Plugs, Terminal, ChartLineUp, ListChecks, SignOut,
  Storefront, Tag, Question, ChartBar, Files, ShieldCheck, Crosshair, Bell,
} from "@phosphor-icons/react";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileTopbar from "./MobileTopbar";
import BottomTabBar from "./BottomTabBar";
import DemoBanner from "./DemoBanner";

const BUYER_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: House, group: "Core" },
  { to: "/app/research", label: "Research Hub", icon: MagnifyingGlass, group: "Discovery" },
  { to: "/app/marketplace", label: "Marketplace", icon: Storefront, group: "Discovery" },
  { to: "/app/inquiries", label: "My Inquiries", icon: Question, group: "Discovery" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Diligence" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Engagement" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform" },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp, group: "Platform" },
];

const SELLER_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: House, group: "Core" },
  { to: "/app/listings", label: "My Listings", icon: Tag, group: "Deal Marketing" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Deal Marketing" },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair, group: "Deal Marketing" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Deal Marketing" },
  { to: "/app/inquiries", label: "Inbound Inquiries", icon: Question, group: "Pipeline" },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell, group: "Pipeline", badgeKey: "buyer_alerts" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Pipeline" },
  { to: "/app/leads", label: "Lead Nurturing", icon: Kanban, group: "Pipeline" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Pipeline" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform" },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp, group: "Platform" },
];

const ADMIN_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: ChartBar, group: "Core" },
  { to: "/app/research", label: "Research Hub", icon: MagnifyingGlass, group: "Buyer Tools" },
  { to: "/app/marketplace", label: "Marketplace", icon: Storefront, group: "Buyer Tools" },
  { to: "/app/listings", label: "Listings", icon: Tag, group: "Seller Tools" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Seller Tools" },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair, group: "Seller Tools" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Seller Tools" },
  { to: "/app/inquiries", label: "Inquiries", icon: Question, group: "Pipeline" },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell, group: "Pipeline", badgeKey: "buyer_alerts" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Pipeline" },
  { to: "/app/leads", label: "Leads", icon: Kanban, group: "Pipeline" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Pipeline" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform (Admin)" },
  { to: "/app/mcp", label: "MCP Console", icon: Terminal, group: "Platform (Admin)" },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp, group: "Platform (Admin)" },
  { to: "/app/audit", label: "Audit Logs", icon: ListChecks, group: "Platform (Admin)" },
];

function navFor(role) {
  if (role === "seller") return SELLER_NAV;
  if (role === "admin") return ADMIN_NAV;
  return BUYER_NAV;
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [time, setTime] = useState(new Date());
  const [badges, setBadges] = useState({ buyer_alerts: 0 });

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user || !(user.role === "seller" || user.role === "admin")) return;
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const r = await api.get("/buyer-alerts/count");
        if (!cancelled) setBadges((b) => ({ ...b, buyer_alerts: r.data?.unseen || 0 }));
      } catch { /* silent */ }
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, location.pathname]);

  const NAV = navFor(user?.role);
  const groups = [...new Set(NAV.map((n) => n.group))];
  const isSeller = user?.role === "seller";
  const rolePillClass = user?.role === "seller" ? "pill-amber" : user?.role === "admin" ? "pill-positive" : "pill-gold";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr] grain" data-testid="app-shell">
      {/* Mobile topbar (< lg) */}
      <MobileTopbar />

      {/* Desktop sidebar (>= lg) */}
      <aside className="hidden lg:flex border-r border-[var(--wz-border)] flex-col" data-testid="sidebar">
        <div className="px-6 pt-7 pb-5 border-b border-[var(--wz-border)]">
          <Link to="/app/dashboard" className="flex items-center gap-3" data-testid="brand-link">
            <Logo size="md" testid="sidebar-logo" />
            <div>
              <div className="font-display font-medium tracking-tighter text-lg leading-none">Workz</div>
              <div className="overline mt-1">{isSeller ? "Sell-side console" : user?.role === "admin" ? "Admin · platform" : "Buy-side console"}</div>
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
                  const badge = n.badgeKey ? badges[n.badgeKey] : 0;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 text-sm transition-colors border-l-2 ${
                          isActive
                            ? `${isSeller ? "border-[var(--wz-amber)]" : "border-[var(--wz-gold)]"} text-[var(--wz-text)] bg-[var(--wz-surface-hover)]`
                            : "border-transparent text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] hover:bg-[var(--wz-surface)]"
                        }`
                      }
                    >
                      <Icon size={16} weight="regular" />
                      <span className="flex-1">{n.label}</span>
                      {badge > 0 && (
                        <span
                          data-testid={`badge-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                          className="text-[10px] font-mono-wz px-1.5 py-0.5 rounded-sm bg-[var(--wz-amber)] text-[#1a1a19]"
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--wz-border)] p-4">
          <div className="text-xs text-[var(--wz-text-secondary)] truncate" data-testid="user-name">{user?.name}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`pill ${rolePillClass}`} data-testid="role-pill">{user?.role}</span>
            <span className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] uppercase tracking-widest truncate">
              {user?.organization || "no org"}
            </span>
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => { logout(); navigate("/login"); }}
            className="mt-3 w-full flex items-center justify-between text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] px-3 py-2 rounded-sm transition-colors"
          >
            <span>Sign out</span>
            <SignOut size={14} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-col min-h-screen pb-20 lg:pb-0">
        {/* Demo workspace 48h retention banner */}
        <DemoBanner />
        {/* Desktop topbar (>= lg) */}
        <header className="hidden lg:flex border-b border-[var(--wz-border)] px-8 py-3 items-center justify-between" data-testid="topbar">
          <div className="flex items-center gap-4">
            <div className="dot-blink" />
            <div className="overline truncate">live · {location.pathname}</div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="font-mono-wz text-[var(--wz-text-secondary)]">
              UTC {time.toISOString().substring(11, 19)}
            </span>
            <span className={`pill ${rolePillClass}`}>{isSeller ? "Workz · Sell-side" : user?.role === "admin" ? "Workz · Admin" : "Workz · Buy-side"}</span>
            <ThemeToggle testId="theme-toggle-btn-desktop" />
          </div>
        </header>
        <div className="flex-1 fade-in min-w-0">{children}</div>
      </main>

      {/* Mobile bottom tab bar (< lg) */}
      <BottomTabBar />
    </div>
  );
}
