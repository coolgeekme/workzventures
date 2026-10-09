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

## Auth and permissions

The MCP endpoint **does not bypass the platform's security model**. Each tool
call is dispatched to the app's own ASGI stack with the caller's `Authorization`
header forwarded verbatim, so the existing JWT validation, `require_permission`
gates, tenant scoping and audit logging all apply exactly as they do for the web
app. A tool call from a user without the underlying permission returns `403`, not
a silent success.

Get a token:
```bash
TOKEN=$(curl -s -X POST https://app.nextcapos.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<you>","password":"<pw>"}' | jq -r .token)
```

Errors come back as data, not raw exceptions, so an agent can act on them:

```json
{"ok": false, "status": 403, "error": {"detail": "Insufficient role"},
 "hint": "Authenticated, but this user lacks the permission the endpoint requires."}
```

## Connecting a client

**Claude Desktop** (`claude_desktop_config.json`) — via `mcp-remote`, which
bridges a stdio client to a remote HTTP server:

```json
{
  "mcpServers": {
    "nextcapos": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://app.nextcapos.com/api/mcp/server",
        "--header", "Authorization: Bearer ${NEXTCAPOS_TOKEN}"
      ]
    }
  }
}
```

**Hermes** — add to `~/.hermes/config.yaml`:

```yaml
mcp:
  nextcapos:
    url: https://app.nextcapos.com/api/mcp/server
    headers:
      Authorization: Bearer <token>
    enabled: true
```

**Raw protocol check** (no client needed): a correct endpoint answers an
unauthenticated `initialize` with a JSON-RPC error *about the request*, never a
404 or a redirect.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MCP_ENDPOINT_PATH` | `/api/mcp/server` | Public path of the endpoint |
| `MCP_ALLOWED_HOSTS` | `app.nextcapos.com,nextcapos.com,127.0.0.1:*,localhost:*,[::1]:*` | Host/Origin allowlist for DNS-rebinding protection |
| `MCP_MAX_TOOL_CHARS` | `100000` | Cap on tool output handed to a client |

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
cd backend && python -m pytest tests/test_mcp_server.py -v
```

15 tests. They read `MCP_ACTIONS` out of `server.py` with `ast` (so no database or
env vars are needed), then drive the real Streamable HTTP transport through an
in-process ASGI client, asserting: every manifest action becomes exactly one
tool, names are spec-safe, optional params stay optional, the bearer token is
forwarded, POST bodies carry only supplied params, path params are substituted
and stripped from the body, missing required params are rejected *before* any
dispatch, and 401/403 surface as structured data with an actionable hint.
