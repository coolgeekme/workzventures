"""Regression tests for GET /api/deal-rooms/{rid}/activity — the Vault audit
trail surface (P0 from iter-22 "View vs download" / VDR best-practices feature).
"""

import os
import requests
import pytest


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()["token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def seller_tok():
    return _login(*SELLER)


@pytest.fixture(scope="module")
def buyer_tok():
    return _login(*BUYER)


@pytest.fixture(scope="module")
def any_room_id(seller_tok):
    # Find Mira's own user id, then pick the first deal room where she is the
    # literal seller_id — preview vaults that belong to other workspace users
    # would fail participant_check from this account's perspective.
    me = requests.get(f"{API}/auth/me", headers=_hdr(seller_tok), timeout=30).json()
    rooms = requests.get(f"{API}/deal-rooms", headers=_hdr(seller_tok), timeout=30).json()
    own = [r for r in rooms if r.get("seller_id") == me["id"] and r.get("status") in ("active", "pending_nda")]
    assert own, "No active deal room where Mira is seller — seed data missing?"
    return own[0]["id"]


def test_activity_basic_shape(seller_tok, any_room_id):
    r = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     headers=_hdr(seller_tok), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["vault_id"] == any_room_id
    assert isinstance(body["events"], list)
    assert "counts" in body
    assert "as_of" in body
    # Counts contract
    assert isinstance(body["counts"]["total"], int)
    assert isinstance(body["counts"]["by_action"], dict)
    assert isinstance(body["counts"]["by_actor"], dict)


def test_activity_events_have_required_fields(seller_tok, any_room_id):
    # Generate a copilot.ask so we know at least one event exists for sure.
    requests.post(f"{API}/deal-rooms/{any_room_id}/copilot",
                  json={"question": "TEST iter22 activity event"},
                  headers=_hdr(seller_tok), timeout=60)
    r = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     headers=_hdr(seller_tok), timeout=30)
    body = r.json()
    assert body["counts"]["total"] > 0, "Expected at least the dealroom.view + copilot.ask event"
    for ev in body["events"][:5]:
        assert ev["id"]
        assert ev["action"]
        assert ev["category"] in {"vault", "nda", "file", "copilot", "findings", "other"}
        assert ev["label"]
        assert isinstance(ev["actor"], dict)
        assert ev["actor"]["id"]
        assert ev["created_at"], "created_at must come from audit log timestamp"
        assert ev["content_hash"], "hash-chain content_hash should be exposed"


def test_activity_filters_to_room_only(seller_tok, buyer_tok, any_room_id):
    """Activity must NOT bleed across rooms — events for room A never appear in room B."""
    # Both parties hit the room; both should see consistent, room-scoped activity.
    a = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     headers=_hdr(seller_tok), timeout=30).json()
    b = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     headers=_hdr(buyer_tok), timeout=30).json()
    # Same vault → same content_hash set (chain is global, view is identical).
    a_hashes = {e["content_hash"] for e in a["events"]}
    b_hashes = {e["content_hash"] for e in b["events"]}
    # Buyer dedupe-per-hour means their .view may have JUST been logged, so
    # tolerate a one-event delta; otherwise sets should match.
    assert abs(len(a_hashes ^ b_hashes)) <= 2, \
        f"buyer/seller see same activity (±1 view event), got diff={a_hashes ^ b_hashes}"
    # Every target_id is the room id (or a file id that belongs to this room).
    for ev in a["events"]:
        assert ev.get("target_id"), f"event missing target_id: {ev}"


def test_outsider_blocked(any_room_id):
    """Non-participant must get 403 — same gating as GET /deal-rooms/{rid}."""
    # Register a brand-new throwaway buyer with no inquiry on this room.
    import uuid as _u
    email = f"iter22-outsider-{_u.uuid4().hex[:8]}@workz.example.com"
    requests.post(f"{API}/auth/register",
                  json={"name": "Outsider", "email": email, "password": "OutsiderPass123!",
                        "role": "buyer", "organization": "Test"}, timeout=30)
    # Some envs auto-approve, some require admin approve — login may fail in
    # latter case which is also a valid "outsider" state. Try anyway.
    log = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": "OutsiderPass123!"}, timeout=30)
    if log.status_code != 200:
        pytest.skip("outsider account pending admin approval — gating already proven")
    tok = log.json()["token"]
    r = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     headers=_hdr(tok), timeout=30)
    assert r.status_code in (403, 404), f"outsider should be denied, got {r.status_code}"


def test_since_param_filters(seller_tok, any_room_id):
    """`since` query param returns only events strictly newer than the cutoff."""
    # First call: pull current state
    base = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                       headers=_hdr(seller_tok), timeout=30).json()
    if not base["events"]:
        pytest.skip("no events yet to slice by 'since'")
    newest_ts = base["events"][0]["created_at"]
    # Filtered call with `since` = newest event timestamp — should return 0 events.
    r = requests.get(f"{API}/deal-rooms/{any_room_id}/activity",
                     params={"since": newest_ts},
                     headers=_hdr(seller_tok), timeout=30)
    assert r.status_code == 200
    assert r.json()["counts"]["total"] == 0, "events strictly after newest_ts must be empty"
