# NextCapOS — Platform Capabilities & Features
*Single source of truth for marketing, sales decks, sell-sheets, demo scripts, and integration partners.*
*Last updated: Feb 2026 · Owner: Product*

> **One-liner:** NextCapOS is the institutional Buy & Sell-Side OS for M&A — research, outreach, diligence, and deal-room collaboration unified in one Bloomberg-blue terminal with cryptographic provenance built in.

> **Audience anchors:** Institutional buyers · Sell-side advisors / brokers / agents · Mid-market sellers · Boutique investment banks

---

## Table of contents
1. [Platform pillars](#platform-pillars)
2. [Roles & workspaces](#roles--workspaces)
3. [Buyer-side capabilities](#buyer-side-capabilities)
4. [Seller-side capabilities](#seller-side-capabilities)
5. [Agent / Advisor capabilities](#agent--advisor-capabilities)
6. [Organizations & collaboration](#organizations--collaboration)
7. [Vault (Deal Room)](#vault-deal-room)
8. [AI surface](#ai-surface)
9. [Outreach & marketing](#outreach--marketing)
10. [Trust, security & compliance](#trust-security--compliance)
11. [Integrations](#integrations)
12. [Developer / agent surface (WebMCP)](#developer--agent-surface-webmcp)
13. [Mobile & accessibility](#mobile--accessibility)
14. [Admin & platform operations](#admin--platform-operations)
15. [How to keep this file fresh](#how-to-keep-this-file-fresh)

---

## Platform pillars
- **Bloomberg-grade research at retail speed** — live web-grounded company briefs with inline citations from Perplexity Sonar Pro + Brave + Claude 4.5.
- **End-to-end deal lifecycle** — discovery → outreach → inquiry → NDA → Vault → diligence → closing, no spreadsheet hand-offs.
- **AI as a co-pilot, not a black box** — every AI answer cites the source file/page or web URL it pulled from.
- **Cryptographic provenance by default** — every NDA, file, finding, and inquiry status change is Bitcoin-anchored via OpenTimestamps.
- **AES-256-GCM at rest, room-bound** — Vault and Locker files are encrypted with per-room AAD; the cipher cannot leak across deals.
- **Mobile-first** — full responsive layout with bottom tab bar; works on a phone for last-mile diligence.

---

## Roles & workspaces
NextCapOS ships four first-class roles, each with a tailored console.

| Role | Primary workspace | Highlights |
|---|---|---|
| **Buyer** | Buy-side terminal | Research Hub, Detailed Analysis, Vault, Private Locker, Research Companion, Marketplace |
| **Seller** | Sell-side desk | Listings, Inquiries, Vault, Buyer Discovery, Outreach, Collateral, Newsletter |
| **Agent / Advisor** | Dual-mode (Buyer ⇄ Seller toggle in header) | Manages clients across both sides of the deal; can switch context instantly |
| **Admin** | Platform console | User management, audit chain verifier, MCP console, demo controls |

> Legacy `analyst` role is auto-migrated to `buyer` on startup.

---

## Buyer-side capabilities

### Research Hub
- One-search "AI brief" on any company on Earth (not just internal portfolio).
- **Live web grounding** — Perplexity Sonar Pro + Brave Search fired in parallel; merged into a deduped, numbered citation set.
- Claude Sonnet 4.5 produces the structured brief with inline `[n]` citations across market signals, investor take, and management notes.
- Sources panel with clickable URLs, provider badge, and recency.
- ~32–35 s typical latency, fail-soft if any provider errors.

### Detailed Analysis (institutional grade)
- Async 14-section deep dive: executive summary, company overview, market analysis, competitive landscape, financial analysis, management team, technology/IP, risk, compliance, due-diligence questions, valuation, metrics, strengths, risks, strategic recommendations.
- Recommendation badge: `strong-buy | buy | hold | pass`.
- Pipeline: Perplexity Sonar + 4 Brave queries in parallel → Claude 4.5 strict JSON → ReportLab branded PDF.
- Attach to a Vault (AES-256-GCM encrypted) or to a listing data room (auto-clones into every future Vault).
- 14-section nav chips, auto-polling while pending, recoverable error UI with Retry.

### Marketplace & Inquiries
- Browse live listings across sectors, geographies, revenue/EBITDA bands, deal type.
- Inquire on a listing with a custom message; full inbox/threading on both sides.
- Inquiry lifecycle: `New → Reviewing → Accepted → Vault open` (or `Declined`).
- Plain-English status copy — M&A "passed" surfaced as "Declined" in the UI for clarity.

### Vault access (Buyer side)
- NDA-gated diligence workspace, one per (listing × buyer × seller).
- E-sign the NDA inside the Vault — 5-clause confidentiality terms, typed legal name + ESIGN-Act ack.
- Files immediately visible after NDA signing (sellers can pre-stage the data room and even pre-sync from Google Drive / SharePoint / OneDrive / Dropbox / Box; everything auto-clones into the Vault on open).

### Buyer Private Locker (strictly private)
- Buyer-only document drawer; **sellers, other buyers, and operators cannot see it**. Enforced at the API layer.
- Two scopes: **workspace** (cross-deal templates, partner memos, scoring rubrics) and **listing** (attached to a specific evaluation).
- A third scope, **research target**, ties uploads to a Research Hub brief.
- AES-256-GCM at-rest, OpenTimestamps notarized, 50 MB cap, dedicated GridFS bucket.

### Research Companion
- Buyer-only AI chat against (a) the research brief, (b) detailed-analysis report, (c) any Private Locker docs tagged to the research target.
- Citation extraction for `[brief]`, `[detailed-analysis]`, and `[filename]` references.
- Sidebar showing locker files tied to the research with Add / Download / Delete.

### Personal newsletter
- `POST /api/newsletter/personal` generates a Bloomberg-blue branded digest and delivers it to the buyer's inbox in one call.
- Buyer can configure interests, opt-in, and cadence (weekly / biweekly / monthly).

### Buyer Alerts
- Bell-icon badge with numeric unseen count, polled every 60s.
- Fires when sell-side discovery surfaces a matching acquirer (score ≥ 70).

---

## Seller-side capabilities

### Listings (CRUD with workflow states)
- Lifecycle: `Draft → Live → Under LOI → Closed`.
- Marketplace visibility on `Live`.
- Sector, geography, revenue/EBITDA bands, asking price, headline, summary, highlights, employees.

### Listing Data Room (pre-NDA staging)
- Upload diligence docs to a listing once; they auto-clone into every future Vault opened against that listing.
- 7 folder buckets: financials, legal, HR, IT, operations, commercial, other.
- AES-256-GCM at rest with AAD `listing:{lid}:{file_id}`; up to 50 MB per file.
- Per-row AES-256 pill + download/remove actions; "View as principal" preview mode hides agent controls.
- Amber explainer banner makes the *Data Room ≠ Vault* distinction explicit.

### External File Source Mirroring (Composio)
- One seller-side OAuth grants the whole deal team read access to:
  - Google Drive · OneDrive · SharePoint · Dropbox · Box · (Zoho WorkDrive scaffolded).
- Mirror-first architecture: files are pulled into NextCapOS storage and indexed for AI Co-pilot.
- Immediate wipe on listing close or source disconnect (per spec).
- Manual upload remains alongside mirrored sources.
- **Background sync** (avoids Cloudflare 100s timeout) with live `file_count` ticker via polling.
- **Self-healing Vault clone** — newly synced files auto-appear in already-open Vaults via the same path on next read or copilot question.

### Inquiries inbox
- Triage `New / Reviewing / Accepted / Declined` with confirm dialog on decline.
- Inline chat thread per inquiry; messages auto-marked read; unread counts on the inbox.
- "Decline" copy warns the seller that no Vault will open.

### Marketing Collateral Generator
- Generate sector-aware one-pagers + CIM summaries from a listing's own data (sector + geography + summary + highlights pre-filled).
- Inline edit-in-place + versioning (`collateral_versions` snapshots before each PATCH).
- **Four distribution actions per piece:**
  - `GET /api/collateral/{id}/pdf` — branded ReportLab one-pager.
  - Attach to a listing → surfaces on the marketplace card.
  - Push to Vault → AES-256-GCM encrypts + GridFS + OTS proof.
  - Send to inquiry → drops into the inquiry chat as an attachment.

### Outreach campaigns
- Persona-aware drafts via Claude.
- Inline edit/save/cancel + Delete in draft state.
- Resolve LinkedIn URLs via SEC EDGAR signals (P1: real LinkedIn dispatch via Composio).

### Broadcast newsletter (seller / admin)
- Draft → Approve → Dispatch fan-out to opted-in buyers only.
- Editable recipients editor (`GET /api/newsletter/recipient-candidates`) with filter, select-all, clear.
- Per-buyer sector targeting and cadence respect.

### Buyer Discovery (sell-side prospecting)
- Scan SEC EDGAR for last-540-day 8-K filings; dedupe per acquirer; rank 0–100 with Claude on sector/size/geo/cadence fit.
- Matches ≥ 70 fire a Buyer Alert (badge in nav).
- Background rescan scheduler (every hour; concurrency cap 2 to be polite to SEC).
- UK Companies House code path wired (no key in dev → returns `[]`).
- Actions per match: Add to leads · Draft outreach · Save · Skip · Delete · Open SEC filing link.

---

## Agent / Advisor capabilities

### Dual-mode workspace switcher
- Header segmented toggle: **`[ Buyer | Seller ]`** (visible only when `role === "agent"`).
- Persists per-tab via localStorage; cross-tab synced.
- Switches the entire sidebar nav, chrome accent (gold ⇄ blue), role pill, and topbar copy atomically.

### View-as-principal preview
- Toggle on any listing card to see exactly what the principal will see when they accept the listing invite.
- Hides agent-only controls (invite forms, role selects, status workflow buttons).
- Gold dashed accent border + top banner make the mode unambiguous.

### Share preview links (no-auth signed URLs)
- Mint signed shareable URLs to preview a listing publicly before the principal accepts the invite.
- Per-link expiry (1 h – 30 d), label, view-count + last-viewed-at; no token leaked in list responses.
- Public read-only page mounted at `nextcapos.com/preview/listing/:token` (apex marketing domain).

---

## Organizations & collaboration

### Organizations (multi-org, self-serve)
- One user can belong to many orgs.
- Internal roles: `org_admin`, `org_member`.
- Org bootstrap during signup: `create | join | none`.
- Listings auto-attach to the user's org (or accept an explicit `?org_id=` when in multiple).

### Per-listing collaborators
- Roles: `owner | editor | viewer`.
- Resend-powered invite + token handoff; one-time use.
- Access policy: `require_principal_approval` toggle + `competitor_blocklist[]` (normalized: lowercased, deduped).
- Inviter-or-principal gating (Rule 1B) on role changes and revokes.
- Collaborator-only accounts see a restricted nav (`COLLAB_NAV`) and route guard.

### Org-pooled inboxes
- Inquiries inbox shows every listing in the user's workspace (personal + org-owned + collaborator-as-editor/owner) — not just `seller_id` matches.
- Workspace badges per row: `mine | org | shared`.
- Any teammate can triage status, open Vault, reply on threads.

### Invite-driven registration fast-path
- Invited users register directly with the listing/org invite token; auto-approved, no admin queue.
- Email field locked to the invite's email; org-choice picker hidden.
- Invalid / expired / mismatched-email tokens surface a clear error.

---

## Vault (Deal Room)

### Lifecycle
- `pending_nda → active → closed` (+ `preview` for QA mode).
- One Vault per (listing × buyer × seller) inquiry.
- Soft-delete with cascade cleanup.

### NDA e-signature
- 5-clause scrollable confidentiality terms.
- Typed legal name (≥ 2 chars) + ESIGN-Act checkbox.
- Persists `nda_signed_name`, `nda_signed_by_user_id`, `nda_accepted_by_buyer_at`.
- "NDA e-signed by …" badge on active rooms.

### Diligence Request Lists (DRL templates)
- 7 sector templates: SaaS · Healthcare · E-commerce / DTC · Industrial/Manufacturing · FinServ · ClimateTech · Consumer/Retail.
- AI auto-matches uploaded files to open requests → flips `satisfied`.

### File uploads (multi-format)
- Supported: PDF · DOCX · DOC · XLSX/XLSM/XLS · PPTX/PPT · TXT/MD/CSV/TSV/JSON · PNG/JPG/JPEG/GIF/WEBP/HEIC/SVG · MP4/MOV/WEBM · MP3/WAV/M4A · ZIP.
- Up to **50 MB** per file.
- Text extraction across PDF (pypdf), DOCX (python-docx), XLSX (openpyxl, capped at 2,000 rows/sheet), PPTX (python-pptx, slides + speaker notes).
- Binary media stored with structured placeholder text so the Co-pilot can still reference by filename.
- GridFS storage, AES-256-GCM, AAD bound to `{room_id}:{file_id}`, plaintext SHA-256 stored alongside.

### AI Findings with page citations
- `citation` payload includes `filename`, `page` (int), `excerpt`.
- UI renders "{filename} · p.N".

### Vault Co-pilot (chat with the file corpus)
- Citation-grounded answers; refuses to invent sources.
- Self-heals: pulls any newly-staged or newly-synced docs on each question.

### Preview Vault (QA mode)
- Seller can preview the buyer experience without an inquiry; flagged `is_preview: true`, excluded from real deal metrics.
- Gold dashed banner explains the QA context.

### Provenance Certificate (PDF artifact)
- `GET /api/deal-rooms/{rid}/certificate` aggregates deal/buyer/seller metadata, NDA status, Bitcoin-anchored event timeline, file inventory, AI findings summary, audit-chain anchor, and a copy-paste OTS verify CLI snippet.
- Self-notarizing: the PDF itself is hashed and submitted to OpenTimestamps as `kind="vault.certificate"`.
- QR code links back to `/app/security`.
- 2-page typical render in ~0.5s.

---

## AI surface

### Models in production
| Surface | Model | Notes |
|---|---|---|
| Research briefs · Detailed analysis · Co-pilots · Collateral · Newsletter drafts · Buyer Discovery ranking | **Claude Sonnet 4.5** via Emergent LLM key | All text generation |
| Live web grounding | **Perplexity Sonar Pro** + **Brave Search** | Parallel `asyncio.gather`, deduped citations |
| Image / video / TTS | reserved for roadmap |  |

### Citations & grounding
- Inline `[n]` citations on every research brief and detailed analysis.
- Sources panel with clickable URLs, provider (perplexity / brave), age in days.
- Vault Co-pilot can only cite docs in the room's inventory.

### Async pipeline pattern
- POST → returns `{id, status:"pending"}` immediately (avoids 60s ingress timeout).
- Background worker: `pending → analyzing → completed | failed`.
- Frontend polls + auto-retries; recoverable error UI prevents dead-ends.

---

## Outreach & marketing

- AI-drafted persona-aware outreach campaigns; editable in draft state.
- Lead nurturing pipeline (Composio Zoho push wired; bulk-sync inbox to Zoho is P1).
- Newsletter approve-then-dispatch with hand-picked recipient editor.
- Marketing Collateral PDF distribution (4 actions per piece — see Seller-side).
- Branded ReportLab PDFs use the warm-paper / graphite / Bloomberg-blue palette.

---

## Trust, security & compliance

### Auth hardening
- JWT (HS256), 72 h expiry.
- Bcrypt password hashing.
- Password complexity: min 8 chars, ≥ 1 letter, ≥ 1 digit (HTTP 400 on fail).
- Brute-force lockout: 5 failures in 15 min → HTTP 429.
- Security headers middleware: HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy.

### OpenTimestamps (Bitcoin-anchored notarization)
- 3 free public OTS calendars (alice / bob / finney); merged into one `DetachedTimestampFile`.
- Fires on: NDA e-signature, Vault file upload, AI findings generation, inquiry status `engaged | passed`, and every 25th audit log entry (chain checkpoint).
- Endpoints: `GET /api/security/proofs`, `GET /api/security/proofs/{id}/download` (.ots), `POST /api/security/proofs/{id}/upgrade` (fetch BTC attestation), `POST /api/security/verify` (anyone can verify).

### AES-256-GCM at-rest encryption
- Master key from `WORKZ_FILE_ENCRYPTION_KEY` env (32 bytes base64).
- Per-file 12-byte nonce + AAD bound to `roomid:fileid` (or `listing:lid:fid` for stage, `userid:fileid` for locker).
- Plaintext SHA-256 stored alongside ciphertext for integrity verification.
- Download transparently decrypts.

### Tamper-evident hash-chained audit log
- Every entry stores `seq`, `prev_hash`, `content_hash`.
- `GET /api/security/audit/verify` (admin) re-walks the chain → returns `chain_valid` + `broken_at` if tampered.
- Periodic OTS anchoring of the chain head.

### `/app/security` page
- 4-tile posture grid (Bitcoin-anchored · At-rest encryption · Tamper-evident audit chain · Auth hardening).
- Proof list with `.ots` download + "check confirmation" upgrade + Bitcoin-block-explorer links once confirmed.
- "Verify a proof" modal.
- Admin-only chain verifier.
- Self-verify CLI instructions for paranoid users.

### Provenance Certificate (see Vault section)
- Handout-ready PDF for regulators, courts, counterparties.

---

## Integrations

| Integration | Status | What it does |
|---|---|---|
| **Composio** (v3) | Live (real API key) | OAuth gateway for LinkedIn + Google Drive + OneDrive + SharePoint + Dropbox + Box + Zoho CRM |
| **Perplexity Sonar Pro** | Live | Live-web research grounding |
| **Brave Search** | Live | Live-web research grounding |
| **Claude Sonnet 4.5** | Live (Emergent LLM key) | All text generation |
| **OpenTimestamps** | Live | Bitcoin anchoring via 3 public calendars |
| **SEC EDGAR** | Live (full-text search) | Buyer Discovery 8-K signals |
| **UK Companies House** | Scaffolded (no key) | UK acquirer signals |
| **Resend** | Live for collaborator/org invite emails | Newsletter dispatch is currently MOCKED — real Resend on P1 backlog |

---

## Developer / agent surface (WebMCP)

- **WebMCP shim** — `navigator.mcpActions.register()` + `data-mcp-action` DOM attributes for AI browsing agents (Claude in Chrome, LangChain, Hermes).
- **9 actions exposed** today.
- **Public manifest:** `GET /api/mcp/manifest`.
- **Admin MCP Console** for inspection + activity monitor.
- Roadmap: dedicated MCP server endpoint for direct Claude Desktop / ChatGPT integration.

---

## Mobile & accessibility

- Breakpoint < 1024 px swaps the 260 px sidebar for a sticky `MobileTopbar` (logo + theme toggle) and a fixed bottom `BottomTabBar` (5 tabs per role).
- Bottom tab items vary by role:
  - Buyer: Home · Research · Market · Vault · More
  - Seller: Home · Listings · Inbox · Vault · More
  - Admin: Home · Inbox · Vault · Audit · More
- `MoreSheet` slide-up holds remaining nav + role pill + sign-out.
- iOS safe-area (`env(safe-area-inset-top/bottom)`) respected throughout.
- DealRoomDetail tabs strip is horizontally scrollable on mobile.

### Theme system
- **Dark · Light · Auto** modes (Auto follows OS `prefers-color-scheme` via `matchMedia`).
- Theme toggle in MobileTopbar + desktop header.
- **Dark mode** — Bloomberg-terminal blue accent `#3B82F6` (primary) + `#60A5FA` (secondary) on `#08080A`.
- **Light mode** — warm-paper aesthetic with `#1D4ED8` / `#2563EB` blues on `#FAFAF7`.
- WCAG AA contrast across both themes.
- Hardcoded `text-white / bg-black / text-black / border-white` Tailwind classes auto-override in light mode via global CSS.

---

## Admin & platform operations

### User management
- `GET /api/admin/users?q=` paginated list with search across email / name / org.
- Create / edit / role-change / reset-password / soft-deactivate.
- Self-protect: cannot self-demote or self-deactivate; cannot deactivate seeded demo accounts.

### Invite system
- Admin-issued one-time-use tokens (`secrets.token_urlsafe(32)`) with configurable expiry (1 h – 30 d).
- Public `GET /api/auth/invite/{token}` preview metadata.
- `POST /api/auth/accept-invite` consumes the token + creates the account + auto-logs in.

### Demo account retention
- 48-hour rolling demo data retention; hourly background sweeper.
- Cascade deletes per-user: research, detailed reports, collateral, outreach, newsletters, leads, watchlist, agent activity, Composio connections, listings (non-seed) → staged files (GridFS) → inquiries → messages → deal rooms → files / findings / requests, buyer matches / alerts / scans, locker files, research-copilot messages.
- Audit logs preserved (hash-chain integrity).
- Seeded `is_seed: true` rows survive forever so the marketplace + Buyer Discovery always render.
- Admin manual trigger: `POST /api/admin/demo/purge`.
- Frontend `DemoBanner` (amber, dismissible hourly via localStorage) + login-screen demo notice.

### Audit
- Full event timeline via `GET /api/audit/logs` (admin).
- Every privileged action logged with `actor`, `action`, `target`, `target_id`, `meta`, hash-chain fields.
- Chain verifier (`/api/security/audit/verify`).

---

## How to keep this file fresh

**Owner:** Product.
**Cadence:** Update at the end of every feature ship; do NOT wait for a release cycle.

### When to edit
- New endpoint shipped to production → add it under the relevant role/section.
- Capability removed → strike-through with a `~~deprecated YYYY-MM~~` note, don't delete (sales decks may still reference it).
- Status change of an integration (MOCKED ⇄ Live) → flip the row in the Integrations table immediately.

### Where to look for source-of-truth diffs
- `/app/memory/PRD.md` — append-only changelog with dated iter-N blocks.
- `/app/memory/test_credentials.md` — current demo accounts.
- `/app/backend/server.py` — single source of truth for every endpoint; grep for `@api_router` to enumerate.
- `git log --since="14 days ago"` — short window to spot anything not yet reflected here.

### File conventions
- Keep each capability ≤ 2 lines of prose so this file stays scannable on a phone in a sales call.
- Use **role-first hierarchy** (a buyer-focused feature lives under "Buyer-side capabilities" even if the seller can also use it).
- Hyperlink to deep dives in `/app/memory/PRD.md` if a feature has nuanced edge cases worth knowing pre-demo.
- Don't leak internal model versions in the customer-facing copy — say "AI researcher" or "AI Co-pilot" externally; this file is internal.

### Quick-grep cheatsheet
```bash
grep -n "@api_router" /app/backend/server.py | wc -l        # total endpoint count
grep -n "## What's been implemented" /app/memory/PRD.md     # iteration changelog
ls /app/backend/tests/                                       # test coverage map
```
