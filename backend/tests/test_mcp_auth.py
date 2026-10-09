"""Tests for MCP API-key auth (``backend/mcp_auth.py``).

The security properties under test are the ones that would be silent if wrong:
that a plaintext key is never recoverable from storage, that a revoked or orphaned
key grants nothing, that a key is exchanged for a real platform identity rather
than becoming a parallel auth path, and that a key's own tool scope is enforced
independently of the owner's permissions.

No database is required — a tiny in-memory stand-in implements just the handful of
Motor calls the resolver makes.
"""
import asyncio
import hashlib
import pathlib
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import mcp_auth  # noqa: E402
from mcp_auth import (  # noqa: E402
    KEY_PREFIX,
    McpPrincipal,
    generate_key,
    hash_key,
    looks_like_key,
    make_token_resolver,
    wrap_key,
)


# --------------------------------------------------------------------------
# In-memory Mongo stand-in
# --------------------------------------------------------------------------


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.updates = []

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return dict(doc)
        return None

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                for k, v in (update.get("$set") or {}).items():
                    doc[k] = v
                for k, v in (update.get("$inc") or {}).items():
                    doc[k] = doc.get(k, 0) + v
        return type("R", (), {"modified_count": 1})()


class FakeDB:
    def __init__(self, keys=None, users=None):
        self.collections = {
            mcp_auth.COLLECTION: FakeCollection(keys),
            "users": FakeCollection(users),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, FakeCollection())

    # Motor exposes collections as attributes too (db.users), and the resolver
    # uses that form. The stand-in has to support both or the test fails for a
    # reason that has nothing to do with the code under test.
    @property
    def users(self):
        return self["users"]


def make_user(uid="u-1", role="admin"):
    return {"id": uid, "email": "agent@example.com", "name": "Agent", "role": role}


def make_key(user_id="u-1", allowed_tools=None, revoked_at=None, key_id="k-1"):
    generated = generate_key()
    return generated, {
        "id": key_id,
        "label": "Hermes",
        "prefix": generated["prefix"],
        "key_hash": generated["hash"],
        "user_id": user_id,
        "allowed_tools": allowed_tools,
        "created_at": "2026-10-09T00:00:00+00:00",
        "created_by": "u-admin",
        "last_used_at": None,
        "use_count": 0,
        "revoked_at": revoked_at,
    }


def recording_minter():
    calls = []

    def create_token(user_id, role):
        calls.append((user_id, role))
        return f"jwt-for-{user_id}"

    return create_token, calls


def resolve(db, raw, create_token=None):
    create_token = create_token or recording_minter()[0]
    resolver = make_token_resolver(db, create_token)
    return asyncio.run(resolver(raw))


# --------------------------------------------------------------------------
# Key generation and storage shape
# --------------------------------------------------------------------------


def test_generated_key_is_prefixed_and_high_entropy():
    generated = generate_key()
    assert generated["plaintext"].startswith(KEY_PREFIX)
    # 32 random bytes → 43 url-safe chars; anything shorter means a weak key.
    assert len(generated["plaintext"]) >= len(KEY_PREFIX) + 40
    assert looks_like_key(generated["plaintext"])


def test_two_keys_never_collide():
    assert len({generate_key()["plaintext"] for _ in range(200)}) == 200


def test_stored_hash_is_sha256_of_the_plaintext():
    generated = generate_key()
    assert generated["hash"] == hashlib.sha256(generated["plaintext"].encode()).hexdigest()
    assert generated["hash"] == hash_key(generated["plaintext"])


def test_plaintext_is_not_recoverable_from_the_stored_record():
    generated, doc = make_key()
    serialized = repr(doc)
    assert generated["plaintext"] not in serialized
    assert generated["hash"] in serialized  # the hash IS stored, by design
    # A hash is one-way, so the credential cannot be reconstructed from the record.
    assert len(generated["hash"]) == 64


def test_wrap_key_never_leaks_the_hash():
    _, doc = make_key()
    wrapped = wrap_key(doc)
    assert "key_hash" not in wrapped
    assert set(wrapped) >= {"id", "label", "prefix", "allowed_tools", "revoked_at"}


def test_prefix_is_long_enough_to_identify_but_useless_as_a_credential():
    generated = generate_key()
    assert generated["prefix"].startswith(KEY_PREFIX)
    assert len(generated["plaintext"]) > len(generated["prefix"]) + 20


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------


def test_valid_key_is_exchanged_for_a_platform_token():
    generated, doc = make_key()
    minter, calls = recording_minter()
    db = FakeDB(keys=[doc], users=[make_user()])

    principal = resolve(db, f"Bearer {generated['plaintext']}", minter)

    assert principal.error is None
    assert principal.forward_header == "Bearer jwt-for-u-1"
    assert principal.key_id == "k-1"
    assert principal.key_label == "Hermes"
    # The key is exchanged for the OWNER's identity — not a synthetic one.
    assert calls == [("u-1", "admin")]


def test_raw_jwt_is_forwarded_untouched():
    db = FakeDB()
    principal = resolve(db, "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")
    assert principal.forward_header == "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
    assert principal.error is None
    assert principal.allowed_tools is None


def test_unknown_key_is_rejected_with_a_reason():
    db = FakeDB(users=[make_user()])
    principal = resolve(db, f"Bearer {KEY_PREFIX}not-a-real-key")
    assert principal.error is not None
    assert principal.error_status == 401
    assert principal.forward_header is None


def test_revoked_key_grants_nothing():
    generated, doc = make_key(revoked_at="2026-10-09T12:00:00+00:00")
    db = FakeDB(keys=[doc], users=[make_user()])
    principal = resolve(db, f"Bearer {generated['plaintext']}")
    assert principal.error is not None
    assert "revoked" in principal.error.lower()


def test_key_whose_owner_is_gone_grants_nothing():
    generated, doc = make_key(user_id="missing-user")
    db = FakeDB(keys=[doc], users=[make_user(uid="someone-else")])
    principal = resolve(db, f"Bearer {generated['plaintext']}")
    assert principal.error is not None
    assert "owner no longer exists" in principal.error.lower()


def test_missing_header_is_not_an_error_but_carries_no_credential():
    db = FakeDB()
    principal = resolve(db, None)
    assert principal.error is None
    assert principal.forward_header is None


def test_malformed_scheme_is_rejected():
    db = FakeDB()
    principal = resolve(db, "Token nck_whatever")
    assert principal.error is not None
    assert "Bearer" in principal.error


def test_use_is_counted_and_timestamped():
    generated, doc = make_key()
    db = FakeDB(keys=[doc], users=[make_user()])
    resolve(db, f"Bearer {generated['plaintext']}")
    updates = db[mcp_auth.COLLECTION].updates
    assert updates, "expected the key's usage to be recorded"
    _, update = updates[0]
    assert update["$inc"] == {"use_count": 1}
    assert update["$set"]["last_used_at"]


def test_a_failing_usage_write_does_not_block_the_call():
    """Telemetry must never be the reason a valid tool call fails."""
    generated, doc = make_key()

    class Exploding(FakeCollection):
        async def update_one(self, query, update):
            raise RuntimeError("mongo down")

    db = FakeDB(keys=[doc], users=[make_user()])
    db.collections[mcp_auth.COLLECTION] = Exploding([doc])
    principal = resolve(db, f"Bearer {generated['plaintext']}")
    assert principal.error is None
    assert principal.forward_header == "Bearer jwt-for-u-1"


def test_rejection_callback_fires_for_unknown_and_revoked():
    seen = []

    async def on_reject(reason, key_id):
        seen.append((reason, key_id))

    generated, doc = make_key(revoked_at="2026-10-09T12:00:00+00:00", key_id="k-9")
    db = FakeDB(keys=[doc], users=[make_user()])
    resolver = make_token_resolver(db, recording_minter()[0], on_reject=on_reject)

    asyncio.run(resolver(f"Bearer {generated['plaintext']}"))
    asyncio.run(resolver(f"Bearer {KEY_PREFIX}nope"))

    assert ("revoked_key", "k-9") in seen
    assert ("unknown_key", None) in seen


# --------------------------------------------------------------------------
# Tool scope
# --------------------------------------------------------------------------


def test_unrestricted_key_permits_every_tool():
    principal = McpPrincipal(allowed_tools=None)
    assert principal.permits("newsletter_dispatch")
    assert principal.permits("anything_at_all")


def test_restricted_key_permits_only_its_list():
    principal = McpPrincipal(allowed_tools=["leads_list", "dashboard_kpis"])
    assert principal.permits("leads_list")
    assert not principal.permits("newsletter_dispatch")


def test_key_scope_is_carried_through_resolution():
    generated, doc = make_key(allowed_tools=["leads_list"])
    db = FakeDB(keys=[doc], users=[make_user()])
    principal = resolve(db, f"Bearer {generated['plaintext']}")
    assert principal.allowed_tools == ["leads_list"]
    assert principal.permits("leads_list")
    assert not principal.permits("research_company_summarize")


def test_empty_allowed_tools_is_treated_as_unrestricted_not_deny_all():
    """A falsy list must mean 'no restriction', never 'nothing allowed'.

    Reading an empty list as deny-all would brick a key whose record was written
    with `allowed_tools: []`, which is indistinguishable from an omission.
    """
    generated, doc = make_key(allowed_tools=[])
    db = FakeDB(keys=[doc], users=[make_user()])
    principal = resolve(db, f"Bearer {generated['plaintext']}")
    assert principal.allowed_tools is None
    assert principal.permits("newsletter_dispatch")
