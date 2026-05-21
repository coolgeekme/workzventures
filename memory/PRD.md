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

## What's been implemented (2026-05-21 — iter-8 mobile + theme system)
- **Mobile-first responsive layout** (breakpoint <1024px)
  - Desktop 260px sidebar hidden on <lg; replaced with `MobileTopbar` (logo + theme toggle, sticky, env(safe-area-inset-top)) and `BottomTabBar` (5 tabs, fixed bottom, env(safe-area-inset-bottom))
  - Bottom tab bar items vary by role — Buyer: Home/Research/Market/Vault/More · Seller: Home/Listings/Inbox/Vault/More · Admin: Home/Inbox/Vault/Audit/More. Active tab uses role accent (gold/amber/positive).
  - `MoreSheet` (slide-up bottom sheet) holds remaining nav items + role pill + sign-out; opens via "More" tab, dismisses via drag-handle/backdrop/close button
  - Global `px-8 py-8` → `px-4 sm:px-6 lg:px-8 py-6 lg:py-8` across 17 pages
  - Landing/Login/Register fully responsive (single column on mobile, splash hidden, form-side gets inline logo on mobile)
  - DealRoomDetail tabs strip is horizontally scrollable on mobile; DRL row grid collapses 3-col → 2-col
- **Theme system: Dark / Light / Auto**
  - `ThemeProvider` (lib/theme.jsx) persists preference to `localStorage[wz-theme-preference]`; "auto" follows `prefers-color-scheme` via matchMedia listener
  - `ThemeToggle` component (Moon/Sun/Monitor icons) cycles dark → light → auto; mounted in MobileTopbar AND desktop Layout header
  - **Light theme** = warm-paper aesthetic — bg #FAFAF7, surface #F2F1EB, text #1A1A19, gold darkened to #9E7B45, amber to #D97B00, positive #008A2E, negative #D92D20. Shadcn HSL tokens fully overridden for [data-theme="light"]. WCAG AA contrast.
  - Hardcoded `text-white/bg-black/text-black/border-white` classes auto-overridden in light theme via global CSS (avoids touching 28 files)
  - ThemedToaster: position=top-center + offset=72 on mobile (avoids topbar collision), top-right on desktop; theme prop follows resolved theme
  - Viewport meta updated with viewport-fit=cover; theme-color media queries flip per OS preference
- Frontend tests (iter-8): **43/44 functional checks pass** (1 UX bug — toast/toggle collision — fixed: removed redundant "Authenticated" toast on login)

## What's been implemented (2026-05-21 — iter-9 cryptographic security)
- **OpenTimestamps Bitcoin-anchored notarization** — `security_service.py` submits SHA-256 digests to 3 free public OTS calendars (alice/bob/finney), merges responses into a single `DetachedTimestampFile`, and persists `.ots` bytes in Mongo `ots_proofs` collection. Auto-fires on: NDA e-signature, Vault file upload, AI findings generation, inquiry status → engaged/passed, and every 25th audit-log entry (chain checkpoint). Endpoint set: `GET /api/security/proofs` (scoped by role), `GET /api/security/proofs/{id}/download` (.ots binary), `POST /api/security/proofs/{id}/upgrade` (fetch BTC attestation when available), `POST /api/security/verify` (multipart: any user can verify an .ots + digest).
- **AES-256-GCM at-rest encryption** for Vault files — Master key from `WORKZ_FILE_ENCRYPTION_KEY` env (32 bytes base64). Per-file 12-byte nonce + AAD bound to `roomid:fileid`. Plaintext SHA-256 stored alongside ciphertext for verification. Download transparently decrypts; metadata flags `encrypted: true, encryption_alg: 'AES-256-GCM'`.
- **Tamper-evident hash-chained audit log** — each entry stores `seq`, `prev_hash`, `content_hash`. `GET /api/security/audit/verify` (admin-only) re-walks the chain and returns `chain_valid` + `broken_at` if anyone has tampered. Periodic OTS anchoring of chain head.
- **Auth hardening**: bcrypt (unchanged), password complexity (≥8 chars, ≥1 letter, ≥1 digit, returns 400), brute-force lockout (5 fails / 15 min → 429), security headers middleware (HSTS, X-Frame-Options:DENY, X-Content-Type-Options:nosniff, Referrer-Policy, Permissions-Policy on every response).
- **`/app/security` page**: 4-tile posture grid (Bitcoin-anchored · At-rest encryption · Tamper-evident audit chain · Auth hardening), full proof list with `.ots` download + "check confirmation" upgrade + Bitcoin-block-explorer links once confirmed, "Verify a proof" modal, admin-only chain verifier, self-verify CLI instructions. Mounted on desktop sidebar and mobile More sheet for all 3 roles.
- New deps: `opentimestamps==0.4.5`, `pycryptodomex==3.23.0`, `python-bitcoinlib==0.12.2` (cryptography 48 already present).
- Backend tests (iter-9): **21/21 pytest pass · 100% frontend UI pass · zero bugs**. Admin acct now seeded for chain-verifier happy-path regression.

## What's been implemented (2026-05-21 — iter-10 Cryptographic Provenance Certificate)
- **`GET /api/deal-rooms/{rid}/certificate`** generates a per-Vault PDF artifact suitable for handing to a regulator, court, or counterparty. Aggregates: deal/buyer/seller metadata, NDA e-signature status with signer + timestamp, full Bitcoin-anchored event timeline (every OTS proof for this room/inquiry sorted by time), Vault file inventory (filename, folder, size, plaintext SHA-256, AES-GCM flag), AI findings summary (up to 8), audit-chain anchor (seq + last_hash + timestamp), and a copy-pasteable `ots verify` CLI snippet. QR code links back to /app/security.
- **`provenance.py`** new module using ReportLab Platypus + qrcode. Brand palette matches platform light theme (warm paper / graphite / dark gold). 2-page typical render in ~0.5s. Page chrome on every page (cert ID, page numbers, verification footer).
- **Self-notarizing**: the generated PDF itself is hashed and submitted to OpenTimestamps as `kind='vault.certificate'` — anyone can later prove the certificate existed in its exact form at issuance time.
- Audit logged with action `dealroom.certificate.generate` (cert_id, proof_count, file_count in meta).
- Auth scoping: room participants (buyer/seller) + admin can download; third parties get 403; non-existent room 404.
- Frontend: "Provenance certificate" button in DealRoomDetail header next to the status pill. Disabled when room is pending_nda. Responsive label collapse on mobile ("Certificate"). Click triggers blob download with sensible filename.
- New deps: `reportlab==4.5.1`, `qrcode==8.2`.
- Backend tests (iter-10): **11/11 certificate tests pass · 20/21 security regression** (same 1 pre-existing skip as iter-9) · audit chain valid across 472 entries. Reusable test file at `/app/backend/tests/test_provenance_certificate.py`.

## What's been implemented (2026-05-21 — iter-11 CRUD + Messaging + Collateral Distribution)
- **Deletes everywhere users generate content** — `DELETE` endpoints for `/research/{id}`, `/inquiries/{id}` (soft), `/deal-rooms/{id}` (soft), `/newsletter/{id}` (hard if draft, soft if dispatched), `/outreach/campaigns/{id}` (hard if draft, soft if launched), `/collateral/{id}` (hard + version snapshots purged). All list endpoints now filter `{deleted_at: {$exists: False}}` to hide soft-deleted items. Audit-log entries on every action; OTS chain preserved for soft-deleted artifacts.
- **Inquiry messaging (chat thread)** — new `inquiry_messages` collection, `GET /api/inquiries/{iid}/messages` + `POST` for both buyer & seller. Auto-marks unseen messages as read, increments `message_count`, stores `last_message_at`/`last_message_preview` on the inquiry. Participant-only.
- **Buyer interests + newsletter prefs** — `PATCH /api/me/interests` sets `interests[]`, `newsletter_opt_in`, `newsletter_cadence` (weekly|biweekly|monthly).
- **Seller editable broadcasts** — `PATCH /api/newsletter/{id}` updates title/content/sectors/recipient_ids before dispatch.
- **Outreach edit** — `PATCH /api/outreach/campaigns/{id}` updates name/persona/brief/draft/audience_size while in draft state.
- **Collateral edit + versioning** — `PATCH /api/collateral/{id}` snapshots current state into `collateral_versions` then applies the patch. `GET /api/collateral/{id}/versions` returns history.
- **Collateral distribution (4 actions)**:
  - `GET /api/collateral/{id}/pdf` — branded ReportLab one-pager
  - `POST /api/collateral/{id}/attach-to-listing` — surfaces on marketplace card
  - `POST /api/collateral/{id}/push-to-vault` — encrypts PDF with AES-256-GCM, stores in GridFS, creates `deal_room_files` row + `vault.file` OTS proof
  - `POST /api/collateral/{id}/send-to-inquiry` — drops the collateral into the inquiry chat thread as an attachment
- **Frontend**: Inquiries rewritten with inline chat thread + withdraw/dismiss. Collateral page gets inline edit-in-place + 4 distribution dropdowns. Outreach gets inline edit/save/cancel + Delete. ResearchHub, DealRooms list, Newsletter (buyer digest + seller broadcast) all get trash-icon delete affordances.
- Backend tests (iter-11): **18/18 new pytest cases pass** · 1 backend bug found by testing agent and fixed (push-to-vault was leaking Mongo `_id` ObjectId → 500). Reusable test file at `/app/backend/tests/test_iter11_crud.py`.

## What's been implemented (2026-05-21 — iter-12 Buyer Discovery Phase 1 + Newsletter recipients gap-fill)
- **Buyer Discovery (sell-side prospecting)** — `POST /api/buyer-discovery/listings/{lid}/scan` pulls last-540-days 8-K filings from SEC EDGAR full-text search (`efts.sec.gov`, polite UA `Workz Ventures reggie+workz@disciplinedhustle.com`), dedupes per acquirer, then ranks 0-100 with Claude Sonnet 4.5 on sector/size/geo/cadence fit. Matches with score ≥ 70 fire a Buyer Alert. UK Companies House code path is wired but stubbed (no `COMPANIES_HOUSE_API_KEY` — returns []). End-to-end latency ~17-20s per listing.
- Endpoints: `/buyer-discovery/overview`, `/buyer-discovery/listings/{lid}/scan|matches`, `/buyer-discovery/matches/{mid}` (PATCH/DELETE), `/buyer-discovery/matches/{mid}/add-to-leads`, `/buyer-discovery/matches/{mid}/generate-outreach`, `/buyer-alerts` (list/count/mark-seen/mark-all-seen/delete).
- Collections: `buyer_matches`, `buyer_alerts`, `buyer_scans` (last-scan ledger per listing).
- **Background rescan scheduler** — asyncio task started in `@app.on_event("startup")` wakes every hour, finds `status=live` listings whose `last_scanned_at` is older than `BUYER_DISCOVERY_RESCAN_HOURS` (default 24), and rescans with a concurrency cap of 2 to be polite to SEC.
- **Frontend** — new pages `/app/buyers` (BuyerDiscovery.jsx, listing-tab strip with top-score chips, ranked match cards with fit-bar viz, action cluster: Add-to-leads / Draft-outreach / Save / Skip / Delete, SEC filing link) and `/app/buyer-alerts` (BuyerAlerts.jsx, all/unseen filter, Mark-all-seen). Sidebar nav: 'Buyer Discovery' (Crosshair icon, Deal Marketing group), 'Buyer Alerts' (Bell icon with numeric unseen-badge polled every 60s, Pipeline group). Mobile More-sheet wired.
- **Newsletter "Edit Recipients" editor (gap fill)** — new `GET /api/newsletter/recipient-candidates` lists opted-in buyers; `PATCH /api/newsletter/{nid}` already accepted `recipient_ids[]`. Dispatch now honors hand-picked IDs (defense-in-depth: only counts those that remain opted-in buyers at dispatch time). RecipientEditor subcomponent renders on draft/approved broadcast cards with filter, select-all, clear, save controls.
- Backend tests (iter-12): **26/27 pytest pass** (1 environmental skip). 4 backend bugs found + fixed: (a) `edgar_buyer_signals` crashed on None `file_description`, (b-d) missing role gates on `delete_buyer_match`, `mark_buyer_alert_seen`, `mark_all_buyer_alerts_seen`, `delete_buyer_alert`. Test file: `/app/backend/tests/test_buyer_discovery.py`.
- New env: `SEC_USER_AGENT`, `BUYER_DISCOVERY_RESCAN_HOURS` in `backend/.env`.

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
