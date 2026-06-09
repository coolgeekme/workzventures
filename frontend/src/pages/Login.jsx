import { useState } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";
import { splitHostingEnabled, appUrl, marketingUrl } from "../lib/hostRouting";
import Logo, { WORKZ_HERO_URL } from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import DemoAccounts from "../components/DemoAccounts";

const BG = WORKZ_HERO_URL;

// Demo accounts that the Landing page links to via `?demo=...`
const DEMO_ACCOUNT_PASSWORDS = {
  "alex@workz.example.com": "WorkzPass123!",
  "mira@workz.example.com": "WorkzPass123!",
};

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  // Prefill from ?demo=email@workz.example.com (set by Landing's demo CTAs) — done
  // via lazy useState initializer rather than useEffect to avoid the
  // react-hooks/set-state-in-effect rule.
  const demoEmail = params.get("demo");
  const [email, setEmail] = useState(() =>
    demoEmail && DEMO_ACCOUNT_PASSWORDS[demoEmail] ? demoEmail : "",
  );
  const [password, setPassword] = useState(() =>
    demoEmail && DEMO_ACCOUNT_PASSWORDS[demoEmail] ? DEMO_ACCOUNT_PASSWORDS[demoEmail] : "",
  );
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      const to = loc.state?.from?.pathname || "/app/dashboard";
      // When marketing (nextcapos.com) and app (app.nextcapos.com) are split,
      // hand the just-authenticated user off to the app subdomain. The session
      // cookie is already scoped to `.nextcapos.com`, so the subdomain picks
      // up the JWT seamlessly on load.
      if (splitHostingEnabled()) {
        window.location.href = appUrl(to);
        return;
      }
      nav(to);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 grain" data-testid="login-page">
      <div className="relative hidden lg:block border-r border-[var(--wz-border)]">
        <img src={BG} alt="NextCapOS" className="absolute inset-0 w-full h-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--wz-bg)]/30 via-transparent to-[var(--wz-bg)]/40" />
        <div className="absolute top-10 left-10 right-10">
          <div className="flex items-center gap-3">
            <Logo size="lg" testid="login-logo" />
            <div>
              <div className="font-display tracking-tighter text-xl leading-none">NextCapOS</div>
              <div className="overline mt-1.5">institutional buy & sell-side</div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-10 left-10 right-10">
          <div className="overline">Authorized buyers & sellers only</div>
        </div>
      </div>

      <div className="flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 relative">
        <div className="absolute top-4 left-4 lg:top-6 lg:left-6">
          <a
            data-testid="login-back-home"
            href={marketingUrl("/")}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] transition-colors"
          >
            <ArrowLeft size={12} weight="bold" />
            Back to home
          </a>
        </div>
        <div className="absolute top-4 right-4 lg:top-6 lg:right-6">
          <ThemeToggle />
        </div>
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <Logo size="md" />
            <div>
              <div className="font-display tracking-tighter text-lg leading-none">NextCapOS</div>
              <div className="overline mt-1">institutional buy & sell-side</div>
            </div>
          </div>
          <div className="overline mb-3">Sign in</div>
          <h1 className="font-display text-3xl tracking-tighter font-medium mb-8">
            Welcome back.
          </h1>

          <label className="block">
            <div className="overline mb-2">Email</div>
            <input
              data-testid="login-email"
              type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="wz-input"
              placeholder="alex@institutional.fund"
            />
          </label>

          <label className="block mt-5">
            <div className="overline mb-2">Password</div>
            <input
              data-testid="login-password"
              type="password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="wz-input"
              placeholder="••••••••••••"
            />
          </label>

          <button
            data-testid="login-submit"
            type="submit" disabled={loading}
            className="wz-btn wz-btn-gold w-full mt-7"
          >
            {loading ? "Authenticating…" : "Enter terminal"}
          </button>

          <div className="mt-4 text-center text-xs">
            <Link
              data-testid="login-forgot-link"
              to="/forgot-password"
              className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)] transition-colors"
            >
              Forgot password?
            </Link>
          </div>

          {demoEmail && DEMO_ACCOUNT_PASSWORDS[demoEmail] && (
            <div
              data-testid="demo-login-notice"
              className="mt-5 text-[11px] leading-relaxed border border-[var(--wz-amber)]/40 bg-[var(--wz-amber)]/10 px-3 py-2.5 rounded-sm text-[var(--wz-text-secondary)]"
            >
              <span className="text-[var(--wz-amber)] font-medium">Demo workspace</span> ·
              {" "}content created in this account is auto-deleted after{" "}
              <span className="font-medium text-[var(--wz-text)]">48 hours</span>. Sample
              listings and seeded data stay so platform features remain demo-ready.
            </div>
          )}

          <div className="mt-6 text-xs text-[var(--wz-text-secondary)]">
            No account yet?{" "}
            <Link to="/register" className="text-[var(--wz-gold)] hover:underline" data-testid="goto-register">
              Request access
            </Link>
          </div>

          <div className="mt-10 pt-6 border-t border-[var(--wz-border)]">
            <DemoAccounts compact />
          </div>
        </form>
      </div>
    </div>
  );
}
