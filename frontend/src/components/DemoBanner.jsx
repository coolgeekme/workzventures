import { useState } from "react";
import { Warning, X, Clock } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";

const DISMISS_KEY = "wz_demo_banner_dismissed_at";
const DISMISS_TTL_MINUTES = 60; // re-surface after 1h so it isn't permanently hidden

export default function DemoBanner() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return true;
    const ageMin = (Date.now() - Number(raw)) / 60000;
    return ageMin > DISMISS_TTL_MINUTES;
  });

  if (!user?.is_demo || !visible) return null;

  const hours = user.demo_data_retention_hours || 48;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <div
      data-testid="demo-banner"
      className="border-b border-[var(--wz-amber)]/40 bg-[var(--wz-amber)]/10 text-[var(--wz-text)]"
      role="status"
      aria-live="polite"
    >
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-start gap-3">
        <Warning size={18} weight="fill" className="text-[var(--wz-amber)] mt-0.5 shrink-0" />
        <div className="flex-1 text-xs sm:text-sm leading-snug">
          <span className="font-medium">Demo workspace</span>
          <span className="text-[var(--wz-text-secondary)]">
            {" "}— this account is for evaluation only. Anything you create here is{" "}
          </span>
          <span className="inline-flex items-center gap-1 font-medium">
            <Clock size={12} weight="bold" /> auto-deleted after {hours} hours.
          </span>
          <span className="text-[var(--wz-text-secondary)]">
            {" "}Seed listings &amp; sample data are preserved. Do not enter live deal information.
          </span>
        </div>
        <button
          data-testid="demo-banner-dismiss"
          onClick={dismiss}
          className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)] transition-colors shrink-0"
          aria-label="Dismiss demo banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
