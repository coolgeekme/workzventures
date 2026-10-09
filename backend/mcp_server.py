"""NextCapOS MCP server — hosted Model Context Protocol endpoint.

Why this exists
---------------
The platform already exposes a *WebMCP* surface: nine actions registered as
``data-mcp-action`` DOM attributes plus ``navigator.mcpActions.register()``, and
a public discovery document at ``/api/mcp/manifest``. That surface only works
for an agent driving a *browser tab*.

This module adds the other half: a real MCP server speaking the Streamable HTTP
transport, so a desktop or server-side client (Claude Desktop, ChatGPT
connectors, Hermes, LangChain) can connect over the network with a bearer token.

Design notes
------------
* **Tools are generated from the action registry.** ``build_mcp_app`` takes the
  same ``MCP_ACTIONS`` list that drives ``/api/mcp/manifest``, so the two
  surfaces cannot drift. Adding a WebMCP action automatically adds an MCP tool.
  There is no second hand-maintained tool list to fall out of date.

* **Dispatch is in-process, and the caller's token is forwarded.** Each tool
  call is issued to the app's *own* ASGI stack via ``httpx.ASGITransport`` rather
  than back over the network, so the target port is never assumed. The
  ``Authorization`` header from the MCP client is passed through unchanged, which
  means the existing JWT auth, ``require_permission`` gates and audit logging all
  apply exactly as they do to the web app. No business logic is duplicated here,
  and no privilege is escalated by going through MCP.

* **Errors are returned as data, not raised.** An MCP client sees a structured
  ``{"ok": False, "status": 401, ...}`` payload explaining what went wrong,
  because a raw traceback over the wire tells an agent nothing actionable.
"""

from __future__ import annotations

import inspect
import json
import logging
import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

logger = logging.getLogger("workz.mcp")

# The MCP client's bearer token, captured from the HTTP request and read back
# inside the tool handler. A ContextVar (not a global) so concurrent tool calls
# from different users cannot see each other's credentials.
_current_auth: ContextVar[Optional[str]] = ContextVar("nextcapos_mcp_auth", default=None)

#: Path params declared in an action endpoint, e.g. ``/api/leads/{lead_id}/stage``.
_PATH_PARAM_RE = r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}"

#: Cap on how much tool output we hand back to a client. Some endpoints return
#: large collections; an agent's context is not a dumping ground.
MAX_TOOL_CHARS = int(os.environ.get("MCP_MAX_TOOL_CHARS", "100000"))

#: Default Host/Origin allowlist for DNS-rebinding protection. The MCP SDK ships
#: a loopback-only default, which silently rejects requests to the real domains
#: with a 421 — so the deployment hosts must be named explicitly.
DEFAULT_ALLOWED_HOSTS = [
    "app.nextcapos.com",
    "nextcapos.com",
    "app.nextcapos.com:*",
    "nextcapos.com:*",
    "127.0.0.1:*",
    "localhost:*",
    "[::1]:*",
]

ALLOWED_ORIGINS = [
    "https://app.nextcapos.com",
    "https://nextcapos.com",
    "http://127.0.0.1:*",
    "http://localhost:*",
]

_PY_TYPES: Dict[str, Any] = {
    "string": str,
    "enum": str,
    "number": float,
    "integer": int,
    "boolean": bool,
    "object": dict,
    "array": list,
}


def mcp_mount_prefix(endpoint_path: str = "/api/mcp/server") -> str:
    """The path FastAPI must mount the returned ASGI app at.

    See the routing note in :func:`build_mcp_app` — the mount point is the
    *parent* of the public endpoint on purpose, to avoid Starlette's 307.
    """
    return "/" + endpoint_path.strip("/").rpartition("/")[0].strip("/")


def tool_name_for(action_id: str) -> str:
    """Map a WebMCP action id to a spec-safe MCP tool name.

    MCP tool names are conventionally ``[a-zA-Z0-9_-]``; the action ids use dots
    (``research.company.summarize``), which some clients reject outright. The
    original id is preserved in the tool description so a human can still trace a
    tool back to its manifest entry.
    """
    return action_id.replace(".", "_")


def _path_params(endpoint: str) -> List[str]:
    import re

    return re.findall(_PATH_PARAM_RE, endpoint or "")


def _build_signature(action: Dict[str, Any]) -> inspect.Signature:
    """Derive a real Python signature from the action's declared ``params``.

    FastMCP builds each tool's JSON schema from the function signature, so a bare
    ``**kwargs`` handler would advertise no parameters at all and the client could
    not fill them in. Declaring ``params`` types as ``"string?"`` marks a field
    optional.
    """
    params: List[inspect.Parameter] = []
    for pname, ptype in (action.get("params") or {}).items():
        ptype = str(ptype)
        optional = ptype.endswith("?")
        py_type = _PY_TYPES.get(ptype.rstrip("?").lower(), str)
        if optional:
            params.append(
                inspect.Parameter(
                    pname,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=Optional[py_type],
                )
            )
        else:
            params.append(
                inspect.Parameter(
                    pname, inspect.Parameter.KEYWORD_ONLY, annotation=py_type
                )
            )
    return inspect.Signature(params)


def _truncate(value: Any) -> Any:
    """Bound tool output so one call cannot flood a client's context."""
    try:
        encoded = json.dumps(value, default=str)
    except Exception:
        return {"ok": True, "result": str(value)[:MAX_TOOL_CHARS]}
    if len(encoded) <= MAX_TOOL_CHARS:
        return value
    return {
        "ok": True,
        "truncated": True,
        "note": f"Response was {len(encoded)} chars; truncated to {MAX_TOOL_CHARS}.",
        "result": encoded[:MAX_TOOL_CHARS],
    }


def build_mcp_app(
    actions: List[Dict[str, Any]],
    asgi_app: Callable,
    *,
    name: str = "NextCapOS MCP",
    version: str = "1.0.0",
    instructions: Optional[str] = None,
    allowed_hosts: Optional[List[str]] = None,
    endpoint_path: str = "/api/mcp/server",
) -> Any:
    """Return a Starlette ASGI app implementing the MCP Streamable HTTP transport.

    Mount it on the FastAPI app (see the bottom of ``server.py``). ``asgi_app`` is
    the FastAPI application itself, used as the in-process transport target for
    tool dispatch.
    """
    allowed_hosts = allowed_hosts or [
        h.strip()
        for h in os.environ.get(
            "MCP_ALLOWED_HOSTS", ",".join(DEFAULT_ALLOWED_HOSTS)
        ).split(",")
        if h.strip()
    ]

    # Split the public endpoint into the prefix FastAPI mounts at and the segment
    # the MCP app serves internally.
    #
    # This split is deliberate, not cosmetic. Starlette's Mount issues a 307 when
    # the request path EQUALS the mount path (it redirects to the trailing-slash
    # form). MCP clients post with a bare URL and most do not follow redirects, so
    # mounting at "/api/mcp/server" with an inner path of "/" makes the endpoint
    # look dead. Mounting one level up means the mount path is never the request
    # path, so no redirect is ever emitted — "/api/mcp/server" works as-is.
    endpoint_path = "/" + endpoint_path.strip("/")
    mount_prefix, _, segment = endpoint_path.rpartition("/")
    mount_prefix = mount_prefix or "/"
    segment = "/" + segment

    mcp = FastMCP(
        name=name,
        instructions=instructions
        or (
            "NextCapOS is an institutional buy-side and sell-side operating system. "
            "Use these tools to research companies, generate marketing collateral, "
            "run outreach campaigns, manage the lead pipeline, and draft or dispatch "
            "investor newsletters. Every tool acts as the authenticated user who "
            "presented the bearer token, and the platform's permission checks apply "
            "unchanged — a tool call can be refused with a 403 if that user lacks the "
            "permission the underlying endpoint requires."
        ),
        # Mounted inside an existing app and served to many concurrent clients:
        # stateless keeps us from holding per-session transport state. JSON
        # responses (rather than SSE streams) are what non-browser MCP clients
        # handle most reliably.
        stateless_http=True,
        json_response=True,
    )

    # The MCP app serves at the inner segment; FastAPI mounts its parent prefix.
    mcp.settings.streamable_http_path = segment

    # The SDK defaults to a loopback-only Host allowlist, which returns 421 for
    # any real domain. Name the deployment hosts, or the endpoint looks dead.
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed_hosts,
        allowed_origins=ALLOWED_ORIGINS,
    )

    transport = httpx.ASGITransport(app=asgi_app)
    registered: List[str] = []

    def _make_handler(bound_action: Dict[str, Any]) -> Callable:
        """Create a handler that dispatches to one specific action."""

        async def _handler(**kwargs: Any) -> Any:
            return await dispatch(bound_action, kwargs)

        return _handler

    async def dispatch(action: Dict[str, Any], arguments: Dict[str, Any]) -> Any:
        endpoint = action.get("endpoint") or ""
        method = (action.get("method") or "GET").upper()

        # Split path params out of the body: /api/leads/{lead_id}/stage takes
        # lead_id in the URL and stage in the JSON payload.
        url = endpoint
        body: Dict[str, Any] = {}
        for key, value in arguments.items():
            token = "{%s}" % key
            if token in url:
                if value is None:
                    return {
                        "ok": False,
                        "error": f"'{key}' is required (path parameter of {endpoint}).",
                    }
                url = url.replace(token, quote(str(value), safe=""))
            elif value is not None:
                body[key] = value

        missing = [p for p in _path_params(endpoint) if "{%s}" % p in url]
        if missing:
            return {"ok": False, "error": f"Missing path parameter(s): {', '.join(missing)}"}

        headers = {"Accept": "application/json"}
        token = _current_auth.get()
        if token:
            headers["Authorization"] = token

        kwargs: Dict[str, Any] = {"headers": headers}
        if method in ("POST", "PUT", "PATCH"):
            kwargs["json"] = body
        elif body:
            kwargs["params"] = body

        try:
            async with httpx.AsyncClient(
                transport=transport, base_url="http://mcp.internal", timeout=120.0
            ) as client:
                resp = await client.request(method, url, **kwargs)
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as data
            logger.warning("MCP dispatch failed for %s %s: %s", method, url, exc)
            return {"ok": False, "error": f"Dispatch failed: {exc}"}

        content_type = resp.headers.get("content-type", "")

        if resp.status_code >= 400:
            detail: Any
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text[:2000]
            hint = ""
            if resp.status_code == 401:
                hint = (
                    " Not authenticated. Connect with an 'Authorization: Bearer <token>' "
                    "header obtained from POST /api/auth/login."
                )
            elif resp.status_code == 403:
                hint = (
                    " Authenticated, but this user lacks the permission the endpoint "
                    "requires."
                )
            return {
                "ok": False,
                "status": resp.status_code,
                "error": detail,
                "hint": hint.strip() or None,
            }

        if "application/json" in content_type:
            try:
                return _truncate(resp.json())
            except Exception:
                return {"ok": True, "result": resp.text[:MAX_TOOL_CHARS]}

        # Binary payloads (PDFs, exports) are described, never returned inline.
        return {
            "ok": True,
            "binary": True,
            "content_type": content_type,
            "bytes": len(resp.content),
            "note": (
                "This endpoint returns a non-JSON payload. Use the platform UI to "
                "download it; the body is not returned over MCP."
            ),
        }

    for action in actions:
        action_id = action.get("id") or ""
        if not action_id:
            continue
        tool_name = tool_name_for(action_id)
        registered.append(tool_name)

        # Build the handler in a factory so each one closes over ITS OWN action.
        # A bare closure over the loop variable would leave every tool
        # dispatching to whichever action the loop finished on — nine tools all
        # calling the last endpoint.
        _handler = _make_handler(action)
        _handler.__name__ = tool_name
        _handler.__doc__ = (
            f"{action.get('description', '')}\n\n"
            f"WebMCP action id: `{action_id}` ({action.get('type', 'imperative')}). "
            f"Underlying call: `{action.get('method', 'GET')} {action.get('endpoint', '')}`."
        )
        # FastMCP derives the tool's JSON schema from the function signature, so
        # set the one we built from the action's declared params.
        setattr(_handler, "__signature__", _build_signature(action))
        mcp.add_tool(_handler, name=tool_name, description=_handler.__doc__)

    inner = mcp.streamable_http_app()

    async def app_with_auth(scope, receive, send):
        """Capture the caller's Authorization header for the tool dispatcher."""
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        token = _current_auth.set(headers.get("authorization"))
        try:
            await inner(scope, receive, send)
        finally:
            _current_auth.reset(token)

    # Expose the session manager so the host app can run it in ITS lifespan.
    #
    # This is load-bearing. `streamable_http_app()` hangs its own lifespan on the
    # Starlette app it returns, but Starlette's Mount does NOT run a mounted
    # app's lifespan — the parent's is the only one that executes. Left to
    # itself the session manager's task group therefore never starts and every
    # request dies with "Task group is not initialized", long before any auth
    # check. The host must compose `mcp_lifespan()` into its own lifespan.
    app_with_auth.session_manager = mcp.session_manager  # type: ignore[attr-defined]

    logger.info(
        "MCP server '%s' ready at %s with %d tool(s): %s",
        name,
        endpoint_path,
        len(registered),
        ", ".join(registered),
    )
    return app_with_auth


@asynccontextmanager
async def mcp_lifespan(mcp_app: Any):
    """Run the MCP session manager for the host app's lifetime.

    Compose this into the FastAPI lifespan — see :func:`build_mcp_app` for why
    mounting alone is not enough. ``run()`` may only be called once per manager
    instance, which one lifespan entry satisfies exactly.
    """
    async with mcp_app.session_manager.run():
        yield


def compose_lifespan(existing, mcp_app: Any):
    """Wrap a FastAPI app's existing lifespan so the MCP manager also runs.

    The existing lifespan is preserved deliberately: server.py registers
    ``on_event("shutdown")`` handlers that cancel background tasks and close the
    Mongo client, and replacing ``router.lifespan_context`` outright would
    silently drop them.
    """

    @asynccontextmanager
    async def _composed(app: Any):
        async with existing(app):
            async with mcp_lifespan(mcp_app):
                yield

    return _composed
