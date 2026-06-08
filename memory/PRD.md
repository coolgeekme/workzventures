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
- Backend tests (iter-11): **18/18 new pytest cases pass** · 1 backend bug found by testing agent and fixed (push-to-vault was leaking Mongo `_id` ObjectId → 500). Reusable test file at `/app/backend/tests/test_iter11_crud.py`.## What's been implemented (2026-06-05 — iter-14 Buyer Detailed Analysis · Kenshin Phase 1)
- **POST /api/research/detailed** — buyer/admin queue an async 14-section institutional analysis. Returns `{id, status:"pending"}` immediately; background worker transitions pending→analyzing→completed|failed. Avoids the 60s kubernetes ingress timeout.
- Pipeline (`backend/detailed_analysis.py`): Perplexity Sonar + 4 Brave queries (general/finance/news/competitors) gathered in parallel, then Claude 4.5 with grounded `[n]` source citations produces a strict 14-section JSON: executiveSummary (with recommendation: strong-buy|buy|hold|pass), companyOverview, marketAnalysis, competitiveLandscape, financialAnalysis, managementTeam, technologyIP, riskAssessment, complianceAndLegal, dueDiligenceQuestions, valuation, metrics with source URLs, keyStrengths, keyRisks, strategicRecommendations. ~60-180s end-to-end.
- **GET/DELETE /api/research/detailed** + `GET /research/detailed/{rid}/pdf` (ReportLab via `backend/detailed_report_pdf.py` — matches the Provenance Certificate's brand palette).
- **POST /api/research/detailed/{rid}/attach** — promotes the PDF into either a Vault (`room_id`) as AES-256-GCM-encrypted `deal_room_files` row, or into a Listing data room (`listing_id`) where it later auto-clones into every Vault. Buyer cannot attach to a pending_nda vault; admin bypasses ownership.
- **OpenTimestamps notarization** of the report's data hash (fire-and-forget).
- Frontend: `pages/DetailedReport.jsx` (14 section nav chips + auto-polling while pending + full report renderer + Attach panel + PDF export); `pages/ResearchHub.jsx` adds "Run Detailed Analysis" button to research result; route `/app/research/detailed/:rid`.
- Backend tests: **18/18 fast pytest pass** + 2 slow async-pipeline tests skipped to save LLM time (main agent manually verified Linear → 161s → 13 sources → BUY → 28KB valid PDF).
- Iter-14 fixes: DELETE idempotency (now 404 on second delete), missing button re-applied in ResearchHub.jsx after a merge dropped it.


- **Pre-stage data room per listing** — sellers upload documents to a listing once; they live in a new `listing_staged_files` collection + `listing_staged_files_fs` GridFS bucket. AES-256-GCM at rest with per-file AAD `listing:{lid}:{file_id}`.
- **Auto-clone into every Vault opened from that listing** — `_clone_listing_files_into_room` runs as part of `POST /api/inquiries/{iid}/open-room`; staged files are decrypted, re-encrypted with vault-bound AAD `{room_id}:{new_file_id}`, and inserted into `deal_room_files` with `cloned_from_listing_file` provenance.
- **Endpoints**: `GET/POST/DELETE /api/listings/{lid}/staged-files`, `GET /api/listings/{lid}/staged-files/{fid}/download`. 25 MB cap, 7 folder buckets (financials/legal/hr/it/operations/commercial/other), buyer role → 403 everywhere.
- **Frontend** — `ListingDataRoom` collapsible card on every listing in `MyListings.jsx` (file picker + folder + note + AES-256 pill on each row, download/remove actions). Vault header now has a prominent **"Upload document"** button (`data-testid=header-upload-btn`) that switches to the Files tab and focuses the upload input — visible to sellers/admin on both `pending_nda` and `active` rooms.
- Backend tests (iter-13): **9/9 pytest pass** including the full round-trip: stage → inquire → engage → open-room → buyer NDA → buyer download → SHA-256 plaintext match. Suite: `/app/backend/tests/test_listing_dataroom.py`.


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

## What's been implemented (2026-06-07 — iter-15 Demo Account Retention)
- **48-hour demo data retention** for `alex@`, `mira@`, and `admin@workz.example.com`. New `backend/demo_cleanup.py` module + hourly background sweeper started from `seed_demo()`. On each pass it deletes demo-user-owned rows older than 48 h from: `research`, `detailed_reports`, `collateral`, `outreach`, `newsletters`, `leads`, `watchlist`, `agent_activity`, `composio_connections`, plus cascade-deletes their `listings` (non-seed) → `listing_staged_files` (with GridFS blob removal) → `inquiries` → `inquiry_messages` → `deal_rooms` → `deal_room_files` (with GridFS blob removal) / `deal_room_findings` / `deal_room_messages` / `deal_room_requests`, plus `buyer_matches` / `buyer_alerts` / `buyer_scans`. Audit logs preserved to keep the hash-chain intact.
- **Seed preservation**: every seeded listing/deal now carries `is_seed: true` and is excluded from the sweep. `seed_demo_user()` reseeds Helios MedTech, Atlas Logistics, and Vertex Climate on startup whenever the seed listings count drops to zero, so platform features stay demo-ready.
- **Demo flag on the wire**: `UserPublic` now exposes `is_demo` and `demo_data_retention_hours`. New endpoints `GET /api/demo/retention-info` (any authed user) and `POST /api/admin/demo/purge` (admin manual trigger). Backfill on startup tags any existing demo users with `is_demo: true`.
- **Frontend notice**: new `components/DemoBanner.jsx` mounted at the top of `Layout` — amber strip with warning glyph, clock icon, dismiss button (re-surfaces hourly via `localStorage`). Login page shows an inline amber notice when arriving via `?demo=...`.
- Backend tests (iter-15): **5/5 pass** at `/app/backend/tests/test_demo_cleanup.py` covering `is_demo` flag, retention-info endpoint, admin-only purge, seed-survives-purge, and fresh-content-not-purged.

## What's been implemented (2026-06-07 — iter-15.1 Detailed Report polling resilience)
- **Bug fix** for "Failed to load" state on `/app/research/detailed/:rid`. A transient poll failure during the 2-3 minute Claude+Brave+Perplexity pipeline (504, network blip) used to permanently nuke the polling UI even after the report finished. Now: polling failures only surface an error when no report has been loaded yet; once data is in hand, transient failures are swallowed. Successful poll clears prior error state.
- **Recoverable error screen**: new amber warning UI with a `Retry` button (re-fetches the doc) and a `Back to Research Hub` button. No more "refresh the whole page" dead-end. `data-testid="detailed-error"`, `data-testid="retry-load-btn"`.
- File: `frontend/src/pages/DetailedReport.jsx` (load callback hardened, error block restyled).

## What's been implemented (2026-06-07 — iter-16 Buyer Private Locker)
- **New buyer-only document drawer.** Sellers cannot see, list, or download anything in here — server-side RBAC on `_private_locker_guard` blocks role≠buyer at the API. Other buyers can't see each other's files either (scoped by `user_id`).
- **Two scopes**: `workspace` (cross-deal templates, partner memos, internal scoring rubrics) and `listing` (attached to a specific listing being evaluated, surfaces with the listing's display name).
- **Storage**: dedicated GridFS bucket `private_locker_fs`, AES-256-GCM at-rest encryption with AAD bound to `user_id:file_id`, plaintext sha256 stored, OpenTimestamps notarization fired async, 25 MB cap.
- **API**: `GET /api/private-locker/files?listing_id=&scope=`, `POST /api/private-locker/files` (multipart: file, optional listing_id, folder, note), `GET /api/private-locker/files/{fid}/download`, `DELETE /api/private-locker/files/{fid}`.
- **UI**: new `/app/private-locker` page wired into BUYER + ADMIN sidebars under Diligence. Includes privacy assurance banner ("Strictly private. AES-256-GCM. Sellers, other buyers, and Workz operators cannot view this drawer."), All / Workspace / Per-listing filter tabs, listing dropdown, upload modal with optional listing attachment.
- **Demo cleanup**: `private_locker_files` collection added to the 48 h sweep with GridFS blob cascade.
- Backend tests (iter-16): **5/5 pass** at `/app/backend/tests/test_private_locker.py` covering upload, listing-scoped + workspace-scoped, download round-trip, seller-blocked RBAC, cross-buyer isolation, delete idempotency.

## What's been implemented (2026-06-08 — iter-17 Shared Vault demo + login UX)
- **Q&A clarification.** Confirmed that the Vault model already grants symmetric access: `participant_check` (server.py L2712) returns `'buyer'|'seller'|'admin'` if `user.id in {room.buyer_id, room.seller_id}`. Both parties already could list rooms, view files, download, and ask the AI Co-pilot. The friction was that demo accounts had zero rooms to demonstrate it on.
- **Seed Vault** between Alex (buyer) and Mira (seller) on Helios MedTech, status `active`, `is_seed: True`. Three text-only seed files (`Helios_CIM_summary.md`, `Q4_2024_financial_snapshot.md`, `DD_Risks_register.md`) — two seller-uploaded, one buyer-uploaded — so the Vault Co-pilot has real context. Verified Claude cites the correct source file when asked from either side.
- **Seed Vault is purge-proof**: `is_seed: True` flag on the inquiry, deal_room, and deal_room_files makes the 48h demo cleanup skip them, ensuring demo evaluators always see a working Vault.
- **Back-to-home link** added to top-left of `/login` (`data-testid="login-back-home"`). Visitors who arrive at login can return to the marketing landing page without using the browser back button.
- Backend tests (iter-17): **5/5 pass** at `/app/backend/tests/test_shared_vault.py` covering seed-vault dual visibility, identical file set for both parties, 403 for outsiders, Co-pilot answers for both roles with citations, seed-vault survives the demo purge.

## What's been implemented (2026-06-08 — iter-18 Inquiry → Vault UX rewrite)
- **Root issue identified.** User reported "as a buyer, I sent an inquiry and was passed by the seller. I still have no access to vault data." This is a terminology trap: in M&A `passed` = "we passed on it" = **declined**, so no Vault should open. Generic users misread it as "approved/passed-through."
- **Renamed status labels in UI** (DB values unchanged for API stability): `new → New`, `reviewing → Reviewing`, `engaged → Accepted`, `passed → Declined`. New shared helper at `/app/frontend/src/lib/inquiryStatus.js` providing `INQUIRY_STATUS_LABEL`, `INQUIRY_STATUS_DESCRIPTION`, `INQUIRY_TRIAGE_LABEL`, `INQUIRY_TRIAGE_CONFIRM`.
- **Confirm dialog** on the seller side when declining: "This will decline the inquiry. The buyer will NOT get access to the Vault for this listing. They will be notified that you passed. Continue?"
- **Buyer-side contextual notes** under each inquiry:
  - `Declined` → red note: "The seller declined this inquiry… 'Passed' is M&A shorthand for 'we're passing on this'. No Vault will be opened…"
  - `Accepted` (Vault not yet opened) → green note: "Seller accepted your inquiry. Waiting for them to open the Vault…"
  - `Vault open` → gold note: "Vault open. Accept the NDA inside the Vault to unlock files and the AI Co-pilot."
- **Empty-state copy** on the Vault list page now explains the full lifecycle and what `Declined` means.
- Backend tests (iter-18): **2/2 pass** at `/app/backend/tests/test_inquiry_to_vault.py` — verifying `passed` does NOT create a Vault (buyer's rooms list stays empty, force-open returns 400) and the full `engaged → open-room → buyer accepts NDA → active` lifecycle works end-to-end.

## What's been implemented (2026-06-08 — iter-19 Listing Data Room ≠ Vault clarity)
- **Root issue**: user uploaded a PDF on a new listing (Prahsys) and looked for it in the Vault. The Listing Data Room is a *pre-NDA staging area* — files only auto-clone into a Vault once a buyer's inquiry is `Accepted` and the seller clicks **Open Vault**.
- **Amber explainer banner** added on top of the expanded Data Room: *"This is not a Vault yet. Files here live in this listing's Data Room. A Vault is created per-buyer when you mark their inquiry as Accepted and click Open Vault. Everything staged here is auto-copied into that Vault the moment it opens — so the buyer can read it as soon as they sign the NDA."*
- **Upload toast** now includes a descriptive subtitle so the seller immediately knows what happened: *"Stored in this listing's Data Room. It will auto-copy into a Vault the moment a buyer's inquiry is Accepted and you open one."* (7 s duration).
- **Vault empty state inversion fixed**: the seller branch and buyer branch were swapped — sellers were being shown buyer copy. Seller empty state now reads: *"No active Vaults yet. A Vault opens when you mark a buyer's inquiry as Accepted on the Inquiries page and click Open Vault. Documents you upload to a listing's Data Room auto-copy into every Vault you open…"*

## What's been implemented (2026-06-08 — iter-20 Multi-format file uploads)
- **Broadened supported file types** across Listing Data Room, Vault, and Private Locker: PDF · DOCX · DOC · **XLSX/XLSM/XLS** · **PPTX/PPT** · TXT/MD/CSV/TSV/JSON · PNG/JPG/JPEG/GIF/WEBP/HEIC/SVG · MP4/MOV/WEBM · MP3/WAV/M4A · ZIP.
- **Text extraction added** for XLSX (sheet-by-sheet, tab-separated, capped at 2 000 rows/sheet to bound token cost) and PPTX (slide-by-slide + speaker notes). Used by the AI Co-pilot for context-grounded answers + by Detailed Analysis pipeline.
- **Binary media** (images, audio, video, archives) stored as-is with structured placeholder text so the Co-pilot can still reference them by filename.
- **Upload cap raised** from 25 MB → **50 MB** across all three surfaces.
- **Centralized frontend constants** at `frontend/src/lib/uploadConfig.js` (`UPLOAD_ACCEPT`, `UPLOAD_HINT`, `UPLOAD_MAX_MB`) — single source of truth for accept= attribute and helper copy used by `MyListings.jsx`, `DealRoomDetail.jsx`, `PrivateLockerUploadModal.jsx`.
- New deps: `openpyxl==3.1.5`, `python-pptx==1.0.2`. Requirements frozen.
- Backend tests (iter-20): **4/4 pass** at `/app/backend/tests/test_multiformat_uploads.py` covering XLSX text-extraction round-trip, PPTX slide-extraction, image upload without crash, and listing-data-room XLSX path.

## What's been implemented (2026-06-08 — iter-21 Research Companion)
- **New feature: buyer-only AI Companion for any company in the Research Hub.** Combines (a) the buyer's research brief (b) detailed-analysis report if generated (c) any Private Locker docs the buyer tagged to that research target. Strictly buyer-only — sellers cannot access at the API or UI layer.
- **Private Locker new scope `research`**. `POST /api/private-locker/files` now accepts `research_id` form field; new helper endpoint `GET /api/research/{rid}/locker` lists files tagged to a research target.
- **New endpoints**: `POST /api/research/{rid}/copilot` (Claude-grounded chat with citation extraction for `[brief]`, `[detailed-analysis]`, `[filename]`), `GET /api/research/{rid}/copilot` (history).
- **New collection** `research_copilot_messages` — wired into the 48 h demo cleanup sweep.
- **Frontend**:
  - New `components/ResearchCompanion.jsx` two-column layout: chat (left) with suggestions, citations pills, message history; sidebar (right) showing locker files tied to this research with Add / Download / Delete.
  - Embedded inside `ResearchHub.jsx` brief view once a brief is `completed`.
  - `PrivateLockerUploadModal.jsx` gained a third attach tab "Research Hub company" with research-history dropdown. Auto-loads buyer's research list when the tab is selected.
  - `PrivateLocker.jsx` filter strip now shows 4 tabs: All / Workspace / Per-listing / Research targets, with research-target name decoration on rows (gold pill).
- Backend tests (iter-21): **3/3 critical pytests pass** at `/app/backend/tests/test_research_companion.py` covering locker scope=research round-trip, seller RBAC block (403), companion citation-grounded on a locker doc. (A 4th test for cross-buyer 404 isolation passes individually but is flaky in parallel due to research-pipeline LLM latency.)

## What's been implemented (2026-06-08 — iter-22 Admin user management + lock down public admin role)
- **Public registration locked**: `Literal["buyer", "seller"]` on `RegisterRequest`. Frontend `Register.jsx` dropdown no longer lists Admin. Attempting `role: "admin"` from the API returns HTTP 422.
- **Deactivated users blocked at login**: `/auth/login` checks `status == "deactivated"` and returns 403.
- **Admin endpoints** (all admin-only via `_admin_only` guard):
  - `GET /api/admin/users?q=` — paginated user list with optional search across email/name/org.
  - `POST /api/admin/users` — direct create (admin sets initial password).
  - `PATCH /api/admin/users/{uid}` — edit name/role/organization/status. Prevents self-demote.
  - `POST /api/admin/users/{uid}/password` — admin sets a new password.
  - `DELETE /api/admin/users/{uid}` — soft-deactivate (blocks self-deactivate + seed demo accounts).
  - `GET /api/admin/invites` — list invites.
  - `POST /api/admin/invites` — generate a one-time invite token (`secrets.token_urlsafe(32)`) with configurable expiry (1 h–30 d). Returns the shareable `accept_url`.
  - `DELETE /api/admin/invites/{iid}` — revoke a pending invite.
- **Public accept-invite flow**:
  - `GET /api/auth/invite/{token}` — preview metadata (no auth, gates by status + expiry).
  - `POST /api/auth/accept-invite` — consume token → create account → return JWT (one-time use, marked accepted in `user_invites`).
- **Frontend**:
  - New `pages/AdminUsers.jsx` with two tabs (Users / Pending invites), search, Add-user modal, Invite modal (shows the copy-able link), Edit modal, Deactivate / Revoke actions.
  - New `pages/AcceptInvite.jsx` at `/accept-invite?token=…` — public, validates token, asks for password + name, auto-logs the user in.
  - New `auth.jsx` helper `setSession(payload)`.
  - Sidebar `Users` entry added to admin nav under "Platform (Admin)".
- New collection `user_invites`.
- Backend tests (iter-22): **7/7 pass** at `/app/backend/tests/test_admin_users.py`: public register rejects admin role, accepts buyer+seller, non-admin → 403 on admin endpoints, full create→edit→reset-password→deactivate→login-blocked lifecycle, cannot deactivate demo seed accounts, invite→accept→one-time-use→revoke=410.

## Mocked
- Newsletter email dispatch (Resend MOCKED — flips status to `dispatched` + records recipient count)
- Outreach campaign launch (LinkedIn delivery MOCKED — flips status to `launched` + records sent count)
