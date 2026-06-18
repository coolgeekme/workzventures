"""
Iteration 18 — Collaborator role-edit + invite-revoke backend tests.

Covers PATCH /api/listings/{lid}/collaborators/{member_id}:
  - 200 + role updated + reflected in GET (Mira as owner)
  - 400 when target is the principal owner (seller_id)
  - 404 when collaborator not found
  - 422 when role is invalid (pydantic Literal)
  - 403/404 when caller is not editor of the listing

Covers DELETE /api/listings/{lid}/collaborators/invites/{iid}:
  - 200 on pending invite + invite removed from pending_invites
  - subsequent register with that token fails (404)
  - 400 on already-accepted invite
  - 404 on nonexistent invite id

Plus: editor (agent) collaborator can PATCH role + revoke invites.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

SELLER_EMAIL = "mira@workz.example.com"
SELLER_PASS = "WorkzPass123!"
BUYER_EMAIL = "alex@workz.example.com"
BUYER_PASS = "WorkzPass123!"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _rand_email():
    return f"invitee_{uuid.uuid4().hex[:10]}@workz.example.com"


def _create_invite(token, lid, email, role="editor"):
    r = requests.post(
        f"{API}/listings/{lid}/collaborators",
        headers=_auth(token),
        json={"email": email, "role": role},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()  # {ok, invite_id, token, accept_url}


def _materialize_collab(seller_token, lid, role="editor"):
    """Invite + register a brand-new user to create an accepted-collaborator
    membership. Returns (user_id, email, jwt)."""
    email = _rand_email()
    inv = _create_invite(seller_token, lid, email, role=role)
    token = inv["token"]
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "name": f"Member {email}",
            "role": "seller",
            "org_choice": "none",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "active", body
    return body["user"]["id"], email, body["token"]


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER_EMAIL, SELLER_PASS)


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER_EMAIL, BUYER_PASS)


@pytest.fixture(scope="module")
def seller_listing_id(seller_token):
    r = requests.get(f"{API}/listings", headers=_auth(seller_token), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("listings") or []
    assert items, "seller has no listings"
    return items[0]["id"]


@pytest.fixture(scope="module")
def seller_id(seller_token):
    r = requests.get(f"{API}/auth/me", headers=_auth(seller_token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# PATCH role tests
# ---------------------------------------------------------------------------

def test_patch_role_success_and_reflected_in_get(seller_token, seller_listing_id):
    member_id, email, _ = _materialize_collab(seller_token, seller_listing_id, role="viewer")

    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{member_id}",
        headers=_auth(seller_token),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "role": "editor"}

    # Verify reflected in GET
    r = requests.get(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    collabs = r.json().get("collaborators", [])
    match = [c for c in collabs if c.get("user_id") == member_id]
    assert match, f"member {email} ({member_id}) not in collaborators list"
    assert match[0].get("role") == "editor"


def test_patch_role_principal_owner_blocked(seller_token, seller_listing_id, seller_id):
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{seller_id}",
        headers=_auth(seller_token),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "")
    assert "principal owner" in detail.lower()

    # And the role didn't change
    r = requests.get(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("owner_id") == seller_id


def test_patch_role_nonexistent_user_404(seller_token, seller_listing_id):
    bogus_id = str(uuid.uuid4())
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{bogus_id}",
        headers=_auth(seller_token),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code == 404, r.text
    assert "not found" in r.json().get("detail", "").lower()


def test_patch_role_invalid_role_422(seller_token, seller_listing_id):
    member_id, _, _ = _materialize_collab(seller_token, seller_listing_id, role="viewer")
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{member_id}",
        headers=_auth(seller_token),
        json={"role": "admin"},
        timeout=20,
    )
    assert r.status_code == 422, r.text


def test_patch_role_unauthorized_caller(buyer_token, seller_listing_id):
    """A regular buyer not on the listing should be blocked by
    _listing_for_edit_or_404 (403 or 404)."""
    bogus_id = str(uuid.uuid4())
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{bogus_id}",
        headers=_auth(buyer_token),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# DELETE invite tests
# ---------------------------------------------------------------------------

def test_revoke_pending_invite_success(seller_token, seller_listing_id):
    email = _rand_email()
    inv = _create_invite(seller_token, seller_listing_id, email, role="viewer")
    iid = inv["invite_id"]
    token = inv["token"]

    r = requests.delete(
        f"{API}/listings/{seller_listing_id}/collaborators/invites/{iid}",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    # Subsequent GET should not include this invite
    r = requests.get(
        f"{API}/listings/{seller_listing_id}/collaborators",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 200
    pending = r.json().get("pending_invites", [])
    ids = [p.get("id") for p in pending]
    assert iid not in ids, f"revoked invite still in pending list: {ids}"

    # Register attempt with that token should fail
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "name": "Late Joiner",
            "role": "buyer",
            "org_choice": "none",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    # Backend should reject the now-deleted invite token (400 invalid invite)
    assert r.status_code in (400, 404), f"expected 400/404 for revoked token, got {r.status_code}: {r.text}"


def test_revoke_already_accepted_invite_400(seller_token, seller_listing_id):
    # Materialize a collab (which accepts the invite)
    email = _rand_email()
    inv = _create_invite(seller_token, seller_listing_id, email, role="viewer")
    iid = inv["invite_id"]
    token = inv["token"]

    # Accept via register
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "name": "Accepted",
            "role": "seller",
            "org_choice": "none",
            "listing_invite_token": token,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "active"

    # Now try to revoke
    r = requests.delete(
        f"{API}/listings/{seller_listing_id}/collaborators/invites/{iid}",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "").lower()
    assert "already accepted" in detail, f"unexpected error detail: {detail}"


def test_revoke_nonexistent_invite_404(seller_token, seller_listing_id):
    bogus_iid = str(uuid.uuid4())
    r = requests.delete(
        f"{API}/listings/{seller_listing_id}/collaborators/invites/{bogus_iid}",
        headers=_auth(seller_token),
        timeout=20,
    )
    assert r.status_code == 404, r.text
    assert "not found" in r.json().get("detail", "").lower()


# ---------------------------------------------------------------------------
# Editor (non-principal) collaborator can PATCH + DELETE invites
# ---------------------------------------------------------------------------

def test_editor_collaborator_can_patch_role_and_revoke_invites(seller_token, seller_listing_id):
    # Rule 1B: an editor can only manage members THEY personally invited (plus the
    # principal owner can manage everyone). This test exercises the inviter path:
    # an editor invites Carol, then PATCHes Carol's role + revokes a separate
    # invite they created. The editor can NOT mutate a Mira-invited collaborator.
    # Step 1: invite + register an "agent" as editor — they get an active user + jwt
    agent_id, agent_email, agent_jwt = _materialize_collab(
        seller_token, seller_listing_id, role="editor"
    )

    # Step 2: as Mira (principal), create a SECOND collab (viewer) — the agent
    # MUST NOT be able to patch this one (Rule 1B).
    mira_invited_id, _, _ = _materialize_collab(
        seller_token, seller_listing_id, role="viewer"
    )
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{mira_invited_id}",
        headers=_auth(agent_jwt),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code == 403, f"agent must NOT PATCH a Mira-invited collab under Rule 1B: {r.status_code} {r.text}"

    # Step 3: now the agent invites THEIR OWN collab + PATCHes — should succeed.
    own_target_id, _, _ = _materialize_collab(
        agent_jwt, seller_listing_id, role="viewer"
    )
    r = requests.patch(
        f"{API}/listings/{seller_listing_id}/collaborators/{own_target_id}",
        headers=_auth(agent_jwt),
        json={"role": "editor"},
        timeout=20,
    )
    assert r.status_code == 200, f"agent PATCH on their own invitee should succeed: {r.status_code} {r.text}"
    assert r.json().get("role") == "editor"

    # Step 4: agent creates a NEW invite, then revokes it (they're the inviter).
    new_email = _rand_email()
    inv = _create_invite(agent_jwt, seller_listing_id, new_email, role="viewer")
    iid = inv["invite_id"]

    r = requests.delete(
        f"{API}/listings/{seller_listing_id}/collaborators/invites/{iid}",
        headers=_auth(agent_jwt),
        timeout=20,
    )
    assert r.status_code == 200, f"agent revoke of own invite should succeed: {r.status_code} {r.text}"
    assert r.json().get("ok") is True
