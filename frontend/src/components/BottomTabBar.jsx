import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  House, MagnifyingGlass, Storefront, Files, Question, Tag,
  DotsThreeOutline, X, SignOut, ChartBar,
  NotePencil, PaperPlaneTilt, Kanban, EnvelopeSimple, Plugs, Terminal, ChartLineUp, ListChecks, ShieldCheck,
  Crosshair, Bell,
} from "@phosphor-icons/react";

// 4 pinned tabs per role; 5th tab is always "More"
const BUYER_TABS = [
  { to: "/app/dashboard", label: "Home", icon: House },
  { to: "/app/research", label: "Research", icon: MagnifyingGlass },
  { to: "/app/marketplace", label: "Market", icon: Storefront },
  { to: "/app/rooms", label: "Vault", icon: Files },
];
const SELLER_TABS = [
  { to: "/app/dashboard", label: "Home", icon: House },
  { to: "/app/listings", label: "Listings", icon: Tag },
  { to: "/app/inquiries", label: "Inbox", icon: Question },
  { to: "/app/rooms", label: "Vault", icon: Files },
];
const ADMIN_TABS = [
  { to: "/app/dashboard", label: "Home", icon: ChartBar },
  { to: "/app/inquiries", label: "Inbox", icon: Question },
  { to: "/app/rooms", label: "Vault", icon: Files },
  { to: "/app/audit", label: "Audit", icon: ListChecks },
];

const MORE_BUYER = [
  { to: "/app/inquiries", label: "My Inquiries", icon: Question },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple },
  { to: "/app/security", label: "Security", icon: ShieldCheck },
  { to: "/app/composio", label: "Integrations", icon: Plugs },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp },
];
const MORE_SELLER = [
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt },
  { to: "/app/leads", label: "Lead Nurturing", icon: Kanban },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple },
  { to: "/app/security", label: "Security", icon: ShieldCheck },
  { to: "/app/composio", label: "Integrations", icon: Plugs },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp },
];
const MORE_ADMIN = [
  { to: "/app/research", label: "Research Hub", icon: MagnifyingGlass },
  { to: "/app/marketplace", label: "Marketplace", icon: Storefront },
  { to: "/app/listings", label: "Listings", icon: Tag },
  { to: "/app/buyers", label: "Buyer Discovery", icon: Crosshair },
  { to: "/app/buyer-alerts", label: "Buyer Alerts", icon: Bell },
  { to: "/app/collateral", label: "Collateral", icon: NotePencil },
  { to: "/app/outreach", label: "Outreach", icon: PaperPlaneTilt },
  { to: "/app/leads", label: "Leads", icon: Kanban },
  { to: "/app/newsletter", label: "Newsletter", icon: EnvelopeSimple },
  { to: "/app/security", label: "Security", icon: ShieldCheck },
  { to: "/app/composio", label: "Integrations", icon: Plugs },
  { to: "/app/mcp", label: "MCP Console", icon: Terminal },
  { to: "/app/agents", label: "Agent Monitor", icon: ChartLineUp },
];

const COLLAB_TABS = [
  { to: "/app/listings", label: "Listings", icon: Tag },
  { to: "/app/rooms", label: "Vault", icon: Files },
  { to: "/app/org", label: "Org", icon: ChartBar },
  { to: "/app/security", label: "Security", icon: ShieldCheck },
];
const MORE_COLLAB = []; // collab-only users have no platform-wide tools

function tabsFor(role, accountScope) {
  if (accountScope === "collaborator") return { primary: COLLAB_TABS, more: MORE_COLLAB };
  if (role === "seller") return { primary: SELLER_TABS, more: MORE_SELLER };
  if (role === "admin") return { primary: ADMIN_TABS, more: MORE_ADMIN };
  return { primary: BUYER_TABS, more: MORE_BUYER };
}

export default function BottomTabBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { primary, more } = tabsFor(user?.role, user?.account_scope);
  const isCollabOnly = user?.account_scope === "collaborator";
  const accent = isCollabOnly ? "var(--wz-gold)" : user?.role === "seller" ? "var(--wz-amber)" : user?.role === "admin" ? "var(--wz-positive)" : "var(--wz-gold)";
  const rolePillClass = isCollabOnly ? "pill" : user?.role === "seller" ? "pill-amber" : user?.role === "admin" ? "pill-positive" : "pill-gold";

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--wz-border)] backdrop-blur-xl"
        style={{
          background: "color-mix(in srgb, var(--wz-surface) 90%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        data-testid="bottom-tab-bar"
      >
        <div className="grid grid-cols-5 h-16">
          {primary.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                data-testid={`tab-bar-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-1 transition-colors ${
                    isActive ? "text-[var(--wz-text)]" : "text-[var(--wz-text-tertiary)]"
                  }`
                }
                style={({ isActive }) => isActive ? { color: accent } : undefined}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={22} weight={isActive ? "fill" : "regular"} />
                    <span className="text-[10px] font-medium tracking-wide">{t.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            onClick={() => setOpen(true)}
            data-testid="tab-bar-more"
            id="tab-more"
            className="flex flex-col items-center justify-center gap-1 text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]"
          >
            <DotsThreeOutline size={22} weight="regular" />
            <span className="text-[10px] font-medium tracking-wide">More</span>
          </button>
        </div>
      </nav>

      {/* More sheet */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50"
          onClick={() => setOpen(false)}
          data-testid="more-sheet-backdrop"
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--wz-bg)",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderTop: "1px solid var(--wz-border)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            data-testid="more-sheet"
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full" style={{ background: "var(--wz-border)" }} />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--wz-border)]">
              <div>
                <div className="overline">More</div>
                <div className="text-sm font-medium mt-0.5" data-testid="more-sheet-user">{user?.name}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                data-testid="more-sheet-close"
                className="h-9 w-9 inline-flex items-center justify-center rounded-sm hover:bg-[var(--wz-surface-hover)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-3 py-2">
              {more.map((m) => {
                const Icon = m.icon;
                return (
                  <NavLink
                    key={m.to}
                    to={m.to}
                    onClick={() => setOpen(false)}
                    data-testid={`more-sheet-${m.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-3 text-sm rounded-sm transition-colors ${
                        isActive
                          ? "bg-[var(--wz-surface-hover)] text-[var(--wz-text)]"
                          : "text-[var(--wz-text-secondary)] hover:bg-[var(--wz-surface)] hover:text-[var(--wz-text)]"
                      }`
                    }
                  >
                    <Icon size={18} />
                    <span className="flex-1">{m.label}</span>
                  </NavLink>
                );
              })}
            </div>
            <div className="px-5 pt-2 pb-5 border-t border-[var(--wz-border)] mt-2">
              <div className="flex items-center gap-2 mb-3">
                <span className={`pill ${rolePillClass}`}>{user?.role}</span>
                <span className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)] truncate">
                  {user?.organization || "no org"}
                </span>
              </div>
              <button
                onClick={() => { setOpen(false); logout(); navigate("/login"); }}
                data-testid="more-sheet-sign-out"
                className="w-full flex items-center justify-center gap-2 py-3 text-sm border border-[var(--wz-border)] hover:border-[var(--wz-negative)] hover:text-[var(--wz-negative)] rounded-sm transition-colors"
              >
                <SignOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
