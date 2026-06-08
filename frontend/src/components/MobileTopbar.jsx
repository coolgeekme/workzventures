import { Link } from "react-router-dom";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import { useAuth } from "../lib/auth";

export default function MobileTopbar() {
  const { user } = useAuth();
  const isSeller = user?.role === "seller";
  const isAdmin = user?.role === "admin";
  return (
    <header
      className="lg:hidden sticky top-0 z-40 w-full backdrop-blur-md border-b border-[var(--wz-border)]"
      style={{
        background: "color-mix(in srgb, var(--wz-bg) 88%, transparent)",
        paddingTop: "env(safe-area-inset-top)",
      }}
      data-testid="mobile-topbar"
    >
      <div className="flex items-center justify-between px-4 h-14">
        <Link to="/app/dashboard" className="flex items-center gap-2" data-testid="mobile-topbar-logo">
          <Logo size="sm" />
          <div className="leading-none">
            <div className="font-display font-medium tracking-tighter text-base">NextCapOS</div>
            <div className="text-[9px] font-mono-wz tracking-widest uppercase text-[var(--wz-text-tertiary)]">
              {isSeller ? "sell-side" : isAdmin ? "admin" : "buy-side"}
            </div>
          </div>
        </Link>
        <ThemeToggle testId="theme-toggle-btn-mobile" />
      </div>
    </header>
  );
}
