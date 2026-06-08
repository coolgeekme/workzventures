import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "", email: "", password: "", organization: "", role: "buyer",
  });
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      toast.success("Account created");
      nav("/app/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 grain relative" data-testid="register-page">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form onSubmit={submit} className="w-full max-w-md wz-card p-6 sm:p-8" data-testid="register-form">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" testid="register-logo" />
          <div className="overline">Request access</div>
        </div>
        <h1 className="font-display text-3xl tracking-tighter font-medium mb-2">
          Open a NextCapOS account.
        </h1>
        <p className="text-sm text-[var(--wz-text-secondary)] mb-7">
          Institutional buyers and sellers only.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block col-span-2">
            <div className="overline mb-2">Full name</div>
            <input data-testid="reg-name" required className="wz-input" value={form.name} onChange={update("name")} />
          </label>
          <label className="block col-span-2">
            <div className="overline mb-2">Email</div>
            <input data-testid="reg-email" type="email" required className="wz-input" value={form.email} onChange={update("email")} />
          </label>
          <label className="block">
            <div className="overline mb-2">Organization</div>
            <input data-testid="reg-org" className="wz-input" value={form.organization} onChange={update("organization")} />
          </label>
          <label className="block">
            <div className="overline mb-2">Role</div>
            <select data-testid="reg-role" className="wz-input" value={form.role} onChange={update("role")}>
              <option value="buyer">Buyer · acquire companies</option>
              <option value="seller">Seller · market portfolio</option>
            </select>
          </label>
          <label className="block col-span-2">
            <div className="overline mb-2">Password</div>
            <input data-testid="reg-password" type="password" required minLength={6} className="wz-input" value={form.password} onChange={update("password")} />
          </label>
        </div>

        <button data-testid="reg-submit" disabled={loading} className="wz-btn wz-btn-gold w-full mt-7">
          {loading ? "Creating…" : "Create account"}
        </button>

        <div className="mt-5 text-xs text-[var(--wz-text-secondary)] text-center">
          Already a buyer?{" "}
          <Link to="/login" className="text-[var(--wz-gold)] hover:underline" data-testid="goto-login">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
