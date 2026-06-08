# Subdomain split — nextcapos.com (marketing) + app.nextcapos.com (platform)

This runbook gets you to the architecture:

```
nextcapos.com         ── public marketing/landing site
app.nextcapos.com     ── authenticated platform (login, dashboard, Vault, etc.)
```

Per Emergent Support: **a single deployment can serve both hostnames**. You add a CNAME at your registrar; the Emergent ingress handles both hosts on the same project.

---

## Step 1 — DNS at your domain registrar

Add **one CNAME** record:

| Type  | Host (Name) | Value (Target)       | TTL  |
|-------|-------------|----------------------|------|
| CNAME | `app`       | `nextcapos.com`      | 300  |

Some registrars don't allow a CNAME at a record whose root has an A record. If `app` CNAME fails, you can use either:
- **A record**: `app` → same IP that `nextcapos.com` resolves to (find via `dig nextcapos.com`)
- **ALIAS / ANAME**: same target as the CNAME — preferred if your registrar supports it.

Propagation: usually 5-30 min. Verify with:

```bash
dig app.nextcapos.com           # should resolve to the same target as nextcapos.com
curl -sI https://app.nextcapos.com/api/    # expect HTTP/2 200
```

---

## Step 2 — Production environment variables (Emergent dashboard)

Set these on the **frontend** environment for the production deployment:

| Variable                     | Value                          |
|------------------------------|--------------------------------|
| `REACT_APP_BACKEND_URL`      | `https://app.nextcapos.com`    |
| `REACT_APP_APP_URL`          | `https://app.nextcapos.com`    |
| `REACT_APP_MARKETING_URL`    | `https://nextcapos.com`        |

Set these on the **backend** environment:

| Variable        | Value                                                       |
|-----------------|-------------------------------------------------------------|
| `CORS_ORIGINS`  | `https://nextcapos.com,https://app.nextcapos.com`           |

`MONGO_URL` and `DB_NAME` stay exactly as they are — both hostnames are served by the same deployment, so they share one database.

---

## Step 3 — Redeploy

Click **Redeploy** in the Emergent dashboard. After redeploy:

1. Visit `https://nextcapos.com` → marketing landing page.
2. Click **Sign in** / **Request access** / any demo CTA → the browser hops to `https://app.nextcapos.com/login` (or `/register`).
3. Sign in → you land on `app.nextcapos.com/app/dashboard`.
4. Click **Logout** → the browser bounces back to `https://nextcapos.com`.

---

## How the code routes between hostnames

- `src/lib/hostRouting.js` — `splitHostingEnabled()` is true only when `REACT_APP_APP_URL` is set, so preview / dev keep working on a single hostname.
- `pages/Landing.jsx` — the four CTAs (`Sign in`, `Request access`, `Open the terminal`, demo `Sign in as …` buttons) render as `<a href="https://app.nextcapos.com/...">` in production and as React Router `<Link>` in dev.
- `components/Layout.jsx` — the logout button uses `window.location.href = REACT_APP_MARKETING_URL` when the split is on, so users land back on the marketing site.

You do not need to change any other code. All authenticated routes (`/app/*`, `/login`, `/register`, `/accept-invite`) are served by both hostnames; the redirects only ensure visitors enter the right one.

---

## Optional polish

- **Apex → app redirect for protected routes** — currently if a user types `https://nextcapos.com/app/dashboard` directly they'll see the app on the apex domain. If you want to enforce that authenticated content only lives on the subdomain, add an early redirect in `App.js`:

  ```js
  useEffect(() => {
    if (splitHostingEnabled() && !onAppHostname() &&
        window.location.pathname.startsWith("/app")) {
      window.location.href = appUrl(window.location.pathname + window.location.search);
    }
  }, []);
  ```

- **App subdomain → apex redirect for marketing routes** — likewise, if a user lands on `https://app.nextcapos.com/` you might want to send them to the marketing site. Same pattern, inverted.

Hold off on these until you've confirmed the basic split works on production.

---

## Troubleshooting

- `app.nextcapos.com` returns SSL error → wait a few minutes; Emergent auto-issues a SAN cert for the new hostname after the DNS lands.
- `CORS blocked` in the browser console → confirm `CORS_ORIGINS` includes both hostnames exactly (`https://` prefix, no trailing slash).
- Login redirects but the JWT isn't visible on the subdomain → expected. Users sign in on `app.nextcapos.com` directly (the apex never holds the token), so there is no token to hand off. If you ever want one-click "Sign in" from the apex to deep-link straight to the dashboard, switch the auth storage from `localStorage` to a cookie scoped to `domain=.nextcapos.com`.
