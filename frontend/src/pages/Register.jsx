import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { marketingUrl, splitHostingEnabled, appUrl } from "../lib/hostRouting";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import DemoAccounts from "../components/DemoAccounts";

export default function Register() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();

  // Invite-token fast path. Either:
  //   /register?invite_token=XYZ&invite_kind=listing  (or `org`)
  //   /register?next=/accept-listing-invite?token=XYZ (legacy fallback)
  const inviteToken = params.get("invite_token");
  const inviteKindRaw = params.get("invite_kind");
  const inviteKind = inviteKindRaw === "org" || inviteKindRaw === "listing" ? inviteKindRaw : null;

  const [invitePreview, setInvitePreview] = useState(null); // { email, role, listing_name | org_name }
  const [inviteError, setInviteError] = useState(null);

  const [form, setForm] = useState({
    name: "", email: "", password: "", organization: "", role: "buyer",
    org_choice: "none", org_name: "", org_invite_token: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Fetch + apply the invite preview to lock email and role
  useEffect(() => {
    if (!inviteToken || !inviteKind) return;
    const path = inviteKind === "org"
      ? `/org-invites/${inviteToken}`
      : `/listing-invites/${inviteToken}`;
    api.get(path)
      .then((r) => {
        const inv = r.data;
        setInvitePreview({
          email: inv.email,
          role: inv.role,
          name: inviteKind === "org" ? inv.org_name : inv.listing_name,
          invited_by: inv.invited_by_name,
        });
        setForm((f) => ({
          ...f,
          email: inv.email || f.email,
          // For org invites we also auto-fill the legacy org_choice + token
          // so the existing "I have an invite token" radio matches reality.
          ...(inviteKind === "org"
            ? { org_choice: "join", org_invite_token: inviteToken }
            : {}),
        }));
      })
      .catch((err) => {
        setInviteError(err?.response?.data?.detail || "Invite not found or expired");
      });
  }, [inviteToken, inviteKind]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form };
      if (inviteToken && inviteKind === "listing") {
        payload.listing_invite_token = inviteToken;
      }
      if (inviteToken && inviteKind === "org") {
        payload.org_invite_token = inviteToken;
        payload.org_choice = "join";
      }
      const r = await api.post("/auth/register", payload);
      if (r.data?.status === "active" && r.data?.token) {
        // Fast path: account created + activated + invite already accepted.
        setSession({ token: r.data.token, user: r.data.user });
        const target = inviteKind === "org" ? "/app/org" : "/app/listings";
        toast.success("Account created — welcome aboard.");
        if (splitHostingEnabled()) {
          window.location.href = appUrl(target);
          return;
        }
        nav(target);
        return;
      }
      if (r.data?.status === "pending") {
        setSubmitted(true);
        return;
      }
      toast.success("Account created");
      nav("/app/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 grain relative" data-testid="register-success">
        <div className="absolute top-4 right-4"><ThemeToggle /></div>
        <div className="w-full max-w-md wz-card p-8 text-center">
          <div className="text-[var(--wz-positive)] text-4xl mb-3">✓</div>
          <h1 className="font-display text-2xl tracking-tighter font-medium mb-3">Request received</h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mb-6 leading-relaxed">
            Thanks {form.name}. Your access request is awaiting administrator approval.
            We&apos;ll send <span className="text-[var(--wz-text)] font-medium">{form.email}</span> an email
            the moment your account is approved.
          </p>
          <a href={marketingUrl("/")} className="wz-btn wz-btn-ghost text-xs" data-testid="register-success-back-home">Back to home</a>
        </div>
      </div>
    );
  }

  const emailLocked = Boolean(invitePreview?.email);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 grain relative" data-testid="register-page">
      <div className="absolute top-4 left-4 lg:top-6 lg:left-6">
        <a
          data-testid="register-back-home"
          href={marketingUrl("/")}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] transition-colors"
        >
          <ArrowLeft size={12} weight="bold" />
          Back to home
        </a>
      </div>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <form onSubmit={submit} className="wz-card p-6 sm:p-8" data-testid="register-form">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" testid="register-logo" />
          <div className="overline">{invitePreview ? "Accept invitation" : "Request access"}</div>
        </div>
        <h1 className="font-display text-3xl tracking-tighter font-medium mb-2">
          {invitePreview ? "Finish your invite." : "Open a NextCapOS account."}
        </h1>
        <p className="text-sm text-[var(--wz-text-secondary)] mb-7">
          {invitePreview
            ? "We pre-filled your email. Add a name + password and you're in."
            : "Institutional buyers and sellers only."}
        </p>

        {/* Invite banner */}
        {inviteError && (
          <div
            data-testid="register-invite-error"
            className="mb-6 px-3 py-2.5 border border-[var(--wz-danger)]/40 bg-[var(--wz-danger)]/10 text-xs text-[var(--wz-danger)]"
          >
            {inviteError}
          </div>
        )}
        {invitePreview && (
          <div
            data-testid="register-invite-banner"
            className="mb-6 px-3 py-3 border border-[var(--wz-gold)]/40 bg-[var(--wz-gold)]/10 text-xs flex items-start gap-3"
          >
            <EnvelopeSimple size={16} className="text-[var(--wz-gold)] shrink-0 mt-0.5" />
            <div className="text-[var(--wz-text-secondary)] leading-relaxed">
              {invitePreview.invited_by ? (
                <><span className="text-[var(--wz-text)] font-medium">{invitePreview.invited_by}</span> invited </>
              ) : (
                <>You&apos;ve been invited </>
              )}
              you to {inviteKind === "org" ? "join" : "collaborate on"}{" "}
              <span className="text-[var(--wz-gold)] font-medium">{invitePreview.name}</span>{" "}
              as a <span className="text-[var(--wz-gold)]">{(invitePreview.role || "").replace("_", " ")}</span>.
              Finish below — your invite will be applied automatically and you&apos;ll skip the approval queue.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block col-span-2">
            <div className="overline mb-2">Full name</div>
            <input data-testid="reg-name" required className="wz-input" value={form.name} onChange={update("name")} />
          </label>
          <label className="block col-span-2">
            <div className="overline mb-2">Email {emailLocked && <span className="text-[var(--wz-gold)]">· locked to invite</span>}</div>
            <input
              data-testid="reg-email"
              type="email"
              required
              readOnly={emailLocked}
              className="wz-input"
              value={form.email}
              onChange={update("email")}
              title={emailLocked ? "This email is locked because it must match the invite" : undefined}
            />
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
              <option value="agent">Advisor · broker / advisor (both sides)</option>
              <option value="fund_manager">Fund Manager · run funds and LP relationships</option>
            </select>
          </label>
          <label className="block col-span-2">
            <div className="overline mb-2">Password</div>
            <input data-testid="reg-password" type="password" required minLength={6} className="wz-input" value={form.password} onChange={update("password")} />
          </label>
        </div>

        {/* Hide the manual org-choice UI when an invite (of either kind)
            already drives the team association. */}
        {!invitePreview && (
        <div className="mt-6 border border-[var(--wz-border)] p-4">
          <div className="overline mb-3">Team / Organization (optional)</div>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="org_choice"
                value="none"
                checked={form.org_choice === "none"}
                onChange={update("org_choice")}
                data-testid="reg-org-none"
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Work alone</span>
                <span className="text-xs text-[var(--wz-text-tertiary)] block">You can still create or join an org later from your workspace.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="org_choice"
                value="create"
                checked={form.org_choice === "create"}
                onChange={update("org_choice")}
                data-testid="reg-org-create"
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Create a new organization</span>
                <span className="text-xs text-[var(--wz-text-tertiary)] block">For brokers, advisors, funds, and corp-dev teams.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="org_choice"
                value="join"
                checked={form.org_choice === "join"}
                onChange={update("org_choice")}
                data-testid="reg-org-join"
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">I have an invite token</span>
                <span className="text-xs text-[var(--wz-text-tertiary)] block">Paste it below. We&apos;ll auto-add you on approval.</span>
              </span>
            </label>
          </div>
          {form.org_choice === "create" && (
            <label className="block mt-3">
              <div className="overline mb-2">Organization name *</div>
              <input
                data-testid="reg-org-name-input"
                required
                className="wz-input"
                value={form.org_name}
                onChange={update("org_name")}
                placeholder="e.g. Smith Advisory Group"
              />
            </label>
          )}
          {form.org_choice === "join" && (
            <label className="block mt-3">
              <div className="overline mb-2">Invite token *</div>
              <input
                data-testid="reg-org-invite-token-input"
                required
                className="wz-input font-mono-wz text-xs"
                value={form.org_invite_token}
                onChange={update("org_invite_token")}
                placeholder="paste from your invite email"
              />
            </label>
          )}
        </div>
        )}

        <button data-testid="reg-submit" disabled={loading} className="wz-btn wz-btn-gold w-full mt-7">
          {loading ? "Creating…" : invitePreview ? "Create account & accept invite" : "Create account"}
        </button>

        <div className="mt-5 text-xs text-[var(--wz-text-secondary)] text-center">
          Already a buyer?{" "}
          <Link to="/login" className="text-[var(--wz-gold)] hover:underline" data-testid="goto-login">Sign in</Link>
        </div>
      </form>

      {!invitePreview && (
        <div className="mt-8 wz-card p-6 sm:p-8">
          <DemoAccounts />
        </div>
      )}
      </div>
    </div>
  );
}
