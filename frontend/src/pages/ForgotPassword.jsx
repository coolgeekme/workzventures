import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch {
      toast.error("Something went wrong");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 grain relative" data-testid="forgot-page">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="w-full max-w-md wz-card p-7">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" />
          <div className="overline">Forgot password</div>
        </div>
        {sent ? (
          <>
            <h1 className="font-display text-2xl tracking-tighter font-medium mb-2">Check your inbox</h1>
            <p className="text-sm text-[var(--wz-text-secondary)] leading-relaxed">
              If <span className="text-[var(--wz-text)] font-medium">{email}</span> matches an account,
              we&apos;ve sent a one-time reset link. It expires in one hour.
            </p>
            <Link to="/login" className="wz-btn wz-btn-ghost text-xs mt-5 inline-block">Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--wz-text-secondary)] mb-5 leading-relaxed">
              Enter your account email — we&apos;ll send a one-time reset link.
            </p>
            <form onSubmit={submit}>
              <label className="block mb-5">
                <div className="overline mb-1.5">Email</div>
                <input data-testid="forgot-email" required type="email" className="wz-input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button data-testid="forgot-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold w-full">
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <div className="mt-4 text-xs text-[var(--wz-text-tertiary)] text-center">
                <Link to="/login" className="hover:text-[var(--wz-text)]">Back to sign in</Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
