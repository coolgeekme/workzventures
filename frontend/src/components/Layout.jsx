import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAgentMode } from "../lib/agentMode";
import { useFundContext } from "../lib/fundContext";
import { api } from "../lib/api";
import { splitHostingEnabled, marketingUrl } from "../lib/hostRouting";
import {
  House, MagnifyingGlass, NotePencil, PaperPlaneTilt, Kanban,
  EnvelopeSimple, Plugs, Terminal, ChartLineUp, ListChecks, SignOut,
  Storefront, Tag, Question, ChartBar, Files, ShieldCheck, Crosshair, Bell, Lock, UsersThree, Buildings,
  Coins,
} from "@phosphor-icons/react";
import { roleLabel } from "../lib/roleLabels";
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
  { to: "/app/valuations", label: "Valuations", icon: Coins, group: "Diligence" },
  { to: "/app/private-locker", label: "Private Locker", icon: Lock, group: "Diligence" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Engagement" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/org", label: "My Team", icon: Buildings, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform" },
  { to: "/app/agents", label: "Automation Monitor", icon: ChartLineUp, group: "Platform" },
];

const SELLER_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: House, group: "Core" },
  { to: "/app/listings", label: "My Deals", icon: Tag, group: "Deal Marketing" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Deal Marketing" },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair, group: "Deal Marketing" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Deal Marketing" },
  { to: "/app/inquiries", label: "Inbound Inquiries", icon: Question, group: "Pipeline" },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell, group: "Pipeline", badgeKey: "buyer_alerts" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Pipeline" },
  { to: "/app/leads", label: "Lead Nurturing", icon: Kanban, group: "Pipeline" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Pipeline" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/org", label: "My Team", icon: Buildings, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform" },
  { to: "/app/agents", label: "Automation Monitor", icon: ChartLineUp, group: "Platform" },
];

const ADMIN_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: ChartBar, group: "Core" },
  { to: "/app/research", label: "Research Hub", icon: MagnifyingGlass, group: "Buyer Tools" },
  { to: "/app/marketplace", label: "Marketplace", icon: Storefront, group: "Buyer Tools" },
  { to: "/app/listings", label: "Deals", icon: Tag, group: "Seller Tools" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Seller Tools" },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair, group: "Seller Tools" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Seller Tools" },
  { to: "/app/inquiries", label: "Inquiries", icon: Question, group: "Pipeline" },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell, group: "Pipeline", badgeKey: "buyer_alerts" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Pipeline" },
  { to: "/app/private-locker", label: "Private Locker", icon: Lock, group: "Pipeline" },
  { to: "/app/funds", label: "Fund Dashboard", icon: ChartLineUp, group: "Pipeline" },
  { to: "/app/valuations", label: "Valuations", icon: Coins, group: "Pipeline" },
  { to: "/app/leads", label: "Leads", icon: Kanban, group: "Pipeline" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Pipeline" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/org", label: "My Team", icon: Buildings, group: "Platform (Admin)" },
  { to: "/app/admin/users", label: "Users", icon: UsersThree, group: "Platform (Admin)" },
  { to: "/app/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, group: "Platform (Admin)" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform (Admin)" },
  { to: "/app/mcp", label: "MCP Console", icon: Terminal, group: "Platform (Admin)" },
  { to: "/app/agents", label: "Automation Monitor", icon: ChartLineUp, group: "Platform (Admin)" },
  { to: "/app/audit", label: "Audit Logs", icon: ListChecks, group: "Platform (Admin)" },
];

// Fund Manager (Phase 1). Every entry below points at a page that already
// exists and already has real data — no placeholders. The fund-specific
// pages (Fund Dashboard, Portfolio, Limited Partners, Meetings) arrive in
// Phases 2-5 and slot into the "Fund Management" group.
const FUND_NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: House, group: "Core" },
  { to: "/app/funds", label: "Fund Dashboard", icon: ChartLineUp, group: "Fund Management" },
  { to: "/app/org", label: "My Team", icon: Buildings, group: "Fund Management" },
  { to: "/app/rooms", label: "The Vault", icon: Files, group: "Diligence" },
  { to: "/app/valuations", label: "Valuations", icon: Coins, group: "Diligence" },
  { to: "/app/private-locker", label: "Private Locker", icon: Lock, group: "Diligence" },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil, group: "Engagement" },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt, group: "Engagement" },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple, group: "Engagement" },
  { to: "/app/listings", label: "Deals", icon: Tag, group: "M&A" },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair, group: "M&A" },
  { to: "/app/inquiries", label: "Inquiries", icon: Question, group: "M&A" },
  { to: "/app/composio", label: "Integrations", icon: Plugs, group: "Platform" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Platform" },
  { to: "/app/agents", label: "Automation Monitor", icon: ChartLineUp, group: "Platform" },
];

const COLLAB_NAV = [
  { to: "/app/listings", label: "My Collaborations", icon: Tag, group: "Deals" },
  { to: "/app/security", label: "Security", icon: ShieldCheck, group: "Account" },
];

// Agent role = buyer + seller workspace combined. Pulls from both BUYER_NAV
// and SELLER_NAV (de-duped) so a broker can act as either side without
// swapping accounts. Org is surfaced under Platform.
const AGENT_NAV = (() => {
  const seen = new Set();
  const items = [];
  for (const item of [...BUYER_NAV, ...SELLER_NAV]) {
    if (seen.has(item.to)) continue;
    seen.add(item.to);
    items.push(item);
  }
  return items;
})();

/**
 * Nav entries unlocked by a permission rather than by the primary role.
 *
 * A user can hold several roles — Fund Manager as their main one, Admin as an
 * add-on, or the reverse. The primary role decides the shape of the nav; these
 * fill in what the add-on roles grant, so a role that was actually assigned is
 * never invisible in the UI. Each entry is matched against the permissions the
 * backend reports for the session, so custom roles work the same way built-in
 * ones do.
 */
const PERMISSION_NAV = [
  { perm: "funds.read", item: { to: "/app/funds", label: "Fund Dashboard", icon: ChartLineUp, group: "Fund Management" } },
  { perm: "users.manage", item: { to: "/app/admin/users", label: "Users", icon: UsersThree, group: "Platform (Admin)" } },
  { perm: "roles.manage", item: { to: "/app/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, group: "Platform (Admin)" } },
  { perm: "audit.read", item: { to: "/app/audit", label: "Audit Logs", icon: ListChecks, group: "Platform (Admin)" } },
];

/** Primary-role nav, plus anything the user's other roles unlock. */
function navWithPermissions(baseNav, permissions) {
  if (!permissions) return baseNav;
  const present = new Set(baseNav.map((n) => n.to));
  const extra = PERMISSION_NAV
    .filter(({ perm, item }) => permissions[perm] && !present.has(item.to))
    .map(({ item }) => item);
  return extra.length ? [...baseNav, ...extra] : baseNav;
}

function navFor(role, accountScope) {
  // Rule 2: collaborator-only accounts get a stripped-down nav regardless of
  // their declared role. They land on the single listing(s) they collaborate
  // on and have no access to platform-wide tools.
  if (accountScope === "collaborator") return COLLAB_NAV;
  if (role === "seller") return SELLER_NAV;
  if (role === "fund_manager") return FUND_NAV;
  if (role === "admin") return ADMIN_NAV;
  // For "agent", caller should pass the agent's current workspace mode
  // ("buyer" | "seller") instead of "agent" — this is handled below in
  // Layout via `effectiveRole`. Falling through to AGENT_NAV keeps the
  // function safe if it's ever called with role="agent" directly.
  if (role === "agent") return AGENT_NAV;
  return BUYER_NAV;
}

/**
 * Segmented toggle that lets agents swap their workspace between Buyer and
 * Seller mode. Rendered in the desktop topbar and mobile topbar.
 */
function AgentModeSwitcher({ mode, onChange, dense = false }) {
  const btn = (label, value, activeCls) => (
    <button
      key={value}
      onClick={() => onChange(value)}
      data-testid={`agent-mode-${value}`}
      className={`${dense ? "px-2 py-1" : "px-3 py-1"} text-[10px] font-mono-wz uppercase tracking-widest transition-colors ${
        mode === value
          ? `${activeCls} text-[var(--wz-text)] bg-[var(--wz-surface-hover)]`
          : "text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      data-testid="agent-mode-switcher"
      className="flex items-center border border-[var(--wz-border)]"
      title={`You're acting as ${mode === "buyer" ? "a buyer" : "a seller"}. Switch mode to see the other workspace.`}
    >
      {btn("Buyer", "buyer", "border-l-2 border-[var(--wz-gold)]")}
      {btn("Seller", "seller", "border-l-2 border-[var(--wz-amber)]")}
    </div>
  );
}

/**
 * Fund context switcher. Sets the global "which fund" scope that every
 * fund-scoped page reads. Shown only for fund managers (and admins), and
 * only once at least one fund exists — with none, it prompts to create one
 * rather than rendering an empty dropdown.
 */
function FundSwitcher({ funds, fundId, onSelect, loading }) {
  if (loading) {
    return (
      <span className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)]">
        loading funds…
      </span>
    );
  }
  if (!funds.length) {
    return (
      <span
        data-testid="fund-switcher-empty"
        className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)]"
        title="Create a fund to scope these pages to it"
      >
        no fund yet
      </span>
    );
  }
  return (
    <select
      data-testid="fund-switcher"
      value={fundId || ""}
      onChange={(e) => onSelect(e.target.value)}
      title="Which fund these pages are scoped to"
      className="bg-transparent border border-[var(--wz-border)] text-xs px-2 py-1 text-[var(--wz-text)] focus:outline-none"
    >
      {funds.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
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
    if (!user || user.account_scope === "collaborator") return;
    if (!(user.role === "seller" || user.role === "admin")) return;
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

  const [agentMode, setAgentMode] = useAgentMode();
  // Fund scope is only fetched for roles that can actually have funds.
  const isFundManager = user?.role === "fund_manager" || user?.role === "admin";
  const { funds, fundId, selectFund, loading: fundsLoading } = useFundContext(isFundManager);
  // For role="agent" the nav, chrome accents and pills follow whichever
  // workspace mode the agent is currently in. Other roles are unaffected.
  const effectiveRole = user?.role === "agent" ? agentMode : user?.role;
  // Rule 2/3: collab-only users (no owned listings, no org-admin) get a
  // restricted nav + upgrade CTA. Computed live on the backend per request.
  const isCollabOnly = user?.account_scope === "collaborator";
  // Collaborator accounts keep their restricted nav untouched — that
  // restriction is deliberate and must not be widened by a stray permission.
  const NAV = isCollabOnly
    ? navFor(effectiveRole, user?.account_scope)
    : navWithPermissions(navFor(effectiveRole, user?.account_scope), user?.permissions);
  const groups = [...new Set(NAV.map((n) => n.group))];
  const isSeller = effectiveRole === "seller";
  const isAgent = user?.role === "agent" && !isCollabOnly;
  const rolePillClass = isCollabOnly
    ? "pill"
    : effectiveRole === "seller"
      ? "pill-amber"
      : effectiveRole === "admin"
        ? "pill-positive"
        : effectiveRole === "fund_manager"
          ? "pill-positive"
          : "pill-gold";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr] grain" data-testid="app-shell">
      {/* Mobile topbar (< lg) */}
      <MobileTopbar />

      {/* Desktop sidebar (>= lg) */}
      <aside className="hidden lg:flex border-r border-[var(--wz-border)] flex-col" data-testid="sidebar">
        <div className="px-6 pt-7 pb-5 border-b border-[var(--wz-border)]">
          <Link to="/app/listings" className="flex items-center gap-3" data-testid="brand-link">
            <Logo size="md" testid="sidebar-logo" />
            <div>
              <div className="font-display font-medium tracking-tighter text-lg leading-none">NextCapOS</div>
              <div className="overline mt-1">
                {isCollabOnly
                  ? "Collaborator · deal-scoped"
                  : isAgent
                    ? `Advisor · ${isSeller ? "Sell-side" : "Buy-side"} mode`
                    : isSeller
                      ? "Sell-side console"
                      : user?.role === "fund_manager"
                        ? "Fund Manager console"
                        : user?.role === "admin"
                          ? "Admin · platform"
                          : "Buy-side console"}
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {isCollabOnly && (
            <div
              data-testid="collab-upgrade-cta"
              className="mb-5 mx-1 p-4 border border-[var(--wz-gold)]/40 bg-[var(--wz-gold)]/5"
            >
              <div className="overline mb-2 text-[var(--wz-gold)]">Become a full member</div>
              <p className="text-xs text-[var(--wz-text-secondary)] leading-relaxed mb-3">
                You&apos;re collaborating on deals as a guest. Unlock Buyer Discovery,
                Outreach, Newsletter, your own Vault and more.
              </p>
              <a
                href="mailto:team@nextcapos.com?subject=Upgrade%20to%20full%20member"
                data-testid="collab-upgrade-link"
                className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-gold)] hover:underline"
              >
                Contact sales &rsaquo;
              </a>
            </div>
          )}
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
            <span className={`pill ${rolePillClass}`} data-testid="role-pill">{roleLabel(user?.role)}</span>
            <span className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] uppercase tracking-widest truncate">
              {user?.organization || "no org"}
            </span>
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => {
              logout();
              // Marketing site lives on the apex; bounce visitors back to it
              // once we run on app.* — otherwise stay on the app for /login.
              if (splitHostingEnabled()) {
                window.location.href = marketingUrl("/");
              } else {
                navigate("/login");
              }
            }}
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
            {isAgent && <AgentModeSwitcher mode={agentMode} onChange={setAgentMode} />}
            {isFundManager && !isCollabOnly && (
              <FundSwitcher funds={funds} fundId={fundId} onSelect={selectFund} loading={fundsLoading} />
            )}
            <span className="font-mono-wz text-[var(--wz-text-secondary)]">
              UTC {time.toISOString().substring(11, 19)}
            </span>
            <span className={`pill ${rolePillClass}`}>
              {isCollabOnly
                ? "NextCapOS · Collaborator"
                : isAgent
                  ? `Advisor · ${isSeller ? "Sell-side" : "Buy-side"}`
                  : isSeller
                    ? "NextCapOS · Sell-side"
                    : user?.role === "fund_manager"
                      ? "NextCapOS · Fund Manager"
                      : user?.role === "admin"
                        ? "NextCapOS · Admin"
                        : "NextCapOS · Buy-side"}
            </span>
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
