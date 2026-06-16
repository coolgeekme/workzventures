import { Link } from "react-router-dom";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import { useAuth } from "../lib/auth";
import { useAgentMode } from "../lib/agentMode";

export default function MobileTopbar() {
  const { user } = useAuth();
  const [agentMode, setAgentMode] = useAgentMode();
  const isAgent = user?.role === "agent";
  const effectiveRole = isAgent ? agentMode : user?.role;
  const isSeller = effectiveRole === "seller";
  const isAdmin = effectiveRole === "admin";
  const subtitle = isAgent
    ? `agent · ${isSeller ? "sell-side" : "buy-side"}`
    : isSeller ? "sell-side" : isAdmin ? "admin" : "buy-side";
  return (
    <header
      className="lg:hidden sticky top-0 z-40 w-full backdrop-blur-md border-b border-[var(--wz-border)]"
      style={{
        background: "color-mix(in srgb, var(--wz-bg) 88%, transparent)",
        paddingTop: "env(safe-area-inset-top)",
      }}
      data-testid="mobile-topbar"
    >
      <div className="flex items-center justify-between px-4 h-14 gap-2">
        <Link to="/app/dashboard" className="flex items-center gap-2 min-w-0" data-testid="mobile-topbar-logo">
          <Logo size="sm" />
          <div className="leading-none min-w-0">
            <div className="font-display font-medium tracking-tighter text-base truncate">NextCapOS</div>
            <div className="text-[9px] font-mono-wz tracking-widest uppercase text-[var(--wz-text-tertiary)] truncate">
              {subtitle}
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {isAgent && (
            <div className="flex items-center border border-[var(--wz-border)]" data-testid="agent-mode-switcher-mobile">
              <button
                onClick={() => setAgentMode("buyer")}
                data-testid="agent-mode-buyer-mobile"
                className={`px-2 py-1 text-[9px] font-mono-wz uppercase tracking-widest transition-colors ${
                  agentMode === "buyer"
                    ? "border-l-2 border-[var(--wz-gold)] text-[var(--wz-text)] bg-[var(--wz-surface-hover)]"
                    : "text-[var(--wz-text-tertiary)]"
                }`}
              >
                B
              </button>
              <button
                onClick={() => setAgentMode("seller")}
                data-testid="agent-mode-seller-mobile"
                className={`px-2 py-1 text-[9px] font-mono-wz uppercase tracking-widest transition-colors ${
                  agentMode === "seller"
                    ? "border-l-2 border-[var(--wz-amber)] text-[var(--wz-text)] bg-[var(--wz-surface-hover)]"
                    : "text-[var(--wz-text-tertiary)]"
                }`}
              >
                S
              </button>
            </div>
          )}
          <ThemeToggle testId="theme-toggle-btn-mobile" />
        </div>
      </div>
    </header>
  );
}
