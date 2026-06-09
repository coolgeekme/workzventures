import { ArrowUpRight, ChartLineUp, Terminal, Compass, Copy, MagnifyingGlass, Storefront } from "@phosphor-icons/react";
import { toast } from "sonner";
import Logo, { WORKZ_HERO_URL } from "../components/Logo";

const HERO_IMG = WORKZ_HERO_URL;

// The landing page lives on the marketing apex (nextcapos.com). All auth CTAs
// (sign in, register, demo sign-ins) must route the visitor over to the
// authenticated platform that lives on the app subdomain.
const APP_HOST = "https://app.nextcapos.com";
const appHref = (path = "/") => `${APP_HOST}${path.startsWith("/") ? path : `/${path}`}`;

export default function Landing() {
  return (
    <div className="min-h-screen grain" data-testid="landing">
      <header className="border-b border-[var(--wz-border)] px-4 sm:px-6 lg:px-8 py-4 lg:py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 lg:gap-4 min-w-0">
          <Logo size="lg" testid="landing-logo" />
          <div className="min-w-0">
            <div className="font-display font-medium tracking-tighter text-base sm:text-xl leading-none truncate">NextCapOS</div>
            <div className="overline mt-1.5 hidden sm:block">Institutional Buy &amp; Sell-Side OS</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a href={appHref("/login")} data-testid="cta-signin" className="wz-btn-ghost wz-btn text-xs sm:text-sm">Sign in</a>
          <a href={appHref("/register")} data-testid="cta-getstarted" className="wz-btn wz-btn-gold text-xs sm:text-sm">Request access</a>
        </div>
      </header>

      <section className="px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 lg:pt-20 pb-12 lg:pb-24 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-12 items-center max-w-[1400px] mx-auto">
        <div>
          <div className="overline mb-4 sm:mb-6">NextCapOS · 2026 platform</div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-tighter font-medium leading-[1.02]">
            Where institutional<br />
            <span className="text-[var(--wz-gold)]">buyers</span> meet<br />
            <span className="italic">AI Agents.</span>
          </h1>
          <p className="mt-6 sm:mt-8 text-[var(--wz-text-secondary)] max-w-xl leading-relaxed text-sm sm:text-base">
            NextCapOS pairs an institutional-grade Buyer Research Hub with AI Agents that handle prospecting, outreach, and marketing collateral end-to-end. Buyers get curated research and personalized newsletters tailored to their interests.
          </p>

          <div className="mt-8 sm:mt-10 flex flex-wrap gap-3">
            <a href={appHref("/register")} className="wz-btn flex items-center gap-2" data-testid="hero-register">
              Open the terminal <ArrowUpRight size={16} />
            </a>
            <a href={appHref("/login")} className="wz-btn-ghost wz-btn flex items-center gap-2" data-testid="hero-login">
              Sign in
            </a>
          </div>

          <DemoAccounts />

          <div className="mt-10 sm:mt-14 grid grid-cols-3 gap-4 sm:gap-6 max-w-lg">
            {[
              { k: "$14.7B", v: "AUM under coverage" },
              { k: "142d", v: "avg exit velocity" },
              { k: "97.4%", v: "agent success rate" },
            ].map((s) => (
              <div key={s.k}>
                <div className="font-mono-wz text-lg sm:text-xl text-[var(--wz-text)]">{s.k}</div>
                <div className="overline mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative h-[280px] sm:h-[400px] lg:h-[520px] wz-card overflow-hidden">
          <img src={HERO_IMG} alt="NextCapOS" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute top-3 right-3 sm:top-5 sm:right-5 flex items-center gap-2 px-3 py-1.5 bg-[var(--wz-bg)]/70 backdrop-blur border border-[var(--wz-border)]">
            <div className="dot-blink" />
            <span className="overline text-[var(--wz-text)]">live · online</span>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--wz-border)] px-4 sm:px-6 lg:px-8 py-12 lg:py-20 max-w-[1400px] mx-auto">
        <div className="overline mb-4">Capabilities</div>
        <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight font-medium max-w-2xl">
          A unified control room for the modern M&A marketing team.
        </h2>

        <div className="mt-8 lg:mt-12 wz-grid grid-cols-1 md:grid-cols-3">
          {[
            { i: Compass, t: "Buyer Research Hub", d: "Get an instant institutional brief on any company — profile, leadership, market signals, and sources you can trust." },
            { i: ChartLineUp, t: "Personalized Newsletters", d: "Curated deal spotlights, market analyses, and portfolio updates delivered to your inbox, tailored to your interests." },
            { i: Terminal, t: "AI Agents that work for you", d: "AI Agents prospect targets, draft outreach, and prepare marketing collateral so your team can focus on closing deals." },
          ].map((f) => {
            const Icon = f.i;
            return (
              <div key={f.t} className="p-6 lg:p-8">
                <Icon size={22} className="text-[var(--wz-gold)]" />
                <div className="mt-4 lg:mt-6 font-display text-lg lg:text-xl tracking-tight">{f.t}</div>
                <div className="mt-2 text-sm text-[var(--wz-text-secondary)] leading-relaxed">{f.d}</div>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-[var(--wz-border)] px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex flex-col sm:flex-row gap-2 sm:gap-0 justify-between text-xs text-[var(--wz-text-tertiary)]">
        <span className="font-mono-wz">WORKZ // 2026</span>
        <span>Designed for today. Built for tomorrow. Focused on forever.</span>
      </footer>
    </div>
  );
}

/* ============================================================================
 * DemoAccounts — surfaces the two seed accounts so visitors can poke around
 * without signing up. Copy-on-click. Each row routes to /login with email
 * prefilled via query param.
 * ========================================================================== */
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
    tagline: "Listings · Buyer Discovery · Outreach · Newsletter",
  },
];

function DemoAccounts() {
  const copy = (text, label) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {});
  };
  return (
    <div className="mt-10 max-w-2xl" data-testid="demo-accounts">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>
        Try it now · demo accounts
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DEMOS.map(({ role, email, password, Icon, tagline }) => (
          <div
            key={role}
            data-testid={`demo-${role.toLowerCase()}`}
            className="border border-[var(--wz-border)] p-4 hover:border-[var(--wz-amber)] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className="text-[var(--wz-amber)]" />
              <span className="text-sm font-medium">{role}</span>
            </div>
            <p className="text-xs text-[var(--wz-text-secondary)] mb-3 leading-relaxed">{tagline}</p>
            <button
              onClick={() => copy(email, "Email")}
              data-testid={`demo-${role.toLowerCase()}-email`}
              title="Click to copy"
              className="w-full text-left flex items-center justify-between gap-2 text-xs font-mono-wz py-1.5 px-2 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] mb-1.5"
            >
              <span className="truncate">{email}</span>
              <Copy size={11} className="text-[var(--wz-text-tertiary)] shrink-0" />
            </button>
            <button
              onClick={() => copy(password, "Password")}
              data-testid={`demo-${role.toLowerCase()}-password`}
              title="Click to copy"
              className="w-full text-left flex items-center justify-between gap-2 text-xs font-mono-wz py-1.5 px-2 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] mb-2"
            >
              <span className="truncate">{password}</span>
              <Copy size={11} className="text-[var(--wz-text-tertiary)] shrink-0" />
            </button>
            <a
              href={appHref(`/login?demo=${encodeURIComponent(email)}`)}
              data-testid={`demo-${role.toLowerCase()}-login`}
              className="wz-btn wz-btn-gold w-full text-xs flex items-center justify-center gap-2"
            >
              Sign in as {role} <ArrowUpRight size={11} />
            </a>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-3">
        Shared sandbox · do not store real data
      </p>
    </div>
  );
}
