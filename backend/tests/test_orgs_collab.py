"""
End-to-end pytest for the org + collaborators feature. Hits the actual
preview backend over HTTP so it exercises permission checks, invite flows,
and the access-policy normalization the way real clients do.

Run:
    cd /app/backend && PYTHONPATH=. python -m pytest tests/test_orgs_collab.py -v
"""
import os
import uuid
import time
import requests

API = os.environ.get(
    "TEST_API_URL",
    "https://buyer-intel-lab.preview.emergentagent.com/api",
)
SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")


def _login(creds):
    r = requests.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_org_create_list_invite_revoke():
    tok = _login(SELLER)
    name = f"PyTest Org {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/orgs", json={"name": name, "org_type": "advisory"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    org = r.json()
    assert org["my_role"] == "org_admin"
    assert org["member_count"] == 1
    org_id = org["id"]

    # List my orgs includes the new one
    r = requests.get(f"{API}/orgs/mine", headers=_h(tok))
    assert any(o["id"] == org_id for o in r.json())

    # Invite a member
    r = requests.post(
        f"{API}/orgs/{org_id}/invites",
        json={"email": f"pytest-invite-{uuid.uuid4().hex[:6]}@example.com", "role": "org_member"},
        headers=_h(tok),
    )
    assert r.status_code == 200
    invite_id = r.json()["invite_id"]
    token = r.json()["token"]

    # Public invite endpoint works without auth
    r = requests.get(f"{API}/org-invites/{token}")
    assert r.status_code == 200
    assert r.json()["org_name"] == name

    # Revoke
    r = requests.delete(f"{API}/orgs/{org_id}/invites/{invite_id}", headers=_h(tok))
    assert r.status_code == 200


def test_listing_collaborators_and_policy():
    tok = _login(SELLER)
    # Create a listing
    r = requests.post(
        f"{API}/listings",
        json={
            "company_name": f"PyTest Co {uuid.uuid4().hex[:5]}",
            "sector": "SaaS", "geography": "NA", "asking_price_usd_m": 10,
            "headline": "Test", "summary": "Test", "status": "draft",
        },
        headers=_h(tok),
    )
    assert r.status_code == 200, r.text
    lid = r.json()["id"]

    # Invite a collaborator
    email = f"principal-{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{API}/listings/{lid}/collaborators",
        json={"email": email, "role": "owner", "message": "Hi"},
        headers=_h(tok),
    )
    assert r.status_code == 200, r.text
    assert "token" in r.json()

    # Pending invite shows up
    r = requests.get(f"{API}/listings/{lid}/collaborators", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert len(body["pending_invites"]) >= 1

    # Update access policy
    r = requests.patch(
        f"{API}/listings/{lid}/access-policy",
        json={
            "require_principal_approval": True,
            "competitor_blocklist": ["  Competitor.COM  ", "BigCorp", ""],
        },
        headers=_h(tok),
    )
    assert r.status_code == 200, r.text
    pol = r.json()["access_policy"]
    assert pol["require_principal_approval"] is True
    # Normalised: lowercased, stripped, empty dropped
    assert "competitor.com" in pol["competitor_blocklist"]
    assert "bigcorp" in pol["competitor_blocklist"]
    assert "" not in pol["competitor_blocklist"]

    # Buyer cannot edit access policy on a listing they don't own/collaborate on
    btok = _login(BUYER)
    r = requests.patch(
        f"{API}/listings/{lid}/access-policy",
        json={"require_principal_approval": False},
        headers=_h(btok),
    )
    assert r.status_code == 403, f"Buyer should not be able to edit access policy: {r.status_code} {r.text}"

    # Cleanup
    requests.delete(f"{API}/listings/{lid}", headers=_h(tok))


def test_invite_token_must_match_email():
    """An attacker who steals a listing-invite token cannot accept it
    if their account email doesn't match the invited email."""
    seller_tok = _login(SELLER)
    r = requests.post(
        f"{API}/listings",
        json={
            "company_name": f"Sec {uuid.uuid4().hex[:5]}",
            "sector": "SaaS", "geography": "NA", "asking_price_usd_m": 1,
            "headline": "T", "summary": "T", "status": "draft",
        },
        headers=_h(seller_tok),
    )
    lid = r.json()["id"]
    r = requests.post(
        f"{API}/listings/{lid}/collaborators",
        json={"email": "someone-else@example.com", "role": "editor"},
        headers=_h(seller_tok),
    )
    token = r.json()["token"]
    # Buyer demo tries to accept — email mismatch -> 403
    btok = _login(BUYER)
    r = requests.post(f"{API}/listing-invites/{token}/accept", headers=_h(btok))
    assert r.status_code == 403
    requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))


def test_cannot_double_invite_same_member():
    tok = _login(SELLER)
    r = requests.post(f"{API}/orgs", json={"name": f"Dupe Org {uuid.uuid4().hex[:5]}", "org_type": "other"}, headers=_h(tok))
    org_id = r.json()["id"]
    # Org creator IS already a member; inviting them by email should be rejected
    r = requests.post(
        f"{API}/orgs/{org_id}/invites",
        json={"email": SELLER[0], "role": "org_member"},
        headers=_h(tok),
    )
    assert r.status_code == 400, r.text
