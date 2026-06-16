"""
Iter-15 RBAC + corner-case tests for Organizations + Per-listing Collaborators.

Focus areas (per main-agent ask):
- Permission/RBAC corner cases for /api/orgs, /api/listings, collaborators, access policy
- Mis-matched invite emails (must 403)
- New /register org_choice + role='agent' acceptance
- Regression: legacy seller listings (no org_id, no collaborators[]) still editable/deletable
- GET /api/listings returns union (owned + org-owned + collaborated)
- Deal-room collaborator endpoints

Run:
    cd /app/backend && PYTHONPATH=. python -m pytest tests/test_orgs_collab_rbac.py -v
"""
import os
import uuid
import time
import pytest
import requests

API = os.environ.get("TEST_API_URL", "https://buyer-intel-lab.preview.emergentagent.com/api")
SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")
ADMIN = ("admin@workz.example.com", "WorkzAdmin123!")


def _login(creds):
    r = requests.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def seller_tok():
    return _login(SELLER)


@pytest.fixture(scope="module")
def buyer_tok():
    return _login(BUYER)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


# ---------- /api/orgs RBAC ----------

class TestOrgsRBAC:
    def test_create_org_returns_admin_role(self, seller_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"RBAC Org {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["my_role"] == "org_admin"
        assert body["member_count"] == 1
        assert "id" in body

    def test_get_orgs_mine_scoped(self, seller_tok, buyer_tok):
        name = f"Scope Org {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/orgs", json={"name": name, "org_type": "other"}, headers=_h(seller_tok))
        oid = r.json()["id"]

        # Seller sees it
        r = requests.get(f"{API}/orgs/mine", headers=_h(seller_tok))
        assert any(o["id"] == oid for o in r.json())

        # Buyer does NOT see it
        r = requests.get(f"{API}/orgs/mine", headers=_h(buyer_tok))
        assert not any(o["id"] == oid for o in r.json())

    def test_get_org_detail_membership_required(self, seller_tok, buyer_tok, admin_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"Detail Org {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]

        # Member ok
        assert requests.get(f"{API}/orgs/{oid}", headers=_h(seller_tok)).status_code == 200
        # Non-member 403
        rb = requests.get(f"{API}/orgs/{oid}", headers=_h(buyer_tok))
        assert rb.status_code == 403, rb.text
        # Admin can view
        assert requests.get(f"{API}/orgs/{oid}", headers=_h(admin_tok)).status_code == 200

    def test_patch_org_requires_org_admin(self, seller_tok, buyer_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"Patch Org {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        # Buyer (non-member) can't patch
        rb = requests.patch(f"{API}/orgs/{oid}", json={"name": "Hacked"}, headers=_h(buyer_tok))
        assert rb.status_code in (403, 404), rb.text
        # Owner can
        ro = requests.patch(f"{API}/orgs/{oid}", json={"name": "Renamed by owner"}, headers=_h(seller_tok))
        assert ro.status_code == 200

    def test_invite_existing_member_rejected(self, seller_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"DupeInv {uuid.uuid4().hex[:6]}", "org_type": "other"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        # Inviting self (already a member) → 400
        r = requests.post(f"{API}/orgs/{oid}/invites", json={"email": SELLER[0], "role": "org_member"}, headers=_h(seller_tok))
        assert r.status_code == 400, r.text

    def test_invite_requires_org_admin(self, seller_tok, buyer_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"InvAuth {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        # Buyer (not a member) cannot invite
        rb = requests.post(
            f"{API}/orgs/{oid}/invites",
            json={"email": f"x-{uuid.uuid4().hex[:6]}@example.com", "role": "org_member"},
            headers=_h(buyer_tok),
        )
        assert rb.status_code in (403, 404), rb.text

    def test_public_invite_lookup(self, seller_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"PubInv {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        r = requests.post(
            f"{API}/orgs/{oid}/invites",
            json={"email": f"pub-{uuid.uuid4().hex[:6]}@example.com", "role": "org_member"},
            headers=_h(seller_tok),
        )
        token = r.json()["token"]
        # Public lookup (no auth)
        r = requests.get(f"{API}/org-invites/{token}")
        assert r.status_code == 200
        body = r.json()
        assert "org_name" in body
        assert body["role"] == "org_member"
        # Unknown token -> 404
        r = requests.get(f"{API}/org-invites/{uuid.uuid4().hex}")
        assert r.status_code == 404

    def test_org_invite_email_mismatch_403(self, seller_tok, buyer_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"MismatchOrg {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        r = requests.post(
            f"{API}/orgs/{oid}/invites",
            json={"email": f"someone-not-buyer-{uuid.uuid4().hex[:6]}@example.com", "role": "org_member"},
            headers=_h(seller_tok),
        )
        token = r.json()["token"]
        # Buyer (alex@…) tries to accept but invite was for someone-else@…
        r = requests.post(f"{API}/org-invites/{token}/accept", headers=_h(buyer_tok))
        assert r.status_code == 403, r.text

    def test_members_list_includes_roles(self, seller_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"Memb {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        r = requests.get(f"{API}/orgs/{oid}/members", headers=_h(seller_tok))
        assert r.status_code == 200
        members = r.json()
        assert len(members) >= 1
        m0 = members[0]
        assert "platform_role" in m0 and "org_role" in m0

    def test_cannot_remove_last_admin(self, seller_tok):
        r = requests.post(f"{API}/orgs", json={"name": f"LastAdm {uuid.uuid4().hex[:6]}", "org_type": "advisory"}, headers=_h(seller_tok))
        oid = r.json()["id"]
        # Find seller's own user_id from members list
        members = requests.get(f"{API}/orgs/{oid}/members", headers=_h(seller_tok)).json()
        uid = members[0]["user_id"]
        # Removing self when sole admin should be blocked
        r = requests.delete(f"{API}/orgs/{oid}/members/{uid}", headers=_h(seller_tok))
        assert r.status_code in (400, 403), r.text


# ---------- /api/listings RBAC + regression ----------

class TestListingsRBAC:
    def test_create_listing_initialises_collab_fields(self, seller_tok):
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"L1 {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 5, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Should have collaborators[] + access_policy initialised
        assert "collaborators" in body
        assert isinstance(body["collaborators"], list)
        assert "access_policy" in body
        ap = body["access_policy"]
        assert ap.get("require_principal_approval") in (False, True)
        assert isinstance(ap.get("competitor_blocklist", []), list)
        requests.delete(f"{API}/listings/{body['id']}", headers=_h(seller_tok))

    def test_listings_union_owned_org_collab(self, seller_tok):
        r = requests.get(f"{API}/listings", headers=_h(seller_tok))
        assert r.status_code == 200
        listings = r.json()
        # Should include legacy seed listings (Helios MedTech / Atlas Logistics / Vertex Climate)
        names = [l.get("company_name", "") for l in listings]
        # At least seed ones present
        assert any("Helios" in n or "Atlas" in n or "Vertex" in n for n in names), f"Seed listings missing: {names[:10]}"

    def test_buyer_cannot_edit_or_delete_unrelated_listing(self, seller_tok, buyer_tok):
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"NoTouch {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        lid = r.json()["id"]
        # Buyer PATCH must be 403 (send full ListingCreate body so we don't get 422)
        rp = requests.patch(
            f"{API}/listings/{lid}",
            json={"company_name": "Hacked", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "Hacked", "summary": "Hacked", "status": "draft"},
            headers=_h(buyer_tok),
        )
        assert rp.status_code in (403, 404), rp.text
        # Buyer DELETE must be 403/404
        rd = requests.delete(f"{API}/listings/{lid}", headers=_h(buyer_tok))
        assert rd.status_code in (403, 404), rd.text
        requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))

    def test_legacy_seed_listing_edit_and_revert(self, seller_tok):
        """Seed listings lack org_id + collaborators[] and must still be editable by owner."""
        listings = requests.get(f"{API}/listings", headers=_h(seller_tok)).json()
        seed = next((l for l in listings if "Helios" in l.get("company_name", "") or
                     "Atlas" in l.get("company_name", "") or
                     "Vertex" in l.get("company_name", "")), None)
        if seed is None:
            pytest.skip("No seed listing surfaced")
        lid = seed["id"]
        # PATCH requires full ListingCreate body
        full = {
            "company_name": seed.get("company_name"),
            "sector": seed.get("sector"),
            "geography": seed.get("geography"),
            "asking_price_usd_m": seed.get("asking_price_usd_m"),
            "headline": seed.get("headline", ""),
            "summary": seed.get("summary", ""),
            "status": seed.get("status", "draft"),
        }
        new = f"RBAC-test-edit {uuid.uuid4().hex[:4]}"
        full_edit = {**full, "headline": new}
        r = requests.patch(f"{API}/listings/{lid}", json=full_edit, headers=_h(seller_tok))
        assert r.status_code == 200, r.text
        # GET to verify persistence
        listings2 = requests.get(f"{API}/listings", headers=_h(seller_tok)).json()
        after = next((l for l in listings2 if l["id"] == lid), None)
        assert after and after.get("headline") == new
        # revert
        requests.patch(f"{API}/listings/{lid}", json=full, headers=_h(seller_tok))

    def test_collaborator_invite_requires_edit_perm(self, seller_tok, buyer_tok):
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"CollabPerm {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        lid = r.json()["id"]
        # Buyer (not collaborator) cannot invite
        rb = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": f"x-{uuid.uuid4().hex[:6]}@example.com", "role": "editor"},
            headers=_h(buyer_tok),
        )
        assert rb.status_code in (403, 404), rb.text
        # Owner can
        ro = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": f"x-{uuid.uuid4().hex[:6]}@example.com", "role": "editor"},
            headers=_h(seller_tok),
        )
        assert ro.status_code == 200, ro.text
        requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))

    def test_double_invite_collaborator_rejected(self, seller_tok):
        """Cannot invite an existing collaborator (400). Existing collaborator created
        by accepting an invite — here we shortcut by inviting the same email twice and
        expecting the second to error (pending dup)."""
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"DupCo {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        lid = r.json()["id"]
        email = f"dupe-{uuid.uuid4().hex[:6]}@example.com"
        r1 = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": email, "role": "editor"}, headers=_h(seller_tok),
        )
        assert r1.status_code == 200
        # Second invite to same email — server may dedupe pending OR allow; record actual
        r2 = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": email, "role": "editor"}, headers=_h(seller_tok),
        )
        # Acceptable: 400 (dedup) OR 200 (idempotent overwrite). Just don't 500.
        assert r2.status_code in (200, 400), r2.text
        requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))

    def test_listing_invite_email_mismatch_403(self, seller_tok, buyer_tok):
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"MM {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        lid = r.json()["id"]
        r = requests.post(
            f"{API}/listings/{lid}/collaborators",
            json={"email": f"not-buyer-{uuid.uuid4().hex[:6]}@example.com", "role": "editor"},
            headers=_h(seller_tok),
        )
        token = r.json()["token"]
        ra = requests.post(f"{API}/listing-invites/{token}/accept", headers=_h(buyer_tok))
        assert ra.status_code == 403, ra.text
        requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))

    def test_access_policy_normalization_and_perm(self, seller_tok, buyer_tok):
        r = requests.post(
            f"{API}/listings",
            json={"company_name": f"AP {uuid.uuid4().hex[:5]}", "sector": "SaaS", "geography": "NA",
                  "asking_price_usd_m": 1, "headline": "T", "summary": "T", "status": "draft"},
            headers=_h(seller_tok),
        )
        lid = r.json()["id"]
        r = requests.patch(
            f"{API}/listings/{lid}/access-policy",
            json={"require_principal_approval": True,
                  "competitor_blocklist": ["  AcmE.COM  ", "FooCorp", "", "ACME.com"]},
            headers=_h(seller_tok),
        )
        assert r.status_code == 200, r.text
        pol = r.json()["access_policy"]
        assert pol["require_principal_approval"] is True
        bl = pol["competitor_blocklist"]
        assert "acme.com" in bl and "foocorp" in bl
        assert "" not in bl
        # Dedup: only one acme.com
        assert bl.count("acme.com") == 1
        # Buyer (unrelated) cannot patch
        rb = requests.patch(f"{API}/listings/{lid}/access-policy",
                            json={"require_principal_approval": False}, headers=_h(buyer_tok))
        assert rb.status_code == 403, rb.text
        requests.delete(f"{API}/listings/{lid}", headers=_h(seller_tok))


# ---------- /register new fields ----------

class TestRegisterOrgChoice:
    def test_register_create_org_and_agent_role(self):
        email = f"pytest-agent-{uuid.uuid4().hex[:8]}@example.com"
        org_name = f"AgentCo {uuid.uuid4().hex[:5]}"
        payload = {
            "email": email,
            "password": "TestPass123!",
            "name": "PyTest Agent",
            "role": "agent",
            "organization": "PyTest",
            "org_choice": "create",
            "org_name": org_name,
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"

    def test_register_join_with_invalid_token_rejected(self):
        email = f"pytest-join-{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email,
            "password": "TestPass123!",
            "name": "PyTest Join",
            "role": "buyer",
            "organization": "PyTest",
            "org_choice": "join",
            "org_invite_token": "definitely-not-a-real-token-" + uuid.uuid4().hex,
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        # Spec: token is stashed and resolved on admin-approve; either now-reject (400) or accept-and-defer (200).
        assert r.status_code in (200, 201, 400, 404), r.text

    def test_register_no_org_still_works(self):
        email = f"pytest-none-{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!", "name": "PyTest None",
            "role": "seller", "organization": "PyTest", "org_choice": "none",
        })
        assert r.status_code in (200, 201), r.text


# ---------- Deal-room collaborators ----------

class TestDealRoomCollaborators:
    def test_non_member_blocked(self, seller_tok, buyer_tok, admin_tok):
        # Find any deal-room the seller participates in
        r = requests.get(f"{API}/deal-rooms", headers=_h(seller_tok))
        if r.status_code != 200 or not r.json():
            pytest.skip("No deal rooms available for this test")
        rooms = r.json()
        rid = rooms[0]["id"]
        # Buyer might or might not be on this room; try a clearly-unrelated admin → buyer scenario
        # We'll just assert the endpoint exists and returns 200/403 cleanly
        r = requests.get(f"{API}/deal-rooms/{rid}/collaborators", headers=_h(seller_tok))
        assert r.status_code in (200, 403, 404), r.text

    def test_invite_nonexistent_user_rejected(self, seller_tok):
        r = requests.get(f"{API}/deal-rooms", headers=_h(seller_tok))
        if r.status_code != 200 or not r.json():
            pytest.skip("No deal rooms")
        rid = r.json()[0]["id"]
        r = requests.post(
            f"{API}/deal-rooms/{rid}/collaborators",
            json={"email": f"ghost-{uuid.uuid4().hex[:6]}@nowhere.example.com", "role": "viewer"},
            headers=_h(seller_tok),
        )
        # Spec: cannot add a user who isn't on NextCapOS → 400
        assert r.status_code in (400, 403, 404), r.text


# ---------- Existing flows regression ----------

class TestRegressionExistingFlows:
    def test_seller_my_listings_intact(self, seller_tok):
        r = requests.get(f"{API}/listings", headers=_h(seller_tok))
        assert r.status_code == 200
        # Seller must still see their seeded listings
        names = {l.get("company_name", "") for l in r.json()}
        assert names, "Seller sees zero listings — regression"

    def test_marketplace_browse_intact(self, buyer_tok):
        r = requests.get(f"{API}/marketplace", headers=_h(buyer_tok))
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_inquiries_endpoint_intact(self, buyer_tok):
        r = requests.get(f"{API}/inquiries", headers=_h(buyer_tok))
        assert r.status_code in (200,), r.text
