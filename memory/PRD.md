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
- Auth: register, login, /me, RBAC (`buyer | analyst | admin`)
- Dashboard: 8 KPIs + active deal book + agent activity feed
- Buyer Research Hub: AI brief (profile, leadership, market signals, risks, investor take, next actions) + history
- Marketing Collateral Generator: one-pager / email seq / LinkedIn post / deal memo
- Outreach Campaigns: AI-drafted (subject + LinkedIn DM + email body) + launch (mocked)
- Lead Nurturing kanban (5 stages)
- Newsletter Center: preferences (opt-in, interests, cadence), AI draft, approve, dispatch (mocked)
- MCP Console: 9 actions w/ invoker + JSON params + live invocation through `navigator.mcpActions.invoke()`
- Agent Activity Monitor: success rate, by-agent breakdown, friction logs
- Composio: status + LinkedIn connect (real API call w/ fallback) + disconnect
- Audit Logs: every state change traced
- Backend tests: 24/24 pass

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
