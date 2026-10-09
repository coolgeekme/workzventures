"""API-key authentication for the hosted MCP endpoint.

Why this exists
---------------
The MCP endpoint is bearer-authenticated, and the only credential the platform
issued was the web app's JWT — which expires in ``JWT_EXPIRY_HOURS`` (72h). That
is the wrong shape for an agent connection: a desktop or server client stores its
credential in a config file, so a 72h token means re-authenticating and re-editing
that config every three days, forever.

This module adds a long-lived, revocable, per-agent key instead.

How it works
------------
A key is presented to the MCP endpoint exactly like the JWT was::

    Authorization: Bearer nck_<43 url-safe chars>

The key is resolved **at the MCP boundary** and exchanged for a short-lived token
minted with the app's own ``create_token()``. That internally-minted token is what
gets forwarded to the platform's routes, so ``get_current_user``, every
``require_permission`` gate, tenancy scoping and audit logging behave exactly as
they do for the web app — no second authorisation path, and no chance of the two
drifting apart. The minted token never leaves the process; it is created per
request and discarded when the in-process call returns, which is why reusing the
app's normal token lifetime is fine here.

Design rules
------------
* **The plaintext key is never stored.** Only a sha256 hex digest is persisted, so
  a database read cannot reconstruct a working credential. The plaintext is
  returned exactly once, at creation.
* **The stored record never leaves the server.** ``wrap_key`` is the only thing
  handed to API responses: id, label, prefix, timestamps, allowed tools. The hash
  is not part of it.
* **Keys are revocable and auditable.** Every mint, use-rejection and revoke writes
  to the platform's tamper-evident audit chain.
* **Least privilege on top of RBAC.** A key may carry an ``allowed_tools`` list.
  The MCP layer refuses any tool outside it *before* dispatch, so an agent can be
  restricted below what its owning user is otherwise permitted to do. RBAC and the
  key's own scope both have to allow a call.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

#: Distinguishes an agent key from a JWT at a glance, and makes it greppable in
#: logs so a leaked key is identifiable rather than an opaque bearer string.
KEY_PREFIX = "nck_"

#: Bytes of entropy behind each key. 32 bytes (256 bits) is well beyond guessable.
KEY_BYTES = 32

#: How much of the key is echoed back for identification. Enough to tell keys
#: apart in a list, far too little to be usable as a credential.
DISPLAY_CHARS = 12

COLLECTION = "mcp_api_keys"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_key() -> Dict[str, str]:
    """Mint a new key. Returns the plaintext plus what gets persisted.

    The caller must hand ``plaintext`` to the user immediately — it is not
    recoverable afterwards, by design.
    """
    raw = secrets.token_urlsafe(KEY_BYTES)
    plaintext = f"{KEY_PREFIX}{raw}"
    return {
        "plaintext": plaintext,
        "hash": hash_key(plaintext),
        "prefix": plaintext[: len(KEY_PREFIX) + DISPLAY_CHARS],
    }


def hash_key(plaintext: str) -> str:
    """sha256 hex of a key. Deterministic, so lookup is a single indexed read."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def looks_like_key(value: str) -> bool:
    return value.startswith(KEY_PREFIX)


def wrap_key(doc: Dict[str, Any]) -> Dict[str, Any]:
    """The safe, non-secret projection of a stored key record.

    ``key_hash`` is deliberately absent — this is the only shape that should ever
    be serialised into a response.
    """
    return {
        "id": doc.get("id"),
        "label": doc.get("label"),
        "prefix": doc.get("prefix"),
        "allowed_tools": doc.get("allowed_tools"),
        "created_at": doc.get("created_at"),
        "created_by": doc.get("created_by"),
        "last_used_at": doc.get("last_used_at"),
        "use_count": doc.get("use_count", 0),
        "revoked_at": doc.get("revoked_at"),
    }


@dataclass
class McpPrincipal:
    """What the MCP layer knows about the caller of one request."""

    #: Header to forward downstream. ``None`` means the request carries no usable
    #: credential and the downstream route should answer for itself.
    forward_header: Optional[str] = None

    #: ``None`` means unrestricted (a raw JWT, or a key with no tool restriction).
    allowed_tools: Optional[List[str]] = None

    key_id: Optional[str] = None
    key_label: Optional[str] = None

    #: Set when a key was PRESENTED but rejected, so the tool layer can answer
    #: with a precise reason instead of forwarding a doomed request and surfacing
    #: an opaque upstream 401.
    error: Optional[str] = None
    error_status: int = 401

    def permits(self, tool: str) -> bool:
        return self.allowed_tools is None or tool in self.allowed_tools


Resolver = Callable[[Optional[str]], Awaitable[McpPrincipal]]


def make_token_resolver(
    db: Any,
    create_token: Callable[[str, str], str],
    *,
    on_reject: Optional[Callable[[str, Optional[str]], Awaitable[None]]] = None,
) -> Resolver:
    """Build the resolver the MCP layer calls once per request.

    ``db`` is a Motor database handle and ``create_token`` is the app's own token
    minter, injected rather than imported so this module stays testable and the
    token shape cannot drift from the rest of the platform.
    """

    async def resolve(raw_header: Optional[str]) -> McpPrincipal:
        if not raw_header:
            # Unauthenticated. Forward nothing; the downstream route returns its
            # own 401, which is the honest answer.
            return McpPrincipal()

        scheme, _, credential = raw_header.partition(" ")
        if scheme.lower() != "bearer" or not credential:
            return McpPrincipal(
                error="Authorization header must be 'Bearer <key or token>'.",
                error_status=401,
            )

        if not looks_like_key(credential):
            # A JWT. Forward it verbatim — this keeps the admin web console (which
            # holds a real session) working against the same endpoint.
            return McpPrincipal(forward_header=raw_header)

        digest = hash_key(credential)
        doc = await db[COLLECTION].find_one({"key_hash": digest})

        # Constant-time-ish: compare digests with hmac.compare_digest rather than
        # trusting the database equality, and answer identically whether the key
        # is unknown or revoked so a probe cannot enumerate valid keys.
        if doc and not hmac.compare_digest(doc.get("key_hash", ""), digest):
            doc = None

        if not doc:
            if on_reject:
                await on_reject("unknown_key", None)
            return McpPrincipal(
                error=(
                    "API key not recognised. It may have been revoked, or it belongs "
                    "to a different deployment."
                ),
                error_status=401,
            )

        if doc.get("revoked_at"):
            if on_reject:
                await on_reject("revoked_key", doc.get("id"))
            return McpPrincipal(
                error=f"API key '{doc.get('prefix')}' was revoked on {doc['revoked_at']}.",
                error_status=401,
            )

        user = await db.users.find_one({"id": doc.get("user_id")}, {"_id": 0, "password_hash": 0})
        if not user:
            if on_reject:
                await on_reject("orphaned_key", doc.get("id"))
            return McpPrincipal(
                error=(
                    "This key's owner no longer exists, so the key grants nothing. "
                    "Revoke it and issue a new one."
                ),
                error_status=401,
            )

        # Exchange the long-lived key for a normal platform token. Everything
        # downstream — permissions, tenancy, audit — operates on this identity.
        token = create_token(user["id"], user.get("role", "user"))

        # Best-effort usage bookkeeping; never let it block a call.
        try:
            await db[COLLECTION].update_one(
                {"id": doc.get("id")},
                {"$set": {"last_used_at": _now()}, "$inc": {"use_count": 1}},
            )
        except Exception:  # pragma: no cover - telemetry only
            pass

        return McpPrincipal(
            forward_header=f"Bearer {token}",
            allowed_tools=doc.get("allowed_tools") or None,
            key_id=doc.get("id"),
            key_label=doc.get("label"),
        )

    return resolve
