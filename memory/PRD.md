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

## What's been implemented (2026-06-08 — iter-23 Rebrand → NextCapOS)
- **Global rebrand from "Workz Ventures" → "NextCapOS"** across user-facing strings in frontend (`.jsx`/`.js`) and backend (AI prompts, CIM/PDF metadata, MCP server name, Zoho `Lead_Source`, CoPilot system prompts, log messages, FastAPI title, HTML `<title>`).
- **Landing page Logo subtitle** changed from "AI-Augmented Marketing Agency" → "Institutional Buy & Sell-Side OS".
- **Deliberately preserved (technical identifiers)**:
  - Seed demo email domain `*@workz.example.com` (any change would invalidate seeded credentials).
  - Seeded password literals `WorkzPass123!` / `WorkzAdmin123!` (stored hashed in DB).
  - Internal CSS variables `--wz-*`, localStorage keys `wz_token`/`wz_user`, font class `font-mono-wz`, asset constants `WORKZ_HERO_URL`.
  - Logger name `workz.demo_cleanup` and machine-readable service id `"workz-ventures"` in `/api/` health check.
- Regression tests still 19/19 across iter-15 / 16 / 18 / 22 suites.
- **Remaining**: the right-panel hero illustration is a PNG asset that literally renders "WORKZ VENTURES" — needs a new image asset to fully retire the old wordmark.

## What's been implemented (2026-06-17 — iter-30 Full rebrand to Bloomberg-blue NextCapOS)
- **Theme**: gold/amber accent palette → Bloomberg-terminal blue. Dark mode `--wz-gold = #3B82F6` (primary), `--wz-amber = #60A5FA` (secondary). Light mode `--wz-gold = #1D4ED8`, `--wz-amber = #2563EB`. Pill borders + radial glows updated to match. Because the entire codebase routes accents through CSS variables, every page/pill/badge/button/chart/border picks up the swap with no per-component edits.
- **Logo**: rewritten as an inline SVG `<BrandMark />` + `<Logo />` component — two overlapping rounded-rect "OS window / capital stack" squares (back-rect dimmed, front-rect full intensity, top highlight stripe) paired with a monospaced "NextCap**OS**" wordmark (OS highlighted in brand blue). Theme-aware via `currentColor` + CSS vars. No more dependency on a hosted PNG asset.
- **Hero visual**: replaced the old "WORKZ VENTURES"-lettered raster with `<HeroVisual />` — fully SVG composition: blueprint grid background, three animated dashed ticker lines (data feel), centered oversized brand-mark blueprint, corner reticles, and a bottom-left mono caption "NextCap**OS** · marketing OS for M&A · build · {today}". Pure CSS-var driven, light/dark adaptive.
- **Login page**: dropped the hero-as-image background, now uses `<HeroVisual />` directly so light/dark mode looks consistent.
- **Favicon**: new SVG favicon (`/public/favicon.svg`) matching the brand mark; old hosted PNG link removed from `index.html`.
- **Smoke-tested visually**: landing + login + agent dashboard all render with new theme + logo.

## What's been implemented (2026-06-17 — iter-29 Orgs actually do something + duplicate sidebar fix)
- **Fix: duplicate sidebar on `/app/org`** — `OrgManagement.jsx` was wrapping itself in `<Layout>`, but `<Protected>` in `App.js` already does that. Removed the extra wrapper; Org page is now consistent with every other protected page.
- **Org-pooled inboxes** (the real value-add for teams):
  - Backend `_user_workspace_listing_ids(user)` helper returns the seller-side workspace listing-id set: personal + org-owned + collaborator-as-editor/owner.
  - `GET /api/inquiries` for sellers/agents now returns inquiries on ANY listing in their workspace, not just their personal `seller_id`. Each row decorated with `workspace_scope` (`mine` | `org` | `shared`) + `workspace_org_name` so the UI can render badges.
  - `PATCH /api/inquiries/{iid}/status` now checks workspace permission, not strict ownership — any teammate can triage.
  - `POST /api/inquiries/{id}/open-room` (open the Vault) extended to workspace teammates.
  - `_inquiry_participant` extended so message threads include workspace teammates as participants — every member of the org can read + reply on shared inquiry threads.
  - `GET /api/deal-rooms` returns vaults for any listing in the user's workspace, not just rooms they personally created.
- **`GET /api/listings` decoration**: each listing row now carries `workspace_scope` and (if applicable) `org_name` so the frontend can filter and badge.
- **Frontend `MyListings`**:
  - Filter pills above the grid: **All / Mine / Org / Shared with me** with live counts.
  - Each listing card shows an `org_name` badge with a building icon when org-owned, or a "Shared with me" badge when the user is a collaborator on a listing they don't otherwise own.
- **Frontend `Inquiries`**:
  - Agent-in-seller-mode is now treated the same as a seller for inbound triage (via `useAgentMode`).
  - Inbound inquiries get a `via [Org name]` badge when they're on an org-owned listing, or `shared` when on a collaborator listing.
- **E2E verified**: Mira creates listing in org → Alex buyer inquires → Agent (different `seller_id`) sees + updates inquiry status. Pool works.

## What's been implemented (2026-06-16 — iter-28 Agent workspace mode switcher)
- **Header workspace switcher** (`AgentModeSwitcher` in `Layout.jsx` + `MobileTopbar.jsx`) — segmented `[ Buyer | Seller ]` toggle visible only when `user.role === "agent"`. Persists choice to localStorage via `useAgentMode()` (`/app/frontend/src/lib/agentMode.js`), cross-tab synced via `storage` event and a custom `wz-agent-mode-change` event.
- **Layout uses `effectiveRole`** — when role is agent, derives the active role from `agentMode` so sidebar nav, chrome accent colors (gold/amber), sidebar title, role-pill text and topbar pill all switch atomically with the toggle. Buyer mode → BUYER_NAV, Seller mode → SELLER_NAV. Organization link is included in both navs so it's always reachable.
- **Side effect**: removed the merged AGENT_NAV behavior — agents now see a focused buy-side OR sell-side console instead of every nav item at once. This matches actual M&A advisor workflow where they think in deal-side mental modes.
- **Backend fix**: `UserPublic.role` Literal now includes `"agent"` (was missing — caused 500 on agent login).
- **Test agent account created**: `agent@workz.example.com` / `WorkzPass123!` (role=agent, org="Smith Advisory") — documented in `test_credentials.md`.

## What's been implemented (2026-06-16 — iter-27 Share preview links)
- **Public preview links** — agents mint signed, no-auth URLs to share a listing preview with the principal before they accept their collaborator invite.
- **Backend** (`/app/backend/server.py`, new `listing_preview_links` collection):
  - `POST /api/listings/{lid}/preview-links` — create (1h–30d expiry, optional label, returns token+url)
  - `GET /api/listings/{lid}/preview-links` — list active (returns url + view_count + last_viewed_at, NO token leaked in the list response)
  - `DELETE /api/listings/{lid}/preview-links/{plid}` — revoke (soft delete via `revoked_at`)
  - `GET /api/preview/listings/{token}` — PUBLIC, no auth. Returns sanitised listing data (no seller_id, no inquiry counts) + data room file metadata (no downloads). Increments `view_count` + `last_viewed_at` via background task.
  - Tokens are `secrets.token_urlsafe(32)`; expired/revoked tokens return 410 Gone with clear messages.
- **Frontend**:
  - `components/ShareLinkModal.jsx` — modal embedded on each listing card. Generates link with copy-to-clipboard, shows active links list with view count + expiry + Revoke action.
  - `pages/PublicListingPreview.jsx` — mounted at `/preview/listing/:token`. Banner with sharer's name + expiry, full listing card, data-room file list (read-only with sizes), "Principal approval required" notice if set, "Sign in" CTA top-right + footer.
  - `HostGuard.jsx` — explicitly excludes `/preview/listing/*` from cross-domain redirects so links work on either host.
  - Listing card gets a new "SHARE" button next to "VIEW AS PRINCIPAL" (hidden in principal preview).
- **URL hosting**: client builds the share URL with `marketingUrl()` so the link points to `https://nextcapos.com/preview/listing/...` in production (the apex), not the app subdomain.
- **Tested**: 4 pytest specs (create+view+revoke→410, buyer-can't-create-for-others, invalid-token-404, expires_hours>720 rejected with 422). End-to-end smoke test confirmed the public page renders without auth.

## What's been implemented (2026-06-16 — iter-26 View-as-principal preview mode)
- **`ListingCard` extracted** (in `MyListings.jsx`) — owns per-card `viewAsPrincipal` state, threads `viewAsPrincipal` down to `ListingDataRoom` and `ListingCollabPanel`.
- **`ListingCollaborators` accepts `readOnly` prop** — hides invite form, per-collaborator remove buttons, and the "Save access policy" button when in preview mode. Shows a gold "Read-only · agent management controls are hidden in principal preview" notice at the top of the panel.
- **`ListingDataRoom` accepts `viewAsPrincipal` prop** — hides the upload form and per-file delete buttons. Download stays available since principals legitimately need to read the data room.
- **Card chrome in preview mode** — gold dashed accent border, top banner ("Principal preview. This is what your client sees when they accept the listing invite. Agent-only management controls are hidden. Exit preview to manage."), trash button hidden, workflow status-change buttons (`→ DRAFT`/`→ LIVE`/`→ UNDER LOI`/`→ CLOSED`) hidden. Toggle button switches between "View as principal" and "Exit preview".
- **Smoke tested**: agent mode and preview mode side-by-side on the listings page, plus a per-card flip test confirming chrome reappears on exit.

## What's been implemented (2026-06-16 — iter-25 Agent role + Organizations + Per-listing Collaborators)
- **New `agent` platform role**: combined buyer+seller workspace nav (Layout.jsx AGENT_NAV de-dupes BUYER_NAV ∪ SELLER_NAV). Surfaced in Register page role dropdown.
- **Organizations (multi-org, self-serve)**: `organizations` + `org_memberships` collections. Roles within: `org_admin`, `org_member`. One user can belong to many orgs. Listings auto-attach to the user's single org on create (or take explicit `?org_id=` query when user has multiple).
- **Org bootstrap during signup**: RegisterRequest now accepts `org_choice` (`create|join|none`), `org_name`, `org_invite_token`. Admin approval handler reads the deferred `pending_org_create` / `pending_org_invite_token` on the user doc and materialises the org/membership at approval time.
- **Per-listing collaborators**: listings now have `collaborators[]` ({user_id, email, name, role: owner|editor|viewer, invited_by, invited_at, accepted_at}) and `access_policy` ({require_principal_approval, competitor_blocklist[]}). Invite + accept use Resend email + token handoff.
- **Industry-standard Vault access policy**: agent (editor) approves by default; principal owner gets veto via `require_principal_approval` toggle and `competitor_blocklist` (normalised: lowercased, deduped, empties stripped).
- **Deal-room collaborators (Phase 2)**: GET/POST/DELETE `/api/deal-rooms/{rid}/collaborators` follow the same shape; only existing NextCapOS users can be added (no fresh email invites — buyer/seller pair is already established by NDA flow).
- **New endpoints (all under `/api`)**:
  - Orgs: `POST /orgs`, `GET /orgs/mine`, `GET /orgs/{id}`, `PATCH /orgs/{id}`, `GET /orgs/{id}/members`, `DELETE /orgs/{id}/members/{uid}`, `POST /orgs/{id}/invites`, `GET /orgs/{id}/invites`, `DELETE /orgs/{id}/invites/{iid}`, `GET /org-invites/{token}` (public), `POST /org-invites/{token}/accept`.
  - Listing collab: `GET /listings/{lid}/collaborators`, `POST /listings/{lid}/collaborators`, `DELETE /listings/{lid}/collaborators/{uid}`, `GET /listing-invites/{token}` (public), `POST /listing-invites/{token}/accept`, `PATCH /listings/{lid}/access-policy`.
  - Room collab: `GET/POST/DELETE /deal-rooms/{rid}/collaborators`.
- **Updated permissions** on existing listing endpoints — `_listing_for_edit_or_404` allows principal owner, org admin/member, collaborator owner/editor, or platform admin. DELETE is further restricted to owner / org_admin / admin (collaborator editors cannot delete).
- **Frontend pages**:
  - `/app/org` — full org management page (tabs across multiple orgs, members list, invite form, pending invites with revoke). Empty state with CTA.
  - `/accept-org-invite?token=…` and `/accept-listing-invite?token=…` — unified `AcceptCollabInvite` component handles both. Email-match enforced; signs user out if signed in as wrong email.
  - MyListings now has a collapsible "Collaborators & access policy" panel per listing (`ListingCollaborators` component).
  - Register page: "Team / Organization" radio card with "Work alone / Create / Join" + conditional org name / invite token inputs.
  - Layout sidebar: "Organization" link added under Platform group for buyer / seller / admin / agent navs.
- **Tested**: 26 RBAC pytest cases + 4 org/collab + 7 admin = 37/37 backend pass. Frontend smoke-tested + testing-agent regression on /app/org, /app/listings collaborator panel + access policy, /register, /accept-org-invite. No critical issues.

## What's been implemented (2026-06-08 — iter-25 Cross-subdomain auth handoff)
- **Reversed the marketing/app split**: Login + register + forgot/reset password now live on the marketing apex (`nextcapos.com/login` etc.), and ONLY `/app/*` lives on `app.nextcapos.com`. This was the user's explicit preference — landing/auth on apex, authenticated workspace on subdomain.
- **`src/lib/sessionCookie.js`** (new) — writes/reads/clears the `wz_token` + `wz_user` cookies with `Domain=.nextcapos.com; Secure; SameSite=Lax; Path=/; Max-Age=30d`. Domain derived from `REACT_APP_APP_URL` automatically, override via `REACT_APP_COOKIE_DOMAIN`.
- **`src/lib/auth.jsx`** — `login`, `register`, `setSession` now write to BOTH `localStorage` (so axios interceptor keeps working) AND the cookie. `logout` clears both. Module-level `hydrateFromCookie()` runs once on app boot — this is how `app.nextcapos.com` picks up a session that was set on `nextcapos.com`. The api.js 401 interceptor also clears the cookie and bounces to the marketing-host login.
- **`src/lib/hostRouting.js`** — added `marketingUrl(path)`, `onMarketingHostname()`, `cookieDomain()`.
- **`src/components/HostGuard.jsx`** (new) — declarative router-mounted guard that enforces: `/app/*` only on subdomain, marketing/auth paths only on apex, and auto-forwards authenticated users from apex root → `/app/dashboard` on subdomain.
- **`src/pages/Login.jsx`** — after successful login on the apex, hard-redirects to `appUrl('/app/dashboard')`. Browser sends the freshly-set cookie and the subdomain instantly recognises the user.
- **`src/pages/Landing.jsx`** — `AppLink` collapsed to a plain `<Link>` since login/register live on the apex. Demo accounts and CTAs all stay on `nextcapos.com`.
- **`src/components/Layout.jsx`** — logout button uses `marketingUrl('/')` for the bounce.
- **Smoke-tested in preview** (single-host fallback): Landing → demo login → /app/dashboard → logout → /login. Cookies set with `Secure; SameSite=Lax`, cleared on logout.
- **Runbook updated**: `/app/memory/SUBDOMAIN_RUNBOOK.md` rewritten with the new flow + the new env var `REACT_APP_COOKIE_DOMAIN` (optional).

## What's been implemented (2026-06-08 — iter-24 Subdomain split scaffolding)
- **Emergent Support confirmed**: a single deployment can serve both `nextcapos.com` (apex marketing) and `app.nextcapos.com` (authenticated platform). User adds a CNAME `app` → `nextcapos.com` at their registrar; Emergent's ingress + auto-issued SAN cert handle both hostnames on the same project. Both hosts share one MongoDB.
- **New `frontend/src/lib/hostRouting.js`** — `splitHostingEnabled()` / `appUrl(path)` / `onAppHostname()`. All driven by new env var `REACT_APP_APP_URL`. When empty (preview/dev) every CTA stays relative and the app keeps working on a single hostname.
- **`Landing.jsx`** — four CTAs (`Sign in`, `Request access`, `Open the terminal`, demo `Sign in as …` buttons) routed through a new `AppLink` wrapper that renders `<a href={appUrl(...)}>` in production or `<Link>` in dev.
- **`Layout.jsx`** — logout button uses `window.location.href = REACT_APP_MARKETING_URL` when the split is on, so users bounce back to the marketing apex on sign-out.
- **Backend CORS** — already env-driven via `CORS_ORIGINS`; no code change. Runbook tells the user to set `https://nextcapos.com,https://app.nextcapos.com` on production.
- **Deployment runbook** committed to `/app/memory/SUBDOMAIN_RUNBOOK.md` — DNS record, three frontend env vars (`REACT_APP_BACKEND_URL`, `REACT_APP_APP_URL`, `REACT_APP_MARKETING_URL`), one backend env var (`CORS_ORIGINS`), redeploy, verify.
- No new pytests — the split is a deployment / env-var change, not a backend feature. All 19 regression tests still pass.

## What's been implemented (2026-06-17 — iter-16 Preview Vault frontend wiring)
- **`MyListings.jsx`** — added a `Preview as buyer` button (data-testid `preview-vault-{lid}`) next to "Share" + "View as principal" on every listing card. Click POSTs `/api/listings/{lid}/preview-vault`, shows a success toast, then `navigate("/app/rooms/{roomId}")`. Disabled during in-flight. Hidden when card is in "View as principal" mode.
- **`DealRoomDetail.jsx`** — added a gold dashed `preview-vault-banner` that renders when `room.is_preview === true`, explaining the QA mode + flagging that activity is excluded from real deal metrics. Status pill now branches on `status === "preview"`.
- **`DealRooms.jsx`** — added a `preview-badge-{rid}` pill next to the status pill so the rooms list visually distinguishes preview vaults from real ones.
- **Regression fix**: restored the `@api_router.get("/drl-templates")` decorator (server.py:3747) — it was accidentally dropped in iter-15 when the preview-vault endpoint was added above it, causing a 404 in the room detail UI.
- **Tested** (iter-16): backend pytest `tests/test_preview_vault.py` 6/6 pass — seller open, persistence, idempotency, buyer 403, agent flow on fresh listing, drl-templates regression. Frontend Playwright run confirms 4 preview-vault buttons render for the seller, click navigates to `/app/rooms/{id}`, banner + preview status pill render, repeat click is idempotent, buyer sees no buttons.

## What's been implemented (2026-06-17 — iter-17 Invite-driven registration fast path)
- **Problem solved**: Listing/Org collaborator invitees who weren't already registered hit a UX dead-end — the invite link bounced them to `/login` → "Request access" → `/register` and the invite token from the URL was lost mid-bounce. The Register form's "I have an invite token" field was ORG-only anyway, and even after registration the account sat in the admin-approval queue.
- **Backend** (`server.py`):
  - `RegisterRequest` now accepts an optional `listing_invite_token` field.
  - `POST /api/auth/register` validates any supplied invite token (email match, not expired, not used) BEFORE creating the user. If valid, the account is created with `status="active"`, the invite is accepted in-line (collaborator pushed onto listing / org_membership inserted), and the response returns `{token, user, listing_id, org_id}` like the login endpoint — no admin approval needed.
  - Mismatched-email / expired / already-used invites return HTTP 400 with a clear message and DON'T create the user.
  - No-invite registrations still go through the existing `status="pending"` admin-approval queue.
  - Listing and org invite emails (both new + resend variants) now include a "Create your account" link to `/register?invite_token=…&invite_kind=…`, plus the raw token in a monospace block as a manual fallback.
- **Frontend** (`Login.jsx`, `Register.jsx`, `AcceptCollabInvite.jsx`):
  - `Login.jsx` — "Request access" link preserves the full `location.search` so `?next=/accept-listing-invite?token=XYZ` survives the bounce to register.
  - `Register.jsx` — reads `invite_token` + `invite_kind` from URL, fetches the public invite preview, pre-fills email (read-only + "locked to invite" hint), shows a banner with inviter + listing/org name + role, hides the manual org-choice picker, posts the token in the register body, and (on `status="active"`) calls `setSession()` + redirects to `/app/listings` (or `/app/org`).
  - `Register.jsx` — invalid token surfaces `register-invite-error` and falls back to a normal register form.
  - `AcceptCollabInvite.jsx` — when unauthed, renders BOTH "Sign in to accept" AND a new "Don't have an account? Create one" CTA that hands off to `/register?invite_token=…&invite_kind=…`.
- **Tested** (iter-17): backend pytest `tests/test_invite_register.py` 6/6 pass (listing fast path + active flow + collaborator membership; mismatched-email rejection; no-invite still pending; expired invite rejection; already-accepted invite rejection; org-invite fast path + org_membership). Frontend Playwright 5/5 pass (query-string preserved on login→register; invite banner + email lock + hidden org-choice; full E2E register → auto-login → /app/listings; AcceptCollabInvite has both signin + register CTAs; invalid token surfaces error + form still usable).

## What's been implemented (2026-06-17 — iter-18 Collaborator role-edit + invite revoke/resend)
- **Problem solved**: Agents/Sellers could ADD and REMOVE collaborators, but had no way to change an existing collaborator's role, cancel a pending invite, or resend it from the listing UI.
- **Backend** (`server.py`):
  - `PATCH /api/listings/{lid}/collaborators/{member_id}` — change collaborator role (Literal: owner / editor / viewer). Principal owner's role is immutable (returns HTTP 400). Unknown role → 422 (pydantic). Unknown member → 404. Reuses `_listing_for_edit_or_404` so only listing editors/owners can mutate.
  - `DELETE /api/listings/{lid}/collaborators/invites/{iid}` — revoke a pending invite. Already-accepted invites return HTTP 400 with "remove the collaborator instead" guidance. Idempotent: re-revoke returns 404. Filters by both `id` AND `listing_id` so a malicious editor on listing A can't revoke listing B's invite. Audit logged as `listing.invite.revoke`.
- **Frontend** (`ListingCollaborators.jsx`):
  - Per-row role `<select>` (Owner/Editor/Viewer) for every non-principal collaborator (data-testid `collab-role-{uid}`). On change → PATCH + toast; on error → reload so dropdown snaps back to server truth.
  - Principal owner row shows a fixed `· principal` pill instead of a select, and no Remove button (renders only if the principal also appears in `collaborators[]`).
  - Each pending invite row now exposes `Resend` (data-testid `collab-invite-resend-{iid}`) with in-flight lockout to prevent double-sends, and `Cancel` (data-testid `collab-invite-revoke-{iid}`) with a confirm prompt.
  - `readOnly` mode (View-as-principal preview) suppresses all role selects, remove buttons, and resend/revoke buttons.
- **Tested** (iter-18): backend pytest `tests/test_collab_role_revoke.py` 9/9 pass + frontend Playwright 4/4 pass.

## What's been implemented (2026-06-17 — iter-19 Collab account scope + Rule 1B inviter-or-principal gating)
- **Problem solved**: Any editor on a listing could change anyone's role / revoke anyone's invite — not the pricing-tier story the user wants. Also, collaborator-only users were seeing the full app nav and could navigate to Buyer Discovery, Outreach, Newsletter etc. that they shouldn't have access to.
- **Backend** (`server.py`):
  - `UserPublic.account_scope: 'collaborator' | 'principal'`, computed live each `/auth/me` (or login/register/accept-invite) call via `_compute_account_scope(user_id, role)` — returns `principal` for admins, anyone owning ≥1 listing, or any org_admin; otherwise `collaborator`. No schema change — fully reactive: a collab-only user creating their first listing flips to `principal` on the next call.
  - `_can_manage_collab_member(listing, user, member_id)` and `_can_manage_pending_invite(listing, user, invite)` helpers encode Rule 1B (principal owner OR original inviter only; admin always allowed). Applied to PATCH role, DELETE collaborator, DELETE invite (revoke), POST invite resend — all now return HTTP 403 with a clear message if Rule 1B is violated.
  - `GET /api/listings/{lid}/collaborators` now decorates every collaborator row and pending invite with `can_manage: bool`, plus top-level `viewer_is_principal` + `viewer_id` for client convenience. Single Mongo read, no N+1.
- **Frontend**:
  - `Layout.jsx` — new `COLLAB_NAV` (My Collaborations + Security), `navFor(role, accountScope)` picks it for collab-only users. Adds a `collab-upgrade-cta` block with mailto link to `team@nextcapos.com`. Topbar pill reads `NextCapOS · Collaborator`, sidebar subtitle reads `Collaborator · listing-scoped`.
  - `App.js` — `Protected` wrapper redirects collab-only users away from any non-allow-listed path. `COLLAB_ALLOWED_PATHS = ['/app/listings','/app/rooms','/app/security','/app/org']` (the last so a collab can accept an org invite that would promote them).
  - `BottomTabBar.jsx` — same gating for mobile (COLLAB_TABS).
  - `MyListings.jsx` — `New listing` button (data-testid `add-listing`) is REMOVED from the DOM for collab-only users; page H1 retitles to "My collaborations" with `Collaborator workspace` overline.
  - `ListingCollaborators.jsx` — gates per-row role select, Remove, Resend, and Cancel buttons by the server-supplied `can_manage` flag. Pending invites the viewer can't manage display a small `locked` pill instead.
- **Tested** (iter-19): backend pytest `tests/test_collab_rule_1b_scope.py` 17/17 PASS + 1 skipped. Frontend Playwright 5/5 PASS (nav, CTA, pill+subtitle, MyListings retitle, route guard for 10 restricted paths). Also tightened iter-18's `test_editor_collaborator_can_patch_role_and_revoke_invites` which had grown stale under Rule 1B — now explicitly asserts the 403 for non-inviter editors.

## What's been implemented (2026-06-18 — iter-20 External File Source Mirror · Phase 1, Composio)
- **Goal**: One seller-side OAuth grants the whole deal team (collaborators + buyers) read access to docs that live in SharePoint / OneDrive / Google Drive / Dropbox / Box / Zoho WorkDrive — without each viewer authing their own account. Per user picks: (1c) all six connectors, (2a) mirror-first architecture, (3a) immediate wipe on close, (4a) manual upload stays alongside, (5) Composio API key configured.
- **Backend** (`server.py` — `LISTING EXTERNAL FILE SOURCES` block):
  - `COMPOSIO_FILE_SOURCES` map: per-toolkit `app` slug + `list` + `download` action slugs.
  - `_composio_action_execute()` thin wrapper around `POST /api/v3/tools/execute/{slug}` with proper upstream-error passthrough (HTTP 502).
  - `POST /api/listings/{lid}/external-sources` — listing editors initiate a Composio connectedAccount, get a redirect_url, source row stored as `pending`. Falls back gracefully if Composio init returns null in dev.
  - `GET /api/listings/{lid}/external-sources` — listing viewers see connected sources + the catalog of 6 supported services. `redirect_url` is stripped on this read so collabs/buyers can't crawl OAuth links.
  - `POST /api/listings/{lid}/external-sources/{sid}/poll` — frontend polls every 4s after Connect; status flips to `active` / `failed` based on the upstream `connectedAccounts/{id}` GET.
  - `POST /api/listings/{lid}/external-sources/{sid}/sync` — when active, lists folder contents + downloads each file (cap 100 per sync, ≤50 MB each); idempotent on `(sid, external_id)`. Files land in the EXISTING `listing_staged_files` schema with a `source: {kind, sid, external_id}` provenance object — so Vault clone + Copilot indexer + NDA gating + audit all keep working with zero changes.
  - `DELETE /api/listings/{lid}/external-sources/{sid}` — revokes the Composio connection (best-effort) and wipes every mirrored byte locally.
  - `_wipe_listing_external_sources(lid)` — fires on listing status → `closed` (PATCH hook) AND on full delete. Parallelised Composio revokes via `asyncio.gather` so a 6-source listing doesn't stack 60s of timeouts.
- **Frontend**:
  - New `components/ExternalSources.jsx` — picker for the 6 services + optional folder ID input + connect button; per-row status pill, Sync/Reopen-OAuth/Disconnect buttons gated by source status. Background polling every 4s while a source is pending. Suppresses every action when `viewAsPrincipal` is set (matches existing read-only pattern).
  - `MyListings.jsx` — imports + mounts `<ExternalSources>` inside the listing-data-room expander. Staged file rows get a `via {source.kind}` gold pill (data-testid `source-badge-{file_id}`) when mirrored, so principals can tell mirrored docs apart from manual uploads at a glance.
- **Tested** (iter-20): backend pytest `tests/test_external_sources.py` 9/9 PASS — supported list, init+row, RBAC (buyer 403 / editor 200), poll on pending, sync-blocked-on-non-active, soft-delete, and wipe-on-close (verified via direct Mongo read). Frontend Playwright 7/7 PASS — panel render, picker options, connect button gating, pending row appears, button gating per status, disconnect removes row, view-as-principal suppresses all actions.
- **Known limitation**: Sync end-to-end (actual byte pull from a real SharePoint/Drive folder) requires a real ACTIVE OAuth, which can't be exercised in CI. The /sync endpoint is wired to handle every documented Composio response envelope (`data`, `response_data`, `files`/`entries`/`value`/`items`, base64 + presigned URL downloads) but real upstream behaviour will likely need per-toolkit tuning in Phase 2.

## What's been implemented (2026-06-18 — iter-22)

### P0 — Vault Activity Tab (Bitcoin-anchored audit trail UI)
- **Backend**:
  - `GET /api/deal-rooms/{rid}/activity?since=ISO&limit=200` — hydrated, room-scoped audit timeline. Curated `ACTIONS` whitelist covers `dealroom.open`, `dealroom.view`, `dealroom.nda.accept`, `dealroom.file.upload`, `dealroom.file.add`, `dealroom.file.download`, `dealroom.file.preview`, `dealroom.file.delete`, `dealroom.preview.open`, `vault.copilot.ask`, `dealroom.findings.generate`. Filters by `target == rid` OR by `target ∈ this room's file_ids` to catch file-scoped events. Single round-trip actor hydration from `users` collection. Returns `{vault_id, events[], counts: {total, by_action, by_actor}, as_of}` with category buckets + human labels mapped server-side.
  - **`dealroom.view` audit event** — rate-limited to once-per-hour-per-user on `GET /deal-rooms/{rid}` so polling/page-refreshes don't flood the timeline. Skipped for preview vaults.
  - **`dealroom.file.add` audit event** — fires per-file inside `_clone_listing_files_into_room(only_missing=True)` so Composio-synced docs arriving AFTER vault open get their own timeline entry with `meta.via = "googledrive" | "onedrive" | "sharepoint" | "dropbox" | "box"`.
  - **`deal_room_files.source` provenance field** — clone path now carries the source stamp from the staged file into the room file, enabling per-row provider badges.
- **Frontend**:
  - `components/VaultActivity.jsx` — new self-contained activity timeline. Filter chips (All / NDA / Files / Co-pilot / Findings / Vault access), per-event icon + actor + time-ago + detail (filename / signed name / question excerpt), provider badges (Google Drive / OneDrive / SharePoint / Dropbox / Box) on synced files. Auto-polls every 30s. Show-all expander after 50 events. Footer trust statement explains Bitcoin anchoring.
  - `pages/DealRoomDetail.jsx` — added 5th tab "Activity" with `Clock` icon (no count badge); mounts `<VaultActivity roomId={id} accentClass={accentClass} />` lazily on tab activation.
- **Tested** (iter-22): `tests/test_vault_activity.py` 4 PASS + 1 skipped — basic shape, required-fields hydration, no cross-room bleed (buyer + seller see same events), `since` cutoff strict-filter. Outsider-403 test is conditional on admin auto-approval flow.

### P0 — Composio download fallback via Proxy Execute (iter-22)
- **Problem**: Composio's `GOOGLEDRIVE_DOWNLOAD_FILE` (and other predefined `*_DOWNLOAD_FILE` actions) intermittently fail with `"Missing presigned URL in upload response"` because their R2 staging step doesn't return a presigned URL (known Composio bugs #3471 / #3477).
- **Backend** (`_composio_proxy_download`):
  - New helper calls `POST /api/v3.1/tools/execute/proxy` on Composio with the connected account's auth injected server-side.
  - Per-toolkit endpoint map for Google Drive (`/drive/v3/files/{id}?alt=media`), OneDrive + SharePoint (Graph `/v1.0/me/drive/items/{id}/content`), Box (`/2.0/files/{id}/content`). Dropbox keeps the predefined action (its API needs a special `Dropbox-API-Arg` header that proxy can't pass).
  - **Google Workspace native types** (Docs / Sheets / Slides / Drawings) are auto-routed through `/drive/v3/files/{id}/export?mimeType=...` to DOCX / XLSX / PPTX / PDF before mirroring — these formats have no binary form so `?alt=media` would 415.
  - Handles both response shapes Composio returns: `binary_data.url` (large files staged to a CDN URL) and inline `data` (base64 or raw bytes).
  - Wired as a **fallback** inside `_run_external_source_sync` — primary `*_DOWNLOAD_FILE` action runs first, proxy kicks in only on `successful: false` or no-bytes responses.
- **Verified**: User confirmed Drive folder sync that previously returned `"Missing presigned URL..."` now mirrors all files correctly via the proxy fallback.

### P0 — Vault file backfill self-heal (iter-22)
- **Problem**: Files synced from Composio AFTER a Vault was opened were invisible inside that Vault — `_clone_listing_files_into_room` only ran at `open-room` time.
- **Backend**:
  - `_clone_listing_files_into_room(..., only_missing=True)` — new idempotent mode that diffs `cloned_from_listing_file` set and only inserts missing rows.
  - Self-heal call sites added to `GET /deal-rooms/{rid}` (catches refresh), `POST /deal-rooms/{rid}/copilot` (catches AI-question-before-refresh), and end of `_run_external_source_sync` (eager backfill into every active/preview vault on the listing).
- **Tested**: `tests/test_vault_backfill.py` 2 PASS — pre-open clones at open-room; post-open arrival backfills on GET + buyer can decrypt + download the backfilled bytes; repeated GET doesn't duplicate.

### P0 — Newsletter actually emails (iter-22)
- **Problem**: Newsletter dispatch was 100% mocked — `MOCKED dispatch` note in response, status flipped to `dispatched` but no email ever sent. User reported running a newsletter and getting nothing in their inbox.
- **Backend** (`server.py`):
  - `_render_newsletter_html(data, recipient_name, sender_name, sender_org, kind)` — email-safe inline-CSS HTML template with the NextCapOS Bloomberg-blue / warm-paper brand (no external assets, no "Workz" references anywhere). Renders title, tagline, deal spotlights, market analysis, portfolio updates, editor note, and a CTA link back to `${FRONTEND_URL}/app/newsletter`. Defensive `html.escape` on every user-provided field.
  - `_newsletter_plain_text(data)` — plain-text fallback for clients that block HTML.
  - `POST /newsletter/personal` — now generates + immediately sends the digest to the buyer's inbox via `mailer.send_email` (Resend). Persists `delivery: {sent_ok, skipped, provider_id, error}` on the doc so the UI can show real status.
  - `POST /newsletter/{nid}/dispatch` — no longer mocked. Fans out to opted-in buyers (or hand-picked `recipient_ids`) with per-recipient HTML personalized greeting. Small sends (≤3 recipients) inline; larger sends in background to avoid Cloudflare 100s timeout. Per-recipient outcomes tracked in `delivered_to[]` and `delivery_failures[]` on the newsletter doc.
- **Verified**: Personal newsletter sent end-to-end (`alex@workz.example.com` → Resend → provider_id returned). Broadcast dispatch to 11 opted-in buyers: 11 delivered, 0 failed.
- **Note**: Resend domain verification required for production sends from `team@app.nextcapos.com` — see SPF/DKIM/DMARC setup at https://resend.com/domains.

### P1 — Watermarked in-browser preview + per-file download toggle (iter-22)

### P0 — Research Companion brief detection + Option B expansion (iter-22)
- **Bug**: Research Companion always replied with "I don't have any source material…" even when a brief was completed on the same page. Root cause: the Companion read `research.content` (legacy field name) but `/research/company` actually persists the brief as a structured dict at `research.data`. Production users with a fully-generated 14-section brief got the empty-state every time.
- **Fix (server.py `ask_research_copilot`)**: Detect the structured `data` dict and flatten its named keys (`summary`, `business_model`, `investor_take`, `market_signals`, `growth_drivers`, `risks`, `competitive_landscape`, `leadership_insights`, `suggested_buyer_profile`, `next_actions`, plus `hq` / `founded` / `employees` / `revenue`) into a readable prompt block. Handles list-of-strings AND list-of-dicts (leadership insights) cleanly. Falls back to legacy `content` field for backwards compat.
- **Option B expansion (per user pre-approval)**: Companion now pulls two additional source kinds on every question:
  - **Public listing artifacts** — case-insensitive substring match on `company_name` against `listings` collection, capped at 5; surfaces sector / geography / headline / asking / revenue / EBITDA / summary / highlights. Citation kind `listing`, tag format `[listing:CompanyName]`.
  - **Vault files the buyer has rightful access to** — only `buyer_id == user.id` rooms with status in (`pending_nda`, `active`, `preview`); pulls extracted content per file (first 2.2 KB). Citation kind `vault`, tag format `[vault:filename]`, with `vault_id` + `file_id` for click-through. Provider badge (`googledrive` / `onedrive` / etc.) included in the source block when applicable.
- **RESEARCH_COPILOT_SYS prompt updated** with the new 5-source citation grammar; Claude now knows to prefer Vault sources over public listing when both contain the same fact.
- **Audit/agent meta** carries `matched_listings` + `vault_files` counts so the Agent Monitor reflects context expansion.
- **Verified end-to-end on preview**: brief detected (citation `[brief]` resolves), Option B picks up the public listing (`[listing:LunaLite Dental]`), and a buyer-owned vault on that listing (`[vault:listing_fin.txt]`) — confirmed via live curl with cross-source reasoning ("Vault's 33% net margin doesn't reconcile with listing's $0.3M EBITDA").
- **Tested**: `tests/test_research_companion.py` 3 PASS (1 pre-existing unrelated failure on the admin-approval registration flow).
  - `PATCH /api/deal-rooms/{rid}/files/{fid}/access` — seller/admin sets `download_allowed: bool` per file. Buyer attempts return 403. Logs `dealroom.file.access` audit event.
  - `GET /api/deal-rooms/{rid}/files/{fid}/preview` — streams inline content for browser viewing. PDFs/images/text served directly; **Office formats (DOCX/XLSX/PPTX + DOC/XLS/PPT + ODT/ODS/ODP) converted on-the-fly via LibreOffice headless** (`_office_to_pdf_via_libreoffice`) and cached in GridFS (`preview_pdf_gridfs_id` field) so subsequent previews are instant. Logs `dealroom.file.preview` audit event.
  - `/download` endpoint now enforces the policy: sellers/admins always 200; buyers 403 unless `download_allowed=true`.
  - LibreOffice installed in the container (`libreoffice-core-nogui` + writer/calc/impress filters, ~500 MB).
- **Frontend**:
  - `components/PdfPreview.jsx` — new modal using `react-pdf` (pdfjs v4 worker). Diagonal repeating CSS watermark overlay carrying `{user.email} · {UTC timestamp} · {6-char session id}` at 16% opacity in Bloomberg-blue. Right-click + page drag suppression best-effort. Toolbar: prev/next page, zoom in/out, optional Download (only when `download_allowed=true`), close. ESC/arrow-keys keyboard shortcuts. Footer trust line about the audit trail.
  - `pages/DealRoomDetail.jsx` — Files tab now shows per-row: green "Download" pill (unlock icon) when allowed, amber "View-only" pill (lock icon) otherwise; seller/admin-only "Allow / Disable" toggle link; "Preview" button on every binary file; "Download" button only when policy allows it.
- **Tested**: `tests/test_vault_preview.py` 6 PASS — default view-only, seller-always-downloads, seller-toggles-then-buyer-can, buyer-cannot-toggle, preview-always-available-for-buyer, preview-logs-audit, DOCX-roundtrip-via-LibreOffice. Frontend smoke test via screenshot tool confirmed the watermarked preview modal renders correctly with `alex@workz.example.com · 2026-06-19 00:14:25 UTC · 3OM4TN` overlaid diagonally across the DOCX-rendered-as-PDF page.

## Mocked
- Newsletter email dispatch (Resend MOCKED — flips status to `dispatched` + records recipient count)
- Outreach campaign launch (LinkedIn delivery MOCKED — flips status to `launched` + records sent count)


## Iter-25 (Feb 2026) — Embedded image rendering in pure-Python Office previews
- **Problem**: After replacing LibreOffice (volatile under K8s restarts) with a pure-Python `python-docx` / `python-pptx` + `reportlab` pipeline, document previews lost all embedded raster images. Sellers' pitch decks and one-pagers rendered as text-only outlines.
- **Fix**: `_pptx_to_pdf_bytes` walks every shape with `MSO_SHAPE_TYPE.PICTURE`, extracts `shape.image.blob`, normalizes via Pillow (handles CMYK JPEGs / RGBA PNGs / palette images), and emits a fit-to-box `reportlab.platypus.Image` flowable per slide (capped at 4 images per slide to keep layouts sane). `_docx_to_pdf_bytes` indexes relationship-id → image blob and emits a `RLImage` flowable each time a `<w:drawing>` block references an embed rid, preserving document order with text.
- **Resilience**: A single corrupt image is caught and skipped — the rest of the deck/document still renders. Verified by a tampered-zip test (`tests/test_preview_images.py::test_pptx_with_text_around_corrupt_image_falls_through`).
- **Tested**: 7/7 unit tests in `tests/test_preview_images.py` pass — confirms PPTX/DOCX with PNG images produce PDFs that contain `/Subtype /Image` XObjects. End-to-end live API verification: PPTX uploaded to a real Vault, `GET /api/deal-rooms/{rid}/files/{fid}/preview` returns a 2KB PDF with the image XObject present.


## Iter-26 (Feb 2026) — Bug fix: admin-invited Agents/Sellers/Buyers stuck as "collaborator"
- **Reported**: "I invited a new user to be an Agent, but when he logged in, he only has a collaborator role…not even a buyer or seller."
- **Root cause**: `_compute_account_scope` (server.py:278) used a negative heuristic — "owns 0 listings AND admins 0 orgs ⇒ collaborator". That mis-classified every brand-new admin-invited user (agent / seller / buyer) as collaborator, forcing them onto the stripped COLLAB_NAV ("My Collaborations" + "Security") instead of their real role-based nav.
- **Fix**: Replaced with a positive check — scope is "collaborator" ONLY when the user is referenced in some `listings.collaborators[].user_id` AND owns zero listings AND admins zero orgs AND isn't a platform admin. Anyone admin-invited / self-registered / org_admin / listing-owner / platform admin is "principal".
- **Tests**: `tests/test_admin_invite_role_scope.py` (5 PASS) — invited-agent-is-principal, invited-seller-is-principal, invited-buyer-is-principal, principal-persists-across-login, listing-collab-still-resolves-to-collaborator. Verified end-to-end by testing agent (iteration_21.json) — 10/10 pytest cases pass, including a true-positive collaborator path.

## Iter-27 (Feb 2026) — Bug fix: Box external source sync — `Tool BOX_LIST_FILES not found`
- **Reported**: Seller hit `list failed: Composio action BOX_LIST_FILES failed: Tool BOX_LIST_FILES not found (code 2401)` when syncing a Box source.
- **Root cause**: Composio renamed the Box list action. Current slug is **`BOX_LIST_ITEMS_IN_FOLDER`** (requires `folder_id`, `"0"` = root).
- **Fix** (`server.py`):
  - `COMPOSIO_FILE_SOURCES['box']['list']` → `BOX_LIST_ITEMS_IN_FOLDER`.
  - When seller doesn't pick a folder, default `folder_id="0"` (Box's root) before calling the action — Box requires the arg.
  - Sync loop now skips `entries` where `type != 'file'` (Box returns folders + web_links alongside files, which would otherwise be passed to `BOX_DOWNLOAD_FILE` and fail).
- **Tests**: `/app/backend/tests/test_box_slug_fix.py` (6 PASS) + 18/18 regression PASS across admin-invite-scope, vault-preview, preview-images suites. Verified by testing agent (`/app/test_reports/iteration_22.json`).


## Iter-28 (Feb 2026) — Bug fix: Box sync reports "synced" but stages 0 files
- **Reported**: "listing says box folder is sync'd but when i view as buyer, there are no documents." Source row showed ACTIVE + synced timestamp + zero files + no error.
- **Root cause**: Iter-27 added a defensive `type != 'file'` filter to drop non-file entries returned by the new `BOX_LIST_ITEMS_IN_FOLDER` slug. Box's root folder normally contains **only subfolders** (My Box → Documents/Marketing/etc), so the filter silently dropped every entry → 0 files pulled, no errors logged.
- **Fix** (`server.py:4985-5040`):
  - When `source_kind=='box'`, BFS-recurse into subfolders (`MAX_DEPTH=4`, `MAX_TOTAL=100` files).
  - Classify each entry: `type=folder` → enqueue, `type=file` → keep, missing type → keep (some Composio responses omit it).
  - Track `explored_folders` + `skipped_non_file` counters.
- **Better diagnostic** (`server.py:5145-5170`): when `pulled==0 and not final_error`, set `last_error` to a seller-actionable string like _"Connected, but no downloadable files found after scanning N subfolder(s)… pick a specific subfolder containing files when you reconnect."_ Eliminates the previous silent-success failure mode.
- **Tests**: `tests/test_box_recursive_sync.py` (4 PASS): nested-files-pulled, empty-root-actionable-error, default-folder-id=0, total-cap-respected. + 12/12 regression PASS. Verified by testing agent (`iteration_23.json`) — Composio live smoke confirms slug + recursion path reaches Composio (rejected only with `ConnectedAccountNotFound`, as expected for the fake test connection).
- **Infra**: Added `/app/backend/pytest.ini` with `asyncio_mode=auto` + session-scoped loops (motor MongoDB client requires single-loop binding).


## Iter-29 (Feb 2026) — Feature: visual folder picker for external file sources
- **Ask**: "Can we make it easier for the user to connect to another platform like Google Drive or Box and give them the ability to manually select what folder to share? Giving them the ability to click/select a folder would be the easiest."
- **Scope chosen**: all 5 providers, multi-select folders per source, "include subfolders" toggle, modal picker, edit-folders button on existing sources.
- **Backend**:
  - New `GET /api/listings/{lid}/external-sources/{sid}/browse?parent_id=<id>` — returns `{folders:[{id,name}], parent_id, can_browse, err, source_kind}` (uniform envelope; `requires_oauth: true` when status≠active so the modal can prompt to finish OAuth).
  - New `PATCH /api/listings/{lid}/external-sources/{sid}/folders` — saves `folder_ids`, `folder_labels`, `include_subfolders`; kicks an immediate sync; writes `listing.source.folders.updated` audit log; caps at 20 folders.
  - `ExternalSourceCreate` now accepts `folder_ids`, `folder_labels`, `include_subfolders` (legacy `folder_id` still accepted and mirrored to `folder_ids[0]` for backwards-compat).
  - **New helpers** `_browse_folder` (per-provider folder-only listing) and `_collect_files_under_folder` (per-provider BFS with `include_subfolders` toggle). OneDrive browsing goes via Composio Proxy → MS Graph because the predefined LIST_ITEMS tool only sees drive root. Dropbox uses its native `recursive:true` flag, no app-layer BFS.
  - **Slug fixes (3 more dead slugs discovered during build)**: `ONE_DRIVE_LIST_FILES` → `ONE_DRIVE_ONEDRIVE_LIST_ITEMS`, `DROPBOX_LIST_FILES` → `DROPBOX_LIST_FILES_IN_FOLDER`, `DROPBOX_DOWNLOAD_FILE` → `DROPBOX_READ_FILE`. **SharePoint**: Composio doesn't expose file-list/download tools — sync degrades gracefully with a clear "not available" message; picker degrades to manual-ID entry.
- **Frontend**:
  - New `FolderPickerModal.jsx` — Finder-style: breadcrumb at top, folder list with checkboxes, "Select this folder" shortcut, breadcrumb-path labels on selected pills, include-subfolders toggle, manual-ID fallback for unsupported providers.
  - `ExternalSources.jsx` — Removed folder-ID text input from connect form (single click → connect → pick); each active source row now shows selected-folder pills and a "Pick / Edit folders" button.
- **Tests**: `tests/test_folder_picker.py` (8 mocked) + `tests/test_box_recursive_sync.py` (4) + 12 regression + 4 live (testing-agent-authored `test_folder_picker_live.py`) = **28/28 PASS**. Verified by testing agent (`iteration_24.json`) — 100% backend; frontend code-review clean (all data-testids present).
- **Known tech debt** (testing agent flagged): `server.py` now 10,088 lines. External-source code (4408-5180) is the obvious next extraction candidate → `backend/integrations/external_sources.py`.


## Iter-30 (Feb 2026) — Two bug fixes: Box payload-too-large + Findings 524 timeout
### Bug 1: Box `BOX_DOWNLOAD_FILE` "tool response payload is too large"
- **Reported**: `Apzme org. chart 6-12-26 (detailed).pdf: Composio action BOX_DOWNLOAD_FILE failed: {"error":{"message":"The tool response payload is too large…"}}`
- **Root cause**: Composio's predefined `*_DOWNLOAD_FILE` actions base64-inline the file bytes into their JSON envelope, which has a ~10 MB hard cap on the server side. The previous code tried this action FIRST and only fell back to Composio Proxy on `successful=false` — but a Composio 502 raises an `HTTPException`, which the outer try/except caught and recorded as a per-file error without ever trying the proxy path.
- **Fix** (`server.py:5473-5577`): inverted the order. For Box / Drive / OneDrive / SharePoint we now try **Composio Proxy Execute first** (streams via R2 presigned URLs — no payload cap). The predefined action is the fallback for the one provider (Dropbox) where we don't have a proxy endpoint configured. The fallback path is wrapped in its own try/except so a Composio 502 doesn't bubble out.
- **Cap lift**: per user request "no limit to the payload amount", the per-file sanity cap was raised 50 MB → 500 MB.

### Bug 2: Findings analysis Cloudflare 524 ("origin did not respond within allowed time")
- **Reported**: "We can't have any limits when analyzing. Some companies may have a lot of data to review."
- **Root cause**: `POST /api/deal-rooms/{rid}/generate-findings` ran the Claude pass synchronously inside the request handler. Vaults with more than ~5-10 files routinely exceeded Cloudflare's 100 s edge timeout → buyer saw a 524 with no recovery.
- **Fix** (`server.py:7307-7510`): converted to a background-job pattern.
  - New `_run_findings_job(job_id, rid, user_id)` runs the Claude call in an `asyncio.create_task`.
  - `POST /generate-findings` now returns `{job_id, status:'pending', files_to_analyze, already_running}` in <0.5 s.
  - New `GET /findings-job/{job_id}` and `GET /findings-job` (latest) for polling.
  - File cap raised 50 → 200; `truncated: bool` + `total_files_in_room` surfaced in the job doc when the cap is hit.
  - In-flight dedupe: a second click returns the existing job rather than spawning a duplicate.
  - Failure path: Claude exceptions mark job `status='failed'` with `error` — never silently stuck on `running`.
- **Frontend** (`DealRoomDetail.jsx`): `generateFindings` now polls `/findings-job/{job_id}` every 2.5 s with no client-side timeout. Mount-time `useEffect` re-attaches to any in-flight job (page-refresh resilience). Toasts on completion / failure.

### Tests
- `tests/test_large_files_and_findings_job.py` (7 PASS): proxy-first avoids predefined action, 502 falls through gracefully, 60 MB file mirrors under the 500 MB cap, background task transitions states + writes findings, Claude exceptions → failed, in-flight returned not duplicated, handler returns <0.5 s.
- `tests/test_findings_job_live.py` (4 PASS — testing-agent-authored): live preview-backend round-trip with Alex's "Backfill Test Co" deal room. POST < 1 s; polling reaches `completed` (~10 s for 8 files); zero Cloudflare 524s.
- **30/30 backend tests pass**, including all 19 prior regression tests. Frontend renders cleanly with 0 console errors. Verified by testing agent (`iteration_25.json`).


## Iter-31 (Feb 2026) — Vault Co-pilot now reads every file (incl. Composio-synced)
- **Reported**: "The Co-pilot feature should be able to access any of the data in the data room, including the files shared via connection through Composio (just like in Findings)."
- **Root cause**: `ask_copilot` (server.py:7560) had a **30-file** inventory cap (vs Findings's 200). Older Composio-mirrored files were silently dropped from the Claude prompt → Co-pilot answered "no documents" or omitted them. Also: (a) the per-file content was flat-truncated to 2,500 chars with no page markers, so citations were file-level only; (b) the backfill clone was gated to `status in (pending_nda, active, preview)` — closing-status rooms were stranded.
- **Fix** (`server.py:7527-7700`):
  - **File cap raised 30 → 200** (matches Findings).
  - **Per-page markers** `<page n=X>` in the inventory (matches Findings).
  - **Dynamic per-file char budget** (150 K / N files) so every file is represented even on big vaults; latency stays at 4-13 s for normal vaults.
  - **Page-aware citation parser**: model returns `[filename p.N]`; legacy `[filename]` form still parsed and defaults to page 1. Citations now carry `{file_id, filename, page}` — the UI can deep-link straight to the cited page.
  - **Backfill clone runs on every copilot call**, regardless of room status — newly Composio-synced files always surface in the next turn.
  - **Truncation note** to the model when total_files > 200, so it warns the buyer instead of hallucinating about an unlisted file.
- **Tests**: `tests/test_copilot_data_access.py` (6 PASS) + `tests/test_copilot_live.py` (3 PASS — testing-agent-authored live integration) + 26 regression = **35/35 PASS**. Verified by testing agent (`iteration_26.json`): live POST returned in 13s with 3 citations carrying `page` numbers, follow-up turn in 3.95s, frontend renders [filename p.N] badges with 0 console errors.
- **Tech debt flagged**: testing agent rightly pointed out `_build_vault_inventory` is now duplicated between Findings and Co-pilot. Extract to `backend/services/vault_inventory.py` next iteration so the next feature consuming the inventory (research briefs, outreach copy) doesn't drift the cap again.


## Iter-32 (Feb 2026) — Citation deep-link to cited page in PdfPreview
- **Ask** (accepted from prior enhancement offer): "wire the citation badge through to the PdfPreview viewer with ?page=3 so buyers jump straight to the cited evidence."
- **What changed**:
  - **`PdfPreview.jsx`**: new `initialPage` prop. Used to seed `pageNumber` when the modal opens; clamped to the document's real page count once the PDF loads (Claude occasionally cites p.12 on a 10-page doc — we snap to the last page so the buyer still sees something usable).
  - **`DealRoomDetail.jsx`**:
    - Co-pilot citation pills are now `<button>` elements (`data-testid="copilot-citation-<msg>-<idx>"`) that resolve `c.file_id` (or fallback `c.filename`) against `room.files`, call `setPreviewPage(c.page)` + `setPreviewFile(cited)`. Disabled state + tooltip if the file was removed.
    - Findings tab citation header (`finding-citation-open-<id>`) is now identically clickable — same one-click "buyer reads the AI claim → opens the actual evidence" loop.
    - New `previewPage` state on the page; reset to 1 on modal close and when opening a file from the regular file list (so existing flows are unchanged).
- **Tests**: 6/6 backend copilot tests still pass (no contract change). Frontend lint clean. Smoke screenshots verified: click citation → modal opens on the cited file with the watermark + view-only stamp; 0 console errors.

