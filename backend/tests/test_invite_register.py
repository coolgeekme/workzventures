"""
Iteration 17 — Invite-driven registration fast-path tests.

Covers:
  - Listing invite token → register returns active + JWT + user is collaborator
  - Listing invite mismatched email → 400 + user NOT created
  - Org invite token (org_choice='join') → active + JWT + org_id populated
  - No invite token → pending (legacy behavior)
  - Expired listing invite → 400 "Listing invite expired"
  - Already-accepted listing invite → 400 "Listing invite already accepted"
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SELLER_EMAIL = "mira@workz.example.com"
SELLER_PASS = "WorkzPass123!"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _rand_email():
    return f"invitee_{uuid.uuid4().hex[:10]}@workz.example.com"


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER_EMAIL, SELLER_PASS)


@pytest.fixture(scope="module")
def seller_listing_id(seller_token):
    r = requests.get(f"{API}/listings", headers=_auth(seller_token), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    # API returns dict or list — handle both
    if isinstance(items, dict):
        items = items.get("items") or items.get("listings") or []
    assert items, "seller has no listings to invite from"
    return items[0]["id"]


@pytest.fixture(scope="module")
def seller_org_id(seller_token):
    r = requests.get(f"{API}/orgs/mine", headers=_auth(seller_token), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("orgs") or items.get("items") or []
    assert items, "seller has no orgs"
    return items[0]["id"]


# ---------------------------------------------------------------------------
# Listing invite fast-path
# ---------------------------------------------------------------------------

def test_register_with_listing_invite_token_active(seller_token, seller_listing_id):
    invitee_email = _rand_email()
    # Create listing invite
    r = requests.post(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        json={"email": invitee_email, "role": "editor", "message": "Join us"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    # Register with invite token
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": invitee_email,
            "password": "TestPass123!",
            "name": "Test Invitee",
            "role": "seller",
            "org_choice": "none",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "active"
    assert body.get("token"), "JWT token missing"
    assert body.get("user", {}).get("email") == invitee_email
    assert body.get("listing_id") == seller_listing_id

    # New user can call GET /api/listings and see the listing
    new_jwt = body["token"]
    r = requests.get(f"{API}/listings", headers=_auth(new_jwt), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("listings") or []
    ids = [x["id"] for x in items]
    assert seller_listing_id in ids, f"new user not seeing invited listing. saw {ids}"


def test_register_with_listing_invite_mismatched_email_rejected(seller_token, seller_listing_id):
    invitee_email = _rand_email()
    wrong_email = _rand_email()
    r = requests.post(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        json={"email": invitee_email, "role": "viewer"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": wrong_email,  # mismatched
            "password": "TestPass123!",
            "name": "Wrong User",
            "role": "buyer",
            "org_choice": "none",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    detail = r.json().get("detail", "")
    assert "invite is for" in detail.lower(), f"unexpected error message: {detail}"
    assert invitee_email in detail

    # Confirm the wrong_email user was NOT created — try to register normally
    r2 = requests.post(
        f"{API}/auth/register",
        json={
            "email": wrong_email,
            "password": "TestPass123!",
            "name": "Wrong User",
            "role": "buyer",
            "org_choice": "none",
        },
        timeout=20,
    )
    # If the user wasn't created on first call, this should be 200 (pending)
    assert r2.status_code == 200, f"user was partially created — second register got {r2.status_code}: {r2.text}"
    assert r2.json().get("status") == "pending"


def test_register_without_invite_returns_pending():
    invitee_email = _rand_email()
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": invitee_email,
            "password": "TestPass123!",
            "name": "Pending User",
            "role": "buyer",
            "org_choice": "none",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "pending"
    assert "token" not in body or not body.get("token")


def test_register_with_expired_listing_invite_rejected(seller_token, seller_listing_id):
    """Insert an expired invite directly via the same flow then monkey-patch
    its expires_at by calling resend (which doesn't reset expiry).
    
    Since we can't easily monkey-patch the DB from outside, we instead create
    a normal invite and accept it, then attempt to re-register — covering the
    'already accepted' case. Expired case is exercised below via a fresh
    invite where we don't have DB access — skip if env doesn't support it.
    """
    import importlib.util
    spec = importlib.util.find_spec("motor")
    if spec is None:
        pytest.skip("motor not installed in test env — can't monkey-patch expires_at")

    # Use sync pymongo if motor unavailable for direct DB writes
    try:
        from pymongo import MongoClient
    except ImportError:
        pytest.skip("pymongo not available")

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        # read backend .env
        from pathlib import Path
        envf = Path("/app/backend/.env")
        if envf.exists():
            for line in envf.read_text().splitlines():
                if line.startswith("MONGO_URL=") and not mongo_url:
                    mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if line.startswith("DB_NAME=") and not db_name:
                    db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME not available")

    client = MongoClient(mongo_url)
    coll = client[db_name].listing_invites

    invitee_email = _rand_email()
    r = requests.post(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        json={"email": invitee_email, "role": "viewer"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    # Force the invite into expired state
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    res = coll.update_one({"token": token}, {"$set": {"expires_at": past}})
    assert res.modified_count == 1

    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": invitee_email,
            "password": "TestPass123!",
            "name": "Late User",
            "role": "buyer",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    assert "expired" in r.json().get("detail", "").lower()


def test_register_with_already_accepted_listing_invite_rejected(seller_token, seller_listing_id):
    invitee_email = _rand_email()
    r = requests.post(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        json={"email": invitee_email, "role": "viewer"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    # 1st register — accepts the invite
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": invitee_email,
            "password": "TestPass123!",
            "name": "First Use",
            "role": "buyer",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "active"

    # 2nd register with same (now-accepted) token + different email
    other_email = _rand_email()
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": other_email,
            "password": "TestPass123!",
            "name": "Second Use",
            "role": "buyer",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    assert "already accepted" in r.json().get("detail", "").lower()


# ---------------------------------------------------------------------------
# Org invite fast-path
# ---------------------------------------------------------------------------

def test_register_with_org_invite_token_active(seller_token, seller_org_id):
    invitee_email = _rand_email()
    r = requests.post(
        f"{API}/orgs/{seller_org_id}/invites",
        headers=_auth(seller_token),
        json={"email": invitee_email, "role": "org_member"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": invitee_email,
            "password": "TestPass123!",
            "name": "Org Joiner",
            "role": "buyer",
            "org_choice": "join",
            "org_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "active"
    assert body.get("token"), "JWT missing"
    assert body.get("org_id") == seller_org_id

    # Confirm the new user sees the org via /api/orgs/mine
    new_jwt = body["token"]
    r = requests.get(f"{API}/orgs/mine", headers=_auth(new_jwt), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    if isinstance(rows, dict):
        rows = rows.get("orgs") or rows.get("items") or []
    match = [o for o in rows if o.get("id") == seller_org_id]
    assert match, f"new user not seeing invited org. saw {[o.get('id') for o in rows]}"
    assert match[0].get("my_role") == "org_member"
