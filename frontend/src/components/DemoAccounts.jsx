import { ArrowUpRight, Copy, MagnifyingGlass, Storefront } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const DEMOS = [
  {
    role: "Buyer",
    email: "alex@workz.example.com",
    password: "WorkzPass123!",
    Icon: MagnifyingGlass,
    tagline: "Research Hub · Detailed Analysis · The Vault",
  },
  {
    role: "Seller",
    email: "mira@workz.example.com",
    password: "WorkzPass123!",
    Icon: Storefront,
    tagline: "Deals · Buyer Discovery · Outreach · Newsletter",
  },
];

/**
 * Two seed demo accounts surfaced on the /login and /register pages so
 * visitors can try the platform without signing up. Click-to-copy email /
 * password, plus a one-click "Sign in as Buyer/Seller" button that prefills
 * the login form via ?demo=… query param.
 *
 * Pass `compact` to render a single-row, side-by-side layout — good for the
 * sign-in panel where vertical space is tight. Default is a stacked 2-column
 * grid suitable for the register page.
 */
export default function DemoAccounts({ compact = false }) {
  const copy = (text, label) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {});
  };

  return (
    <div className={compact ? "" : "max-w-2xl"} data-testid="demo-accounts">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>
        Try it now · demo accounts
      </div>
      <div className={`grid grid-cols-1 ${compact ? "" : "sm:grid-cols-2"} gap-3`}>
        {DEMOS.map(({ role, email, password, Icon, tagline }) => (
          <div
            key={role}
            data-testid={`demo-${role.toLowerCase()}`}
            className="border border-[var(--wz-border)] p-3.5 hover:border-[var(--wz-amber)] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className="text-[var(--wz-amber)]" />
              <span className="text-sm font-medium">{role}</span>
            </div>
            <p className="text-[11px] text-[var(--wz-text-secondary)] mb-2.5 leading-relaxed">
              {tagline}
            </p>
            <button
              onClick={() => copy(email, "Email")}
              data-testid={`demo-${role.toLowerCase()}-email`}
              title="Click to copy"
              className="w-full text-left flex items-center justify-between gap-2 text-[11px] font-mono-wz py-1.5 px-2 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] mb-1.5"
            >
              <span className="truncate">{email}</span>
              <Copy size={11} className="text-[var(--wz-text-tertiary)] shrink-0" />
            </button>
            <button
              onClick={() => copy(password, "Password")}
              data-testid={`demo-${role.toLowerCase()}-password`}
              title="Click to copy"
              className="w-full text-left flex items-center justify-between gap-2 text-[11px] font-mono-wz py-1.5 px-2 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] mb-2"
            >
              <span className="truncate">{password}</span>
              <Copy size={11} className="text-[var(--wz-text-tertiary)] shrink-0" />
            </button>
            <Link
              to={`/login?demo=${encodeURIComponent(email)}`}
              data-testid={`demo-${role.toLowerCase()}-login`}
              className="wz-btn wz-btn-gold w-full text-[11px] flex items-center justify-center gap-2"
            >
              Sign in as {role} <ArrowUpRight size={11} />
            </Link>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-3">
        Shared sandbox · do not store real data
      </p>
    </div>
  );
}
