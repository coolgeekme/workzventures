import { Link } from "react-router-dom";
import { ArrowUpRight, ChartLineUp, Terminal, Compass } from "@phosphor-icons/react";
import Logo, { WORKZ_HERO_URL } from "../components/Logo";

const HERO_IMG = WORKZ_HERO_URL;

export default function Landing() {
  return (
    <div className="min-h-screen grain" data-testid="landing">
      <header className="border-b border-[var(--wz-border)] px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Logo size="lg" testid="landing-logo" />
          <div>
            <div className="font-display font-medium tracking-tighter text-xl leading-none">Workz Ventures</div>
            <div className="overline mt-1.5">AI-Augmented Marketing Agency</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" data-testid="cta-signin" className="wz-btn-ghost wz-btn text-sm">Sign in</Link>
          <Link to="/register" data-testid="cta-getstarted" className="wz-btn wz-btn-gold text-sm">Request access</Link>
        </div>
      </header>

      <section className="px-8 pt-20 pb-24 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center max-w-[1400px] mx-auto">
        <div>
          <div className="overline mb-6">Workz Ventures · 2026 platform</div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-tighter font-medium leading-[1.02]">
            Where institutional<br />
            <span className="text-[var(--wz-gold)]">buyers</span> meet<br />
            <span className="italic">AI Agents.</span>
          </h1>
          <p className="mt-8 text-[var(--wz-text-secondary)] max-w-xl leading-relaxed">
            Workz pairs an institutional-grade Buyer Research Hub with AI Agents that handle prospecting, outreach, and marketing collateral end-to-end. Buyers get curated research and personalized newsletters tailored to their interests.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/register" className="wz-btn flex items-center gap-2" data-testid="hero-register">
              Open the terminal <ArrowUpRight size={16} />
            </Link>
            <Link to="/login" className="wz-btn-ghost wz-btn flex items-center gap-2" data-testid="hero-login">
              Sign in
            </Link>
          </div>

          <div className="mt-14 grid grid-cols-3 gap-6 max-w-lg">
            {[
              { k: "$14.7B", v: "AUM under coverage" },
              { k: "142d", v: "avg exit velocity" },
              { k: "97.4%", v: "agent success rate" },
            ].map((s) => (
              <div key={s.k}>
                <div className="font-mono-wz text-xl text-white">{s.k}</div>
                <div className="overline mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative h-[520px] wz-card overflow-hidden">
          <img src={HERO_IMG} alt="Workz" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute top-5 right-5 flex items-center gap-2 px-3 py-1.5 bg-[var(--wz-bg)]/70 backdrop-blur border border-[var(--wz-border)]">
            <div className="dot-blink" />
            <span className="overline text-white">live · online</span>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--wz-border)] px-8 py-20 max-w-[1400px] mx-auto">
        <div className="overline mb-4">Capabilities</div>
        <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight font-medium max-w-2xl">
          A unified control room for the modern M&A marketing team.
        </h2>

        <div className="mt-12 wz-grid grid-cols-1 md:grid-cols-3">
          {[
            { i: Compass, t: "Buyer Research Hub", d: "Get an instant institutional brief on any company — profile, leadership, market signals, and sources you can trust." },
            { i: ChartLineUp, t: "Personalized Newsletters", d: "Curated deal spotlights, market analyses, and portfolio updates delivered to your inbox, tailored to your interests." },
            { i: Terminal, t: "AI Agents that work for you", d: "AI Agents prospect targets, draft outreach, and prepare marketing collateral so your team can focus on closing deals." },
          ].map((f) => {
            const Icon = f.i;
            return (
              <div key={f.t} className="p-8">
                <Icon size={22} className="text-[var(--wz-gold)]" />
                <div className="mt-6 font-display text-xl tracking-tight">{f.t}</div>
                <div className="mt-2 text-sm text-[var(--wz-text-secondary)] leading-relaxed">{f.d}</div>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-[var(--wz-border)] px-8 py-8 flex justify-between text-xs text-[var(--wz-text-tertiary)]">
        <span className="font-mono-wz">WORKZ // 2026</span>
        <span>Designed for today. Built for tomorrow. Focused on forever.</span>
      </footer>
    </div>
  );
}
