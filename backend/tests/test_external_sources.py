"""
Backend tests for Listing External File Sources (Composio mirror feature).

Covers:
- GET /api/listings/{lid}/external-sources: empty + supported toolkit list
- POST /api/listings/{lid}/external-sources: create pending source (Google Drive)
- POST with unknown source_kind → 422
- POST /external-sources/{sid}/poll on pending → swallow + return current
- POST /external-sources/{sid}/sync on pending → 400 (not active)
- DELETE /external-sources/{sid} → soft-delete, removed from GET
- Wipe-on-close hook: PATCH status=closed → mirrored staged file + source soft-deleted
- RBAC: buyer POST → 403/404
- RBAC: editor collaborator POST → 200
"""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
API = f"{BASE_URL}/api"

SUPPORTED_KINDS = {"googledrive", "onedrive", "sharepoint", "dropbox", "box", "zohoworkdrive"}


# ---- Auth helpers --------------------------------------------------------- #
def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def mira_token():
    return _login("mira@workz.example.com", "WorkzPass123!")


@pytest.fixture(scope="module")
def alex_token():
    return _login("alex@workz.example.com", "WorkzPass123!")


@pytest.fixture(scope="module")
def mira_listing_id(mira_token):
    """Return an editable listing owned by Mira (don't mutate it across tests)."""
    r = requests.get(f"{API}/listings", headers={"Authorization": f"Bearer {mira_token}"})
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert items, "Mira should have at least one listing"
    return items[0]["id"]


def _create_fresh_listing(token: str) -> str:
    """Create a throwaway listing for destructive tests (close / wipe)."""
    body = {
        "company_name": f"TEST_ExtSrc_{uuid.uuid4().hex[:8]}",
        "sector": "saas",
        "geography": "us",
        "asking_price_usd_m": 10.0,
        "revenue_usd_m": 5.0,
        "ebitda_usd_m": 1.0,
        "employees": 25,
        "headline": "Test listing for external sources wipe hook",
        "summary": "Synthetic listing created by pytest test_external_sources.py",
        "highlights": ["test"],
        "status": "draft",
    }
    r = requests.post(f"{API}/listings", json=body, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), f"create listing {r.status_code}: {r.text[:200]}"
    return r.json()["id"]


# ---- Tests: GET supported list ------------------------------------------- #
class TestListExternalSources:
    def test_get_returns_supported_six(self, mira_token, mira_listing_id):
        r = requests.get(
            f"{API}/listings/{mira_listing_id}/external-sources",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sources" in data and isinstance(data["sources"], list)
        assert "supported" in data
        kinds = {s["kind"] for s in data["supported"]}
        assert kinds == SUPPORTED_KINDS, f"expected exactly 6 toolkits, got {kinds}"
        # Each entry must have a human label
        for s in data["supported"]:
            assert isinstance(s.get("label"), str) and s["label"]


# ---- Tests: POST create source ------------------------------------------- #
class TestCreateExternalSource:
    def test_create_googledrive_pending(self, mira_token, mira_listing_id):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "googledrive"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 200, r.text
        src = r.json()
        assert src["status"] == "pending"
        assert src["source_kind"] == "googledrive"
        assert src["entity_id"] == f"nextcapos-{_user_id(mira_token)}-{mira_listing_id}"
        assert src["redirect_url"] and isinstance(src["redirect_url"], str)
        assert "id" in src and src["id"]
        sid = src["id"]

        # Also reflected in legacy /composio/connections
        r2 = requests.get(
            f"{API}/composio/connections",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        if r2.status_code == 200:
            conns = r2.json() if isinstance(r2.json(), list) else r2.json().get("connections", [])
            assert any(c.get("id") == sid for c in conns), "composio_connections should contain the new sid"

        # cleanup
        requests.delete(
            f"{API}/listings/{mira_listing_id}/external-sources/{sid}",
            headers={"Authorization": f"Bearer {mira_token}"},
        )

    def test_create_unknown_kind_returns_422(self, mira_token, mira_listing_id):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "megaupload"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 422, f"expected 422 for invalid kind, got {r.status_code}: {r.text[:200]}"


def _user_id(token: str) -> str:
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    return r.json()["id"]


# ---- Tests: poll / sync / delete on a pending source --------------------- #
class TestPendingSourceLifecycle:
    @pytest.fixture()
    def pending_sid(self, mira_token, mira_listing_id):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "dropbox"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        yield sid
        # best-effort cleanup
        requests.delete(
            f"{API}/listings/{mira_listing_id}/external-sources/{sid}",
            headers={"Authorization": f"Bearer {mira_token}"},
        )

    def test_poll_pending_returns_pending(self, mira_token, mira_listing_id, pending_sid):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources/{pending_sid}/poll",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "pending", f"expected pending, got {body}"

    def test_sync_pending_returns_400(self, mira_token, mira_listing_id, pending_sid):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources/{pending_sid}/sync",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "pending" in detail.lower() and "active" in detail.lower(), detail

    def test_delete_pending_soft_deletes(self, mira_token, mira_listing_id):
        # Fresh source, not using shared fixture (we want full delete control)
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "box"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        sid = r.json()["id"]

        rd = requests.delete(
            f"{API}/listings/{mira_listing_id}/external-sources/{sid}",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert rd.status_code == 200, rd.text
        assert rd.json().get("ok") is True

        # Confirm it doesn't appear in GET
        rg = requests.get(
            f"{API}/listings/{mira_listing_id}/external-sources",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        ids = [s["id"] for s in rg.json()["sources"]]
        assert sid not in ids, "soft-deleted source should not be listed"


# ---- Tests: wipe-on-close hook ------------------------------------------- #
class TestWipeOnClose:
    def test_patch_to_closed_wipes_sources_and_files(self, mira_token):
        lid = _create_fresh_listing(mira_token)
        # Connect a fake source
        r = requests.post(
            f"{API}/listings/{lid}/external-sources",
            json={"source_kind": "onedrive"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert r.status_code == 200
        sid = r.json()["id"]

        # Manually insert a fake staged file pretending it was mirrored.
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        fake_fid = str(uuid.uuid4())
        db.listing_staged_files.insert_one({
            "id": fake_fid,
            "listing_id": lid,
            "filename": "TEST_mirrored.pdf",
            "folder": "other",
            "content_type": "application/pdf",
            "size_bytes": 10,
            "uploaded_at": "2026-01-01T00:00:00Z",
            "uploaded_by": _user_id(mira_token),
            "source": {"kind": "onedrive", "sid": sid, "external_id": "fakeext"},
        })

        # PATCH listing status → closed
        patch_body = {
            "company_name": f"TEST_ExtSrc_close_{uuid.uuid4().hex[:6]}",
            "sector": "saas",
            "geography": "us",
            "asking_price_usd_m": 10.0,
            "headline": "closing",
            "summary": "closing",
            "highlights": [],
            "status": "closed",
        }
        rp = requests.patch(
            f"{API}/listings/{lid}",
            json=patch_body,
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert rp.status_code == 200, rp.text

        # Allow async cleanup a tick
        time.sleep(0.5)

        staged = db.listing_staged_files.find_one({"id": fake_fid})
        assert staged is not None
        assert staged.get("deleted_at"), f"staged file should be soft-deleted, got {staged}"

        src_doc = db.listing_external_sources.find_one({"id": sid})
        assert src_doc is not None
        assert src_doc.get("deleted_at"), f"source should be soft-deleted, got {src_doc}"

        # cleanup
        requests.delete(f"{API}/listings/{lid}", headers={"Authorization": f"Bearer {mira_token}"})
        client.close()


# ---- Tests: RBAC --------------------------------------------------------- #
class TestRBAC:
    def test_buyer_cannot_post_external_source(self, alex_token, mira_listing_id):
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "googledrive"},
            headers={"Authorization": f"Bearer {alex_token}"},
        )
        assert r.status_code in (403, 404), f"buyer should be blocked, got {r.status_code}: {r.text[:200]}"

    def test_editor_collaborator_can_post(self, mira_token, mira_listing_id):
        # Invite a fresh editor via the collab → register fast-path
        editor_email = f"TEST_ext_editor_{uuid.uuid4().hex[:8]}@workz.example.com"
        ri = requests.post(
            f"{API}/listings/{mira_listing_id}/collaborators",
            json={"email": editor_email, "role": "editor"},
            headers={"Authorization": f"Bearer {mira_token}"},
        )
        assert ri.status_code == 200, ri.text
        token = ri.json().get("token")
        assert token

        # Register with listing_invite_token fast-path
        rr = requests.post(
            f"{API}/auth/register",
            json={
                "email": editor_email,
                "password": "TestPass123!",
                "name": "Test Editor",
                "role": "buyer",
                "listing_invite_token": token,
            },
        )
        assert rr.status_code in (200, 201), rr.text
        editor_jwt = rr.json().get("token") or rr.json().get("access_token")
        assert editor_jwt, f"register response missing token: {rr.text[:200]}"

        # Editor POSTs external-source → should succeed
        rp = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json={"source_kind": "sharepoint"},
            headers={"Authorization": f"Bearer {editor_jwt}"},
        )
        assert rp.status_code == 200, f"editor should be allowed, got {rp.status_code}: {rp.text[:200]}"
        sid = rp.json()["id"]
        # cleanup
        requests.delete(
            f"{API}/listings/{mira_listing_id}/external-sources/{sid}",
            headers={"Authorization": f"Bearer {mira_token}"},
        )
