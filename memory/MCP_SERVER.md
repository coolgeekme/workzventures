# NextCapOS MCP Server

A hosted **Model Context Protocol** endpoint so desktop and server-side AI clients
(Claude Desktop, ChatGPT connectors, Hermes, LangChain) can drive NextCapOS over
the network with a bearer token.

## Endpoint

```
POST https://app.nextcapos.com/api/mcp/server
Authorization: Bearer <JWT from POST /api/auth/login>
```

Discovery document (public, no auth):
```
GET https://app.nextcapos.com/api/mcp/manifest
```

## Two surfaces, one registry

NextCapOS now exposes agent actions twice, from a single source of truth:

| Surface | Transport | For |
|---|---|---|
| **WebMCP** | `data-mcp-action` DOM attributes + `navigator.mcpActions.register()` | an agent driving a **browser tab** |
| **MCP** (this) | Streamable HTTP | **desktop / server** clients |

Both are generated from `MCP_ACTIONS` in `backend/server.py`. Adding an action
there adds it to both — there is no second list to keep in sync, and
`tests/test_mcp_server.py` fails if the two ever drift.

## Tools

Tool names are the action ids with dots replaced by underscores (MCP tool names
are conventionally `[a-zA-Z0-9_-]`; several clients reject dots outright). The
original id is preserved in each tool's description.

| Tool | Call | Type |
|---|---|---|
| `research_company_summarize` | `POST /api/research/company` | imperative |
| `collateral_generate` | `POST /api/collateral/generate` | imperative |
| `outreach_campaign_create` | `POST /api/outreach/campaigns` | imperative |
| `leads_list` | `GET /api/leads` | declarative |
| `leads_advance` | `PATCH /api/leads/{lead_id}/stage` | imperative |
| `newsletter_draft` | `POST /api/newsletter/draft` | imperative |
| `newsletter_dispatch` | `POST /api/newsletter/{id}/dispatch` | imperative |
| `composio_linkedin_connect` | `POST /api/composio/connect/linkedin` | imperative |
| `dashboard_kpis` | `GET /api/dashboard/stats` | declarative |

## Auth: API keys (preferred) or a JWT

The MCP endpoint takes a bearer credential in one of two forms.

**Agent key — what a persistent client should use.**

```
Authorization: Bearer nck_<43 url-safe chars>
```

Long-lived and revocable, because an MCP client stores its credential in a config
file — a 72-hour JWT would mean re-issuing and re-pasting it every three days.

**Platform JWT — for short-lived/interactive use.** The same token the web app
issues. Still accepted, so the admin console can drive the endpoint directly.

```bash
TOKEN=$(curl -s -X POST https://app.nextcapos.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<you>","password":"<pw>"}' | jq -r .token)
```

### What happens to the credential

A key is resolved **at the MCP boundary** and exchanged for a normal platform
token minted with the app's own `create_token()`. That token is what reaches the
platform's routes, so `get_current_user`, every `require_permission` gate, tenancy
scoping and audit logging behave exactly as they do for the web app — there is no
second authorization path to drift out of sync. The minted token never leaves the
process: it is created per request and discarded when the in-process call returns.

### Managing keys

All three endpoints require the `team.manage` permission — minting a credential
that carries someone's platform access is a team-management act, not self-service.

```bash
# Mint. The plaintext is returned ONCE and is not recoverable afterwards.
curl -s -X POST https://app.nextcapos.com/api/mcp/keys \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"label":"Hermes","allowed_tools":["leads_list","research_company_summarize","dashboard_kpis"]}'

# List (never returns plaintext or hashes)
curl -s https://app.nextcapos.com/api/mcp/keys -H "Authorization: Bearer $ADMIN_JWT"

# Revoke — immediate, and marked rather than deleted so the audit trail survives
curl -s -X DELETE https://app.nextcapos.com/api/mcp/keys/<key_id> \
  -H "Authorization: Bearer $ADMIN_JWT"
```

**`allowed_tools` narrows a key below its owner's permissions.** The MCP layer
refuses any tool outside that list *before* dispatch, so an agent can be given a
read-only slice of a user who is otherwise an admin. Both the key's scope and the
user's RBAC must allow a call. Omit the field for the owner's full reach. Unknown
tool names are rejected at creation rather than silently dropped, because a typo
would otherwise look like a broken integration later.

Keys are stored as **sha256 hashes only** — a database read cannot reconstruct a
working credential. Ownership, creation, every rejection and every revoke are
written to the platform's tamper-evident audit chain
(`mcp.key.create`, `mcp.key.revoke`, `mcp.key.reject.*`).

### Errors come back as data, not exceptions

An agent gets something it can act on rather than an opaque failure:

```json
{"ok": false, "status": 403,
 "error": "API key 'Hermes (read-only)' is not permitted to call 'newsletter_dispatch'.",
 "hint": "This key carries an allowed-tools list. Allowed: leads_list, dashboard_kpis."}
```

## Connecting a client

**Claude Desktop** (`claude_desktop_config.json`) — via `mcp-remote`, which
bridges a stdio client to a remote HTTP server.

`mcp-remote` expands `${VAR}` from the server entry's own `env` object, so the
key has to be supplied there. Without the `env` block the placeholder is left
unresolved and every tool call fails authentication:

```json
{
  "mcpServers": {
    "nextcapos": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://app.nextcapos.com/api/mcp/server",
        "--header", "Authorization: Bearer ${NEXTCAPOS_KEY}"
      ],
      "env": {
        "NEXTCAPOS_KEY": "paste-your-nck-key-here"
      }
    }
  }
}
```

Because the key is long-lived, pasting it directly into the `--header` argument
instead of using `env` is also fine and one less moving part. Keep it out of a
file you might commit — this is a config file, so treat it like one.

**Hermes** — add to `~/.hermes/config.yaml`. Note that Hermes stores HTTP MCP
credentials as a static header, which is exactly why the long-lived key exists:

```yaml
mcp_servers:
  nextcapos:
    url: https://app.nextcapos.com/api/mcp/server
    headers:
      Authorization: Bearer nck_<your key>
    enabled: true
```

Then `hermes mcp test nextcapos` to discover the nine tools. Newly added servers
do not hot-load — the tools appear on the **next** session.

**Raw protocol check** (no client needed): a correct endpoint answers an
unauthenticated `initialize` with a JSON-RPC error *about the request*, never a
404 or a redirect.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MCP_ENDPOINT_PATH` | `/api/mcp/server` | Public path of the endpoint |
| `MCP_ALLOWED_HOSTS` | `app.nextcapos.com,nextcapos.com,127.0.0.1:*,localhost:*,[::1]:*` | Host allowlist for DNS-rebinding protection |
| `MCP_ALLOWED_ORIGINS` | *derived from `MCP_ALLOWED_HOSTS`* | Origin allowlist; only set this to override the derivation |
| `MCP_MAX_TOOL_CHARS` | `100000` | Cap on tool output handed to a client |

**Host and Origin must be configured together.** They are two halves of the same
check: if you point `MCP_ALLOWED_HOSTS` at a new hostname but leave the origin list
fixed, the request passes Host validation and then fails Origin validation with a
`400` — and only browser-based clients ever hit it, which makes it a confusing
thing to debug. So origins are *derived* from the hosts by default
(`origins_for_hosts`) and `MCP_ALLOWED_ORIGINS` exists only as an explicit
override.

## Two things that will break it if you "clean them up"

Both were found by testing, and both look like mistakes until you know why.

**1. The mount path is the PARENT of the public endpoint.**
`build_mcp_app` serves its route at `/server`, and `server.py` mounts it at
`/api/mcp`. That looks arbitrary. It is not: Starlette's `Mount` emits a **307**
when the request path *equals* the mount path, redirecting to the trailing-slash
form. MCP clients POST a bare URL and most do not follow redirects, so mounting
at `/api/mcp/server` makes the endpoint look dead. `mcp_mount_prefix()` derives
the right mount point — use it rather than hardcoding.

**2. The session manager runs in the host app's lifespan.**
`streamable_http_app()` attaches its own lifespan, but **Starlette does not run a
mounted app's lifespan** — only the parent's executes. Without the composition in
`server.py`, the session manager's task group never starts and every request
fails with `RuntimeError: Task group is not initialized`, before any auth check.
`compose_lifespan()` wraps the app's existing lifespan rather than replacing it,
because `server.py` registers `on_event("shutdown")` handlers that cancel
background tasks and close the Mongo client — clobbering `lifespan_context`
would silently drop them.

## Dependency pins

Chosen to fit the pod's existing stack with **no bumps to pinned packages**:

```
mcp==1.12.4
sse-starlette==2.1.3
httpx-sse==0.4.3
pydantic-settings==2.15.0
```

`mcp>=1.13` requires `uvicorn>=0.31.1` and this app pins `uvicorn==0.25.0`, so
`1.12.4` is the newest SDK that installs cleanly. Likewise `sse-starlette>=3`
requires `starlette>=0.49.1` while this app pins `starlette==0.37.2`; `2.1.3` is
the newest release whose only requirement is a bare `starlette`. `pip check`
reports no broken requirements against the full pinned stack.

## Tests

```bash
cd backend && python -m pytest tests/test_mcp_server.py tests/test_mcp_auth.py -v
```

**43 tests.**

`test_mcp_server.py` (23) reads `MCP_ACTIONS` out of `server.py` with `ast` — so no
database or env vars are needed — then drives the real Streamable HTTP transport
through an in-process ASGI client. It asserts: every manifest action becomes
exactly one tool · names are spec-safe · optional params stay optional · the
credential is forwarded **resolved, not raw** · POST bodies carry only supplied
params · path params are substituted and stripped from the body · a missing
required param is rejected *before* dispatch · a rejected key never reaches an
endpoint · a restricted key is refused for tools outside its list · a resolver that
raises fails closed · Host and Origin stay in step when hosts are overridden · 401/403 surface as structured data with an actionable hint.

`test_mcp_auth.py` (20) covers the key layer against an in-memory Mongo stand-in:
key entropy and prefix · the plaintext is unrecoverable from the stored record ·
`wrap_key` never leaks the hash · a valid key is exchanged for the owner's real
identity · a raw JWT passes through untouched · unknown, revoked and orphaned keys
all grant nothing · a failing usage-write cannot block a valid call · rejection
callbacks fire · and an empty `allowed_tools` means *unrestricted*, never
deny-all.

`check_enforcement.py` also covers the three new endpoints (32 mapped, 0 problems),
so they cannot regress into unguarded routes.
