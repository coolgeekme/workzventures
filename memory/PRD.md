# Workz Ventures — Enhanced AI-Driven Buyer & Marketing Agency

## Original problem statement
Build an enterprise platform that combines:
- Composio OAuth for LinkedIn + other professional networks
- JWT-based registration/login with RBAC
- WebMCP declarative + imperative tasks exposed via `data-mcp-action` and `navigator.mcpActions.register()` for AI browsing agents (Claude in Chrome, LangChain, Hermes)
- Buyer Research Hub that synthesizes public + market data into AI-curated company briefs
- AI-personalized newsletters with draft/approve/dispatch
- Audit logging, agent activity monitoring, and Composio-managed token gateway

## User choices (Feb 2026 build)
- MVP scope: All features (broader, shallow but functional end-to-end)
- AI model: Claude Sonnet 4.5 via Emergent LLM key
- Auth: JWT email/password
- Composio API key: provided (real); Resend email: MOCKED
- Email delivery: MOCKED only

## Architecture
- **Backend**: FastAPI · MongoDB · JWT (pyjwt + bcrypt) · `emergentintegrations` (Claude Sonnet 4.5 via Emergent LLM key) · httpx → Composio v3
- **Frontend**: React 19 · React Router · shadcn/ui · sonner toasts · @phosphor-icons/react · Cabinet Grotesk + IBM Plex Sans + JetBrains Mono · dark theme (#08080A + gold #C8A97E)
- **WebMCP**: `navigator.mcpActions.register()` shim + `data-mcp-action` DOM attributes; 9 actions exposed; public manifest at `/api/mcp/manifest`

## User personas
- **Buyer** — institutional investor consuming research + newsletters
- **Analyst** — generates collateral, runs outreach campaigns
- **Admin** — manages connections, audits

## Core requirements (static)
- Enterprise-grade JWT auth with audit trail
- AI research summaries on any company (not just internal portfolio)
- AI-drafted personalized newsletters with approve→dispatch
- WebMCP action surface for autonomous agents
- Composio gateway for LinkedIn OAuth
- Full audit + diagnostics

## What's been implemented (2026-05-20)
- Auth: register, login, /me, RBAC (`buyer | seller | admin`; legacy `analyst` auto-migrated to `buyer`)
- **Role-differentiated workspaces** (added 2026-05-20)
- **Brand integration**: official Workz Ventures lion + wordmark logo across sidebar, landing hero, login splash, register card, and favicon; landing/login backdrop uses the official key visual "Designed for Today · Built for Tomorrow · Focused on Forever"
- **Role-gated nav & routes** (added 2026-05-20)
  - Buyer/Seller no longer see MCP Console or Audit Logs in the sidebar
  - Direct URL access to `/app/mcp` and `/app/audit` is gated to `role === "admin"` via `<AdminOnly>` route wrapper
  - "Composio" page label and nav label renamed to "Integrations" (route `/app/composio` unchanged for compatibility)
  - All user-visible "Claude" mentions replaced with "AI"/"AI researcher" so the underlying LLM can be swapped without rewording the UI
- **Real-time grounded research** (added 2026-05-20)
  - `/api/research/company` now calls Perplexity Sonar Pro (`sonar-pro`) and Brave Search in parallel via `asyncio.gather`, merges deduped numbered sources, then passes the grounded context to Claude Sonnet 4.5 for the final structured brief
  - Brief includes inline `[n]` citations across text fields (market_signals, investor_take, etc.) plus a sources list with title, URL, provider (perplexity/brave), and age
  - Frontend Research Hub shows a "live web research" pill on the brief header and renders a Sources panel with clickable URLs
  - End-to-end latency ~32-35s (within 60s ingress budget); fail-soft if either provider returns an error
- **Role-aware newsletter** (added 2026-05-20)
  - **Buyer** → `POST /api/newsletter/personal` generates AND delivers a Workz-branded personal digest in one call (recipient = self, `kind=personal`, `recipients=1`). UI reframed as "Workz Ventures, curated for you · Send to my inbox".
  - **Seller** → `POST /api/newsletter/draft` (now gated to seller/admin) creates a `kind=broadcast` draft → approve → dispatch fans out to buyer-role opted-in users only. UI reframed as "Reach the entire buyer base · Draft broadcast".
  - Cross-role calls are 403-gated; legacy newsletter docs without `kind` are backfilled to "broadcast" on read.
- **Seller Collateral from listing** (added 2026-05-20): seller-only "Generate from a listing" picker on `/app/collateral` pre-fills deal name, target audience (sector + geography), and key points (summary + financials + highlights) from any of the seller's own listings. Manual entry still works.
- **Deal Room module** (added 2026-05-20, enhanced iter-7 2026-05-20)
  - NDA-gated workspace per (listing × buyer × seller) inquiry — opens once inquiry flips to `engaged`
  - **Status lifecycle**: pending_nda → active → closed
  - **NDA e-signature (iter-7)**: 5-clause confidentiality terms in scrollable card; buyer types full legal name (min 2 chars) + ticks ESIGN-Act ack checkbox; backend persists `nda_signed_name`, `nda_signed_by_user_id`, `nda_accepted_by_buyer_at`. Active rooms show "NDA e-signed by …" badge.
  - **DRL templates** (7 sectors, was 6): SaaS, Healthcare, **E-commerce / DTC (NEW)**, Industrial/Manufacturing, FinServ, ClimateTech, Consumer/Retail
  - **GridFS binary uploads (iter-7)**: `POST /api/deal-rooms/{rid}/files/binary` accepts multipart PDF/DOCX/TXT/MD/CSV ≤25 MB; stores in GridFS bucket `deal_room_files_fs`; extracts per-page text via pypdf / python-docx / utf-8. Legacy text-paste endpoint kept.
  - `GET /api/deal-rooms/{rid}/files/{fid}/download` streams binary with `Content-Disposition: attachment`; audit-logged.
  - **AI auto-matching**: seller upload → Claude maps to best open DRL request → marks `satisfied`
  - **AI Findings with page citations (iter-7)**: `citation` now includes `filename`, `page` (int), `excerpt`. UI renders "{filename} · p.N".
  - 14 endpoints (added `/files/binary`, `/files/{fid}/download`); 4 collections + 1 GridFS bucket
  - Frontend routes `/app/rooms` + `/app/rooms/:id` registered (iter-7 fix — were importing without route entries)
- Buyer Research Hub, Marketing Collateral Generator, Outreach, Lead Nurturing, Newsletter (personal + broadcast), MCP Console (admin), Agent Monitor, Integrations (LinkedIn + Zoho CRM via Composio), Audit Logs (admin)
- Backend tests: **86/86 pass** (was 73/73 before iter-7)

## Prioritized backlog
**P1**
- Convert long-running Claude endpoints (research, newsletter) to async job pattern (POST → 202 + job id, GET to poll) for headroom beyond 60s ingress
- Real Resend integration for newsletter dispatch
- Pagination on `/api/agents/activity` and `/api/audit/logs`

**P2**
- Split `server.py` into routers/ modules
- Restrict CORS to known origins
- Add Composio webhook handler for OAuth callback (currently stored as pending)
- Add MORE professional network connectors (Twitter/X, Slack, HubSpot via Composio)
- Add subscription tiers (premium buyers get faster Claude responses / more research credits)

## Seed credentials
See `/app/memory/test_credentials.md` — `alex@workz.example.com / WorkzPass123!`

## Mocked
- Newsletter email dispatch (Resend MOCKED — flips status to `dispatched` + records recipient count)
- Outreach campaign launch (LinkedIn delivery MOCKED — flips status to `launched` + records sent count)
