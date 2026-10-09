"""Tests for the hosted MCP server (``backend/mcp_server.py``).

Self-contained: stdlib plus the app's own dependencies. The action registry is
read out of ``server.py`` with :mod:`ast` instead of importing ``server.py``, so
these tests need no ``MONGO_URL`` / ``JWT_SECRET`` and no live database.

The point of these tests is the *contract between the two surfaces*: the MCP
tools are generated from the same ``MCP_ACTIONS`` list that drives
``/api/mcp/manifest``, so a drift there would silently ship a tool that calls the
wrong endpoint. Most of what follows pins that mapping down.
"""
import ast
import asyncio
import inspect
import json
import pathlib
import re
import sys
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI

BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mcp_server import (  # noqa: E402
    _build_signature,
    build_mcp_app,
    compose_lifespan,
    mcp_mount_prefix,
    origins_for_hosts,
    tool_name_for,
)
from mcp_auth import McpPrincipal  # noqa: E402
from mcp.client.session import ClientSession  # noqa: E402
from mcp.client.streamable_http import streamablehttp_client  # noqa: E402

ENDPOINT_PATH = "/api/mcp/server"
MOUNT_PREFIX = mcp_mount_prefix(ENDPOINT_PATH)


def load_actions():
    """Pull MCP_ACTIONS out of server.py without importing it."""
    source = (BACKEND / "server.py").read_text()
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "MCP_ACTIONS" for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise AssertionError("MCP_ACTIONS assignment not found in server.py")


ACTIONS = load_actions()


class FakeBackend:
    """Stands in for the FastAPI app: records each request, returns canned JSON."""

    def __init__(self):
        self.calls = []
        self.overrides = {}

    async def __call__(self, scope, receive, send):
        assert scope["type"] == "http"
        body = b""
        while True:
            message = await receive()
            if message["type"] != "http.request":
                continue
            body += message.get("body", b"")
            if not message.get("more_body"):
                break

        record = {
            "method": scope["method"],
            "path": scope["path"],
            "query": scope["query_string"].decode(),
            "headers": {
                k.decode("latin-1").lower(): v.decode("latin-1")
                for k, v in scope.get("headers", [])
            },
            "body": json.loads(body.decode()) if body else None,
        }
        self.calls.append(record)

        key = f'{scope["method"]} {scope["path"]}'
        status, payload = self.overrides.get(key, (200, {"ok": True, "route": key}))
        encoded = json.dumps(payload).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(encoded)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": encoded})


def make_app(backend, **kwargs):
    """Mount the MCP app the same way server.py does, with a loopback-free host.

    The composed lifespan matters: mounting alone leaves the MCP session
    manager unstarted, so the app is only usable inside `app_lifespan`.
    """
    kwargs.setdefault("allowed_hosts", ["test", "test:*"])
    kwargs.setdefault("endpoint_path", ENDPOINT_PATH)
    app = FastAPI()
    mcp_app = build_mcp_app(ACTIONS, backend, **kwargs)
    app.mount(MOUNT_PREFIX, mcp_app)
    app.router.lifespan_context = compose_lifespan(
        app.router.lifespan_context, mcp_app
    )
    return app


@asynccontextmanager
async def app_lifespan(app):
    """Enter the app's lifespan the way uvicorn does in production."""
    async with app.router.lifespan_context(app):
        yield app


def parse_tool_result(result):
    """FastMCP may return structured content or a text block; normalise both."""
    structured = getattr(result, "structuredContent", None)
    if structured:
        return structured
    for block in result.content or []:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"text": text}
    raise AssertionError(f"no content in tool result: {result!r}")


async def call_tool(app, tool, arguments, token="Bearer test-token"):
    """Drive one tool call through the real Streamable HTTP transport."""

    def factory(headers=None, timeout=None, auth=None):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=headers or {},
            timeout=timeout or 30,
            auth=auth,
        )

    url = f"http://test{ENDPOINT_PATH}"
    async with app_lifespan(app):
        async with streamablehttp_client(
            url, headers={"Authorization": token}, httpx_client_factory=factory
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments)
                return parse_tool_result(result)


async def list_tools(app, token="Bearer test-token"):
    def factory(headers=None, timeout=None, auth=None):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=headers or {},
            timeout=timeout or 30,
            auth=auth,
        )

    url = f"http://test{ENDPOINT_PATH}"
    async with app_lifespan(app):
        async with streamablehttp_client(
            url, headers={"Authorization": token}, httpx_client_factory=factory
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return (await session.list_tools()).tools


# --------------------------------------------------------------------------
# Registry contract
# --------------------------------------------------------------------------


def test_registry_has_the_nine_manifest_actions():
    assert len(ACTIONS) == 9
    for action in ACTIONS:
        assert action["id"] and action["endpoint"] and action["method"]
        assert action["endpoint"].startswith("/api/")


def test_manifest_and_mcp_tools_cannot_drift():
    """Every manifest action must produce exactly one MCP tool."""
    assert len({tool_name_for(a["id"]) for a in ACTIONS}) == len(ACTIONS)


def test_tool_names_are_spec_safe():
    pattern = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
    for action in ACTIONS:
        name = tool_name_for(action["id"])
        assert pattern.match(name), f"{name!r} from {action['id']!r} is not spec-safe"


def test_optional_params_are_optional_in_the_schema():
    by_id = {a["id"]: a for a in ACTIONS}
    signature = _build_signature(by_id["research.company.summarize"])
    params = signature.parameters
    assert params["company_name"].default is inspect.Parameter.empty
    assert params["sector"].default is None
    assert params["region"].default is None


def test_known_path_param_action_declares_its_param():
    by_id = {a["id"]: a for a in ACTIONS}
    assert "{lead_id}" in by_id["leads.advance"]["endpoint"]
    assert "lead_id" in (by_id["leads.advance"]["params"] or {})


# --------------------------------------------------------------------------
# Transport + dispatch
# --------------------------------------------------------------------------


def test_list_tools_exposes_every_action():
    backend = FakeBackend()
    app = make_app(backend)
    tools = asyncio.run(list_tools(app))
    assert len(tools) == 9
    assert {t.name for t in tools} == {tool_name_for(a["id"]) for a in ACTIONS}


def test_post_tool_forwards_auth_and_posts_declared_body():
    backend = FakeBackend()
    app = make_app(backend)
    out = asyncio.run(
        call_tool(
            app,
            "research_company_summarize",
            {"company_name": "Helios MedTech", "sector": "medtech"},
        )
    )
    assert out.get("ok") is True
    call = backend.calls[-1]
    assert call["method"] == "POST"
    assert call["path"] == "/api/research/company"
    assert call["body"] == {"company_name": "Helios MedTech", "sector": "medtech"}
    assert call["headers"]["authorization"] == "Bearer test-token"


def test_omitted_optional_params_are_not_sent():
    backend = FakeBackend()
    app = make_app(backend)
    asyncio.run(call_tool(app, "research_company_summarize", {"company_name": "Acme"}))
    assert backend.calls[-1]["body"] == {"company_name": "Acme"}


def test_get_tool_issues_a_get_with_no_body():
    backend = FakeBackend()
    app = make_app(backend)
    asyncio.run(call_tool(app, "leads_list", {}))
    call = backend.calls[-1]
    assert call["method"] == "GET"
    assert call["path"] == "/api/leads"
    assert call["body"] is None


def test_path_param_is_substituted_and_removed_from_body():
    backend = FakeBackend()
    app = make_app(backend)
    asyncio.run(
        call_tool(app, "leads_advance", {"lead_id": "lead-42", "stage": "contacted"})
    )
    call = backend.calls[-1]
    assert call["path"] == "/api/leads/lead-42/stage"
    assert call["method"] == "PATCH"
    assert call["body"] == {"stage": "contacted"}


def test_tool_call_without_token_sends_no_authorization():
    backend = FakeBackend()
    app = make_app(backend)
    asyncio.run(call_tool(app, "dashboard_kpis", {}, token=""))
    assert "authorization" not in backend.calls[-1]["headers"]


def test_401_surfaces_as_structured_data_not_an_exception():
    backend = FakeBackend()
    backend.overrides["GET /api/leads"] = (401, {"detail": "Missing bearer token"})
    app = make_app(backend)
    out = asyncio.run(call_tool(app, "leads_list", {}))
    assert out["ok"] is False
    assert out["status"] == 401
    assert out["error"] == {"detail": "Missing bearer token"}
    assert "authenticated" in out["hint"].lower()


def test_403_surfaces_the_permission_hint():
    backend = FakeBackend()
    backend.overrides["POST /api/newsletter/draft"] = (403, {"detail": "Insufficient role"})
    app = make_app(backend)
    out = asyncio.run(call_tool(app, "newsletter_draft", {"topic": "Q1"}))
    assert out["ok"] is False
    assert out["status"] == 403
    assert "permission" in out["hint"].lower()


def test_missing_required_param_is_rejected_before_any_dispatch():
    """A required path param missing means the protocol rejects the call.

    That is the better outcome than our own error string: schema validation
    names the missing field and the endpoint is never reached.
    """
    backend = FakeBackend()
    app = make_app(backend)
    out = asyncio.run(call_tool(app, "leads_advance", {"stage": "contacted"}))
    message = json.dumps(out)
    assert "lead_id" in message
    assert "required" in message.lower()
    assert backend.calls == []


def test_unknown_tool_name_is_rejected():
    backend = FakeBackend()
    app = make_app(backend)

    async def attempt():
        def factory(headers=None, timeout=None, auth=None):
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                headers=headers or {},
                timeout=timeout or 30,
                auth=auth,
            )

        async with app_lifespan(app):
            async with streamablehttp_client(
                f"http://test{ENDPOINT_PATH}",
                headers={"Authorization": "Bearer t"},
                httpx_client_factory=factory,
            ) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await session.call_tool("not_a_real_tool", {})

    out = asyncio.run(attempt())
    assert backend.calls == []
    assert "not_a_real_tool" in json.dumps(parse_tool_result(out))


# --------------------------------------------------------------------------
# Credential resolution at the transport boundary
#
# With a token_resolver wired, the header a tool call arrives with is not
# necessarily the header that gets forwarded. These pin that down: a resolved
# identity replaces the raw credential, a rejected credential never reaches an
# endpoint, and a key's own tool scope is enforced before dispatch.
# --------------------------------------------------------------------------


def make_app_with_resolver(backend, resolver):
    app = FastAPI()
    mcp_app = build_mcp_app(
        ACTIONS,
        backend,
        allowed_hosts=["test", "test:*"],
        endpoint_path=ENDPOINT_PATH,
        token_resolver=resolver,
    )
    app.mount(MOUNT_PREFIX, mcp_app)
    app.router.lifespan_context = compose_lifespan(app.router.lifespan_context, mcp_app)
    return app


def const_resolver(principal):
    async def resolve(raw_header):
        return principal

    return resolve


def test_resolver_replaces_the_inbound_credential():
    """The endpoint must see the RESOLVED identity, never the raw agent key."""
    backend = FakeBackend()
    app = make_app_with_resolver(
        backend, const_resolver(McpPrincipal(forward_header="Bearer exchanged-jwt"))
    )
    asyncio.run(call_tool(app, "leads_list", {}, token="Bearer nck_agentkey"))
    assert backend.calls[-1]["headers"]["authorization"] == "Bearer exchanged-jwt"
    assert "nck_agentkey" not in json.dumps(backend.calls[-1]["headers"])


def test_rejected_credential_never_reaches_an_endpoint():
    backend = FakeBackend()
    app = make_app_with_resolver(
        backend,
        const_resolver(
            McpPrincipal(error="API key not recognised.", error_status=401)
        ),
    )
    out = asyncio.run(call_tool(app, "leads_list", {}, token="Bearer nck_revoked"))
    assert out["ok"] is False
    assert out["status"] == 401
    assert "not recognised" in out["error"]
    assert backend.calls == []


def test_key_tool_scope_is_enforced_before_dispatch():
    """A restricted key is refused for tools outside its list, before dispatch.

    Both calls share ONE session on purpose: the MCP session manager's run() may
    only be entered once per instance, so a test cannot open the lifespan twice
    against the same app.
    """
    backend = FakeBackend()
    app = make_app_with_resolver(
        backend,
        const_resolver(
            McpPrincipal(
                forward_header="Bearer exchanged-jwt",
                allowed_tools=["leads_list"],
                key_id="k-1",
                key_label="Hermes (read-only)",
            )
        ),
    )

    async def both_calls():
        def factory(headers=None, timeout=None, auth=None):
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                headers=headers or {},
                timeout=timeout or 30,
                auth=auth,
            )

        results = {}
        async with app_lifespan(app):
            async with streamablehttp_client(
                f"http://test{ENDPOINT_PATH}",
                headers={"Authorization": "Bearer nck_agentkey"},
                httpx_client_factory=factory,
            ) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    allowed = await session.call_tool("leads_list", {})
                    results["allowed"] = parse_tool_result(allowed)
                    blocked = await session.call_tool(
                        "newsletter_dispatch", {"id": "nl-1"}
                    )
                    results["blocked"] = parse_tool_result(blocked)
        return results

    results = asyncio.run(both_calls())

    assert results["allowed"].get("ok") is True
    assert results["blocked"]["ok"] is False
    assert results["blocked"]["status"] == 403
    assert "newsletter_dispatch" in results["blocked"]["error"]
    assert "leads_list" in results["blocked"]["hint"]
    # Crucially: the refused call dispatched nothing, so the backend saw only one.
    assert len(backend.calls) == 1
    assert backend.calls[0]["path"] == "/api/leads"


def test_a_failing_resolver_fails_closed():
    """An exception while resolving must not fall through to an unauthenticated call."""

    async def explode(raw_header):
        raise RuntimeError("mongo down")

    backend = FakeBackend()
    app = make_app_with_resolver(backend, explode)
    out = asyncio.run(call_tool(app, "leads_list", {}, token="Bearer nck_anything"))
    assert out["ok"] is False
    assert out["status"] == 401
    assert backend.calls == []


def test_resolver_sees_the_raw_header_exactly_as_sent():
    seen = []

    async def spy(raw_header):
        seen.append(raw_header)
        return McpPrincipal(forward_header="Bearer exchanged")

    backend = FakeBackend()
    app = make_app_with_resolver(backend, spy)
    asyncio.run(call_tool(app, "dashboard_kpis", {}, token="Bearer nck_exact_value"))
    assert "Bearer nck_exact_value" in seen


# --------------------------------------------------------------------------
# Transport security: Host and Origin must be configured together
# --------------------------------------------------------------------------


def test_origins_are_derived_from_the_host_allowlist():
    """Deploying on a custom hostname must not leave Origin validation behind.

    A Host allowlist that is configurable while the Origin list is hard-coded
    produces a deployment where Host checks pass and Origin checks 400 — and only
    browser-based clients ever see it.
    """
    origins = origins_for_hosts(["example.test", "127.0.0.1:*"])
    assert "https://example.test" in origins
    assert "http://example.test" in origins
    assert "https://127.0.0.1:*" in origins


def test_custom_hosts_are_reflected_in_transport_security():
    """Building with custom hosts must produce matching origins."""
    backend = FakeBackend()
    app = make_app(backend, allowed_hosts=["custom.host", "other.host:*"])

    settings = None
    for route in app.routes:
        inner = getattr(route, "app", None)
        if inner is not None and hasattr(inner, "session_manager"):
            manager = inner.session_manager
            settings = getattr(manager, "security_settings", None)
            break

    assert settings is not None, "expected the transport security settings on the mounted app"
    assert "custom.host" in settings.allowed_hosts
    assert "other.host:*" in settings.allowed_hosts
    # The crux: the origins moved WITH the hosts.
    assert "https://custom.host" in settings.allowed_origins
    assert "https://other.host:*" in settings.allowed_origins


def test_explicit_origin_override_wins(monkeypatch):
    monkeypatch.setenv("MCP_ALLOWED_ORIGINS", "https://only.this")
    backend = FakeBackend()
    app = make_app(backend, allowed_hosts=["custom.host"])

    for route in app.routes:
        inner = getattr(route, "app", None)
        if inner is not None and hasattr(inner, "session_manager"):
            settings = inner.session_manager.security_settings
            assert settings.allowed_origins == ["https://only.this"]
            return
    raise AssertionError("expected the mounted MCP app")
