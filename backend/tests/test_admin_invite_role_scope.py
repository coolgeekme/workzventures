"""Regression: admin-invited users must land as PRINCIPAL with their full
role-based nav — not as a stripped-down "collaborator".

Bug context: `_compute_account_scope` previously returned "collaborator" for
any non-admin who happened to own zero listings + admin zero orgs. That hit
brand-new agent/seller/buyer accounts created via the admin invite flow,
forcing them onto the COLLAB_NAV ("My Collaborations" + "Security") instead
of the real BUYER/SELLER/AGENT nav.
"""

import io
import os
import secrets
import requests
import pytest


def _api():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
    return v.rstrip("/") + "/api"


API = _api()
ADMIN = ("admin@workz.example.com", "WorkzAdmin123!")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


def _create_invite_and_accept(admin_tok, role, name="Test User"):
    """Admin invites a fresh email as `role`, then we accept on the user's
    behalf and verify the returned UserPublic.account_scope == 'principal'."""
    suffix = secrets.token_hex(4)
    email = f"invitee.{role}.{suffix}@workz.example.com"
    inv = requests.post(
        f"{API}/admin/invites",
        json={"email": email, "name": name, "role": role, "organization": None,
              "expires_hours": 1},
        headers={"Authorization": f"Bearer {admin_tok}"},
        timeout=30,
    )
    assert inv.status_code == 200, inv.text
    token = inv.json()["token"]

    acc = requests.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "name": name, "password": "WorkzPass123!"},
        timeout=30,
    )
    assert acc.status_code == 200, acc.text
    return acc.json(), email


class TestAdminInviteScope:
    def test_invited_agent_lands_as_principal(self, admin_tok):
        payload, email = _create_invite_and_accept(admin_tok, "agent", "Agent Smith")
        user = payload["user"]
        assert user["role"] == "agent", f"role lost — got {user['role']}"
        assert user["account_scope"] == "principal", \
            f"invited agent must be principal, got {user['account_scope']}"

    def test_invited_seller_lands_as_principal(self, admin_tok):
        payload, _ = _create_invite_and_accept(admin_tok, "seller", "Sally Seller")
        user = payload["user"]
        assert user["role"] == "seller"
        assert user["account_scope"] == "principal", \
            f"invited seller must be principal, got {user['account_scope']}"

    def test_invited_buyer_lands_as_principal(self, admin_tok):
        payload, _ = _create_invite_and_accept(admin_tok, "buyer", "Bob Buyer")
        user = payload["user"]
        assert user["role"] == "buyer"
        assert user["account_scope"] == "principal", \
            f"invited buyer must be principal, got {user['account_scope']}"

    def test_invited_agent_persists_principal_across_login(self, admin_tok):
        """Re-login a fresh-invited agent and confirm /auth/me still returns
        account_scope=principal (i.e. it's not just the first-token payload)."""
        _payload, email = _create_invite_and_accept(admin_tok, "agent", "Agent Persist")
        tok = _login(email, "WorkzPass123!")
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        assert me.status_code == 200, me.text
        assert me.json()["role"] == "agent"
        assert me.json()["account_scope"] == "principal"


class TestListingCollabUnchanged:
    """Sanity: a real listing-collaborator (added via the listing collab
    invite flow) must still be 'collaborator'. We can't easily set this up
    end-to-end here, so we just assert the heuristic doesn't fall back to
    principal for the canonical positive case."""

    def test_listing_collab_remains_collaborator(self, admin_tok):
        """Create a fresh user, then have the seller add them as a listing
        collaborator. Verify scope flips to 'collaborator'."""
        # Step 1: invite a fresh user as buyer.
        _payload, email = _create_invite_and_accept(admin_tok, "buyer", "Collab Carl")
        carl_tok = _login(email, "WorkzPass123!")
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {carl_tok}"}, timeout=30).json()
        assert me["account_scope"] == "principal", "baseline should be principal"

        # Step 2: seller invites Carl as a listing collaborator.
        seller_tok = _login("mira@workz.example.com", "WorkzPass123!")
        me_seller = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {seller_tok}"}, timeout=30).json()
        listings = requests.get(f"{API}/listings",
                                headers={"Authorization": f"Bearer {seller_tok}"},
                                timeout=30).json()
        own = [l for l in listings if l.get("seller_id") == me_seller["id"]]
        if not own:
            pytest.skip("seller has no listings to attach a collab to")
        lid = own[0]["id"]

        inv = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": email, "role": "viewer"},
            headers={"Authorization": f"Bearer {seller_tok}"},
            timeout=30,
        )
        assert inv.status_code in (200, 201), f"invite endpoint failed: {inv.status_code} {inv.text}"
        body = inv.json()
        token = body.get("token") or body.get("invite", {}).get("token")
        if not token:
            pytest.skip(f"could not extract listing collab invite token from {body}")

        # Step 3: Carl accepts the listing collab invite.
        acc = requests.post(
            f"{API}/listing-invites/{token}/accept",
            headers={"Authorization": f"Bearer {carl_tok}"},
            timeout=30,
        )
        assert acc.status_code == 200, acc.text

        # Step 4: Carl re-fetches /auth/me — scope should now be collaborator.
        me2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {carl_tok}"}, timeout=30).json()
        assert me2["account_scope"] == "collaborator", \
            f"listing-collab Carl must be collaborator, got {me2['account_scope']}"
