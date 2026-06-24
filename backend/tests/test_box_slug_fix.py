"""
Regression test for the Box external-source slug fix.

Bug: COMPOSIO_FILE_SOURCES['box']['list'] used to be BOX_LIST_FILES, which
returns 404 Tool_ToolNotFound from Composio v3. The correct slug is
BOX_LIST_ITEMS_IN_FOLDER (requires `folder_id`, '0' = root).

We verify:
1. The dict in server.py uses BOX_LIST_ITEMS_IN_FOLDER (and other 4
   providers still use their original slugs).
2. End-to-end the sync code resolves the new slug at Composio — i.e. on a
   listing source flipped to active with a *bogus* connected_account_id,
   the last_error mentions ConnectedAccount (1810), NOT Tool_ToolNotFound
   nor BOX_LIST_FILES.
3. Code paths added alongside the fix: Box default folder_id='0' and
   non-file entries skipped (inspected statically — exercising them E2E
   requires real Box OAuth).
"""
import os
import re
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
API = f"{BASE_URL}/api"

SERVER_PY = "/app/backend/server.py"


# ---- helpers --------------------------------------------------------------- #
def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def mira_token():
    return _login("mira@workz.example.com", "WorkzPass123!")


@pytest.fixture(scope="module")
def mira_listing_id(mira_token):
    r = requests.get(f"{API}/listings", headers={"Authorization": f"Bearer {mira_token}"})
    assert r.status_code == 200, r.text[:200]
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert items, "Mira should have at least one listing"
    return items[0]["id"]


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# ---- Static / source code checks ------------------------------------------- #
class TestComposioSlugs:
    """Verify COMPOSIO_FILE_SOURCES dict in server.py."""

    @pytest.fixture(scope="class")
    def server_src(self):
        with open(SERVER_PY) as f:
            return f.read()

    def _extract_block(self, server_src):
        """Return only the COMPOSIO_FILE_SOURCES = { ... } dict literal."""
        start = server_src.index("COMPOSIO_FILE_SOURCES")
        # Find the opening brace.
        brace_open = server_src.index("{", start)
        depth = 0
        i = brace_open
        while i < len(server_src):
            if server_src[i] == "{":
                depth += 1
            elif server_src[i] == "}":
                depth -= 1
                if depth == 0:
                    return server_src[start:i + 1]
            i += 1
        raise AssertionError("could not bracket-match COMPOSIO_FILE_SOURCES dict")

    def test_box_uses_list_items_in_folder(self, server_src):
        """Box list slug must be BOX_LIST_ITEMS_IN_FOLDER."""
        block = self._extract_block(server_src)
        # Box must use new slug.
        assert "BOX_LIST_ITEMS_IN_FOLDER" in block, \
            "Box list slug not updated to BOX_LIST_ITEMS_IN_FOLDER"
        # Old slug must be gone. Use regex word boundary because DROPBOX_LIST_FILES
        # naturally contains "BOX_LIST_FILES" as a tail substring.
        assert not re.search(r"\bBOX_LIST_FILES\b", block), \
            "Old BOX_LIST_FILES slug still present in COMPOSIO_FILE_SOURCES"

    def test_other_providers_unchanged(self, server_src):
        """Other providers still use original slugs."""
        block = self._extract_block(server_src)
        for slug in (
            "GOOGLEDRIVE_LIST_FILES",
            "ONE_DRIVE_LIST_FILES",
            "SHARE_POINT_LIST_FILES",
            "DROPBOX_LIST_FILES",
            "BOX_DOWNLOAD_FILE",
        ):
            assert slug in block, f"Expected slug {slug} missing"

    def test_box_default_folder_id_zero(self, server_src):
        """The Box default folder_id='0' branch is present."""
        # Look for the canonical comment + the assignment.
        assert re.search(
            r"source_kind.{0,20}==.{0,5}['\"]box['\"][^\n]*\n[^\n]*folder_key.{0,40}=.{0,10}['\"]0['\"]",
            server_src,
        ), "Box default folder_id='0' branch not found"

    def test_non_file_entries_skipped(self, server_src):
        """The folders/web_links filter in the entries loop is present."""
        # Match either an `is_file` or `type != 'file'` style filter near the loop.
        assert re.search(
            r"ftype\s*=\s*\(f\.get\(['\"]type['\"]\)[^)]*\)\.lower\(\)",
            server_src,
        ), "Non-file entry filter not found in _run_external_source_sync"
        assert re.search(
            r"if\s+ftype\s+and\s+ftype\s*!=\s*['\"]file['\"]\s*:\s*\n\s*continue",
            server_src,
        ), "Non-file `continue` branch not found"


# ---- End-to-end: bogus connected_account_id sync probe --------------------- #
class TestBoxSyncSlugResolves:
    """Create a Box source, flip it active with a fake connected_id,
    trigger sync, and verify the error proves the slug now resolves at
    Composio (i.e. error is ConnectedAccount-related, not Tool not found)."""

    SOURCE_ID = None  # captured across test methods

    def test_create_box_source_then_sync_resolves_slug(self, mira_token, mira_listing_id, mongo_db):
        headers = {"Authorization": f"Bearer {mira_token}"}

        # 1. Create a Box source.
        body = {"source_kind": "box", "folder_id": None, "label": f"TEST_box_{uuid.uuid4().hex[:6]}"}
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources",
            json=body, headers=headers,
        )
        assert r.status_code == 200, f"create source: {r.status_code} {r.text[:300]}"
        src = r.json()
        sid = src.get("id") or src.get("source", {}).get("id")
        assert sid, f"no source id in response: {src}"
        TestBoxSyncSlugResolves.SOURCE_ID = sid

        # 2. Hand-flip status='active' + fake connected_account_id in Mongo.
        fake_cid = f"ca_bogus_{uuid.uuid4().hex[:12]}"
        upd = mongo_db.listing_external_sources.update_one(
            {"id": sid},
            {"$set": {
                "status": "active",
                "composio_connected_id": fake_cid,
                "entity_id": f"nextcapos-bogus-{uuid.uuid4().hex[:6]}",
            }},
        )
        assert upd.matched_count == 1, "couldn't find source in Mongo to flip"

        # 3. Kick off the sync.
        r = requests.post(
            f"{API}/listings/{mira_listing_id}/external-sources/{sid}/sync",
            headers=headers,
        )
        assert r.status_code == 200, f"sync trigger: {r.status_code} {r.text[:300]}"
        assert r.json().get("started") is True

        # 4. Poll until syncing flips back to False (background task done).
        deadline = time.time() + 30
        last_doc = None
        while time.time() < deadline:
            doc = mongo_db.listing_external_sources.find_one({"id": sid})
            last_doc = doc
            if doc and not doc.get("syncing"):
                break
            time.sleep(1)
        assert last_doc is not None, "source vanished from mongo"
        assert not last_doc.get("syncing"), f"sync still in progress after 30s: {last_doc}"

        last_error = (last_doc.get("last_error") or "")
        print(f"\n[Box sync probe] last_error: {last_error!r}")

        # 5. Critical assertions:
        # (a) The OLD failure mode (404 Tool_ToolNotFound / BOX_LIST_FILES)
        #     must be gone — that proves the slug was updated AND Composio
        #     accepts the new slug.
        assert "Tool_ToolNotFound" not in last_error, \
            f"slug still 404s at Composio — last_error: {last_error}"
        assert "BOX_LIST_FILES" not in last_error, \
            f"old slug name leaked into error — last_error: {last_error}"
        # (b) Some error MUST exist (we passed a bogus connection id).
        assert last_error, "expected a list-failure error with bogus connected_id, got none"
        # (c) The error should reference ConnectedAccount (code 1810) OR
        #     equivalent auth-resolution failure, which proves Composio got
        #     past the tool lookup and choked only on our fake creds.
        good_signals = [
            "ConnectedAccount",
            "ConnectedAccountNotFound",
            "1810",
            "connected_account",
            "Connected account",
        ]
        assert any(s in last_error for s in good_signals), (
            f"expected a ConnectedAccount-related error proving the Box slug resolved; "
            f"got: {last_error!r}"
        )

    def test_cleanup_box_source(self, mongo_db):
        """Hard-delete the throwaway source we created. Don't rely on the
        DELETE endpoint since it tries to revoke at Composio first."""
        sid = TestBoxSyncSlugResolves.SOURCE_ID
        if not sid:
            pytest.skip("no source to clean")
        mongo_db.listing_external_sources.delete_one({"id": sid})
        assert mongo_db.listing_external_sources.find_one({"id": sid}) is None
