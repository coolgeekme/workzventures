import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";

const BG = "https://static.prod-images.emergentagent.com/jobs/99d61e05-18d6-4593-8525-63fadbb097b3/images/051604875a1f24b758170839747cdade0243dbdcd5308a8e08000fd5dc35d2c1.png";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Authenticated");
      const to = loc.state?.from?.pathname || "/app/dashboard";
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
        <img src={BG} alt="Workz" className="absolute inset-0 w-full h-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--wz-bg)]/40 via-transparent to-[var(--wz-bg)]" />
        <div className="absolute top-10 left-10 right-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[var(--wz-gold)] flex items-center justify-center text-black font-bold font-mono-wz text-sm">W</div>
            <div className="font-display tracking-tighter">Workz Ventures</div>
          </div>
        </div>
        <div className="absolute bottom-10 left-10 right-10">
          <div className="overline mb-3">Authorized buyers only</div>
          <div className="font-display text-3xl tracking-tight max-w-md">
            The control room for institutional buyer engagement.
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
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

          <div className="mt-6 text-xs text-[var(--wz-text-secondary)]">
            No account yet?{" "}
            <Link to="/register" className="text-[var(--wz-gold)] hover:underline" data-testid="goto-register">
              Request access
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
