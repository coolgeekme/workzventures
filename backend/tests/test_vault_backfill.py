"""Backend tests for late-arriving staged file backfill into already-opened Vaults.

Regression for iter-21 P0 bug: external-source synced files (Google Drive,
SharePoint, etc.) were not visible inside Vaults that had already been opened
before the sync ran. The fix introduces an idempotent `only_missing` clone
backfill triggered (a) at the end of `_run_external_source_sync`,
(b) on every `GET /deal-rooms/{rid}` (self-heal), and (c) on every Copilot
question so the AI context window picks up newly-synced docs.

This test covers the staged-file-uploaded-after-vault-open path because we
can't actually hit Composio in CI. The clone logic is identical for manual
uploads and external-source mirrors — both write to `listing_staged_files`
with the same shape.
"""

import io
import os
import hashlib
import pytest
import requests


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
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
def fresh_listing_id(seller_tok):
    # Create a fresh listing so the test doesn't tangle with seeded data.
    payload = {
        "company_name": "Backfill Test Co",
        "sector": "saas",
        "geography": "us",
        "headline": "Backfill regression target",
        "summary": "Iter-21 vault backfill regression target.",
        "asking_price_usd_m": 5.0,
        "revenue_usd_m": 3.0,
        "ebitda_usd_m": 0.4,
        "employees": 25,
        "highlights": ["regression"],
        "status": "live",
    }
    r = requests.post(f"{API}/listings", json=payload, headers=_hdr(seller_tok), timeout=30)
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    yield lid
    requests.delete(f"{API}/listings/{lid}", headers=_hdr(seller_tok), timeout=30)


def _open_vault(seller_tok, buyer_tok, lid):
    """Create inquiry → engage → open-room. Returns (rid, iid)."""
    inq = requests.post(f"{API}/marketplace/{lid}/inquire",
                        json={"message": "TEST_iter21 backfill flow"},
                        headers=_hdr(buyer_tok), timeout=30)
    assert inq.status_code == 200, inq.text
    iid = inq.json()["id"]
    eng = requests.patch(f"{API}/inquiries/{iid}/status",
                         json={"status": "engaged"},
                         headers=_hdr(seller_tok), timeout=30)
    assert eng.status_code in (200, 204), eng.text
    opn = requests.post(f"{API}/inquiries/{iid}/open-room",
                        headers=_hdr(seller_tok), timeout=60)
    assert opn.status_code == 200, opn.text
    return opn.json()["id"], iid


class TestVaultBackfill:
    def test_staged_file_added_after_open_appears_in_vault(self, seller_tok, buyer_tok, fresh_listing_id):
        """Upload a staged file BEFORE opening vault, then ANOTHER one AFTER, and
        confirm both end up cloned into the room — the second one via backfill."""
        # Pre-open staged file (clones eagerly at open-room)
        pre_body = b"TEST pre-open staged content\n" * 20
        u1 = requests.post(
            f"{API}/listings/{fresh_listing_id}/staged-files/binary",
            files={"file": ("TEST_pre.txt", io.BytesIO(pre_body), "text/plain")},
            data={"folder": "financials"},
            headers=_hdr(seller_tok), timeout=60,
        )
        assert u1.status_code == 200, u1.text
        pre_fid = u1.json()["id"]

        # Open the Vault
        rid, _ = _open_vault(seller_tok, buyer_tok, fresh_listing_id)

        # Sanity: pre-open file is cloned at open
        rd1 = requests.get(f"{API}/deal-rooms/{rid}", headers=_hdr(seller_tok), timeout=30)
        assert rd1.status_code == 200
        clones1 = {f.get("cloned_from_listing_file") for f in rd1.json().get("files", [])}
        assert pre_fid in clones1, f"pre-open file should clone at open-room: {clones1}"

        # Now upload a NEW staged file AFTER the vault is already open
        post_body = b"TEST post-open staged content (this should backfill)\n" * 20
        post_sha = hashlib.sha256(post_body).hexdigest()
        u2 = requests.post(
            f"{API}/listings/{fresh_listing_id}/staged-files/binary",
            files={"file": ("TEST_post.txt", io.BytesIO(post_body), "text/plain")},
            data={"folder": "legal"},
            headers=_hdr(seller_tok), timeout=60,
        )
        assert u2.status_code == 200, u2.text
        post_fid = u2.json()["id"]

        # GET vault → backfill clones the post-open file
        rd2 = requests.get(f"{API}/deal-rooms/{rid}", headers=_hdr(seller_tok), timeout=30)
        assert rd2.status_code == 200
        files2 = rd2.json().get("files", [])
        clones2 = {f.get("cloned_from_listing_file"): f for f in files2}
        assert post_fid in clones2, f"post-open staged file should backfill into vault: {list(clones2.keys())}"
        # And pre-open is still there (no duplicates)
        assert pre_fid in clones2
        pre_count = sum(1 for f in files2 if f.get("cloned_from_listing_file") == pre_fid)
        post_count = sum(1 for f in files2 if f.get("cloned_from_listing_file") == post_fid)
        assert pre_count == 1, f"pre-open file should not duplicate: count={pre_count}"
        assert post_count == 1, f"post-open file should not duplicate: count={post_count}"

        # Backfilled file should be properly encrypted with vault AAD; buyer can NDA + download
        nda = requests.post(f"{API}/deal-rooms/{rid}/accept-nda",
                            json={"signed_name": "Alex Cascade"},
                            headers=_hdr(buyer_tok), timeout=30)
        assert nda.status_code in (200, 204), nda.text

        post_clone = clones2[post_fid]
        dl = requests.get(f"{API}/deal-rooms/{rid}/files/{post_clone['id']}/download",
                          headers=_hdr(buyer_tok), timeout=30)
        assert dl.status_code == 200, dl.text
        assert dl.content == post_body, "backfilled file plaintext mismatch"
        assert hashlib.sha256(dl.content).hexdigest() == post_sha

    def test_backfill_is_idempotent(self, seller_tok, buyer_tok, fresh_listing_id):
        """Repeated GET /deal-rooms/{rid} must not duplicate clones."""
        # Open a fresh vault for this listing — open-room is idempotent so re-uses the existing one
        # We'll just hit GET twice and count clones.
        # First ensure there is at least one inquiry+room
        inq = requests.post(f"{API}/marketplace/{fresh_listing_id}/inquire",
                            json={"message": "TEST idempotency check"},
                            headers=_hdr(buyer_tok), timeout=30)
        # If buyer already has an inquiry the endpoint returns 200 + existing
        assert inq.status_code in (200, 409), inq.text
        # find any active/pending room for this listing
        rooms = requests.get(f"{API}/deal-rooms", headers=_hdr(seller_tok), timeout=30).json()
        target = next((r for r in rooms if r.get("listing_id") == fresh_listing_id), None)
        assert target, "no deal room for fresh listing"
        rid = target["id"]

        before = requests.get(f"{API}/deal-rooms/{rid}", headers=_hdr(seller_tok), timeout=30).json()
        files_before = before.get("files", [])
        after = requests.get(f"{API}/deal-rooms/{rid}", headers=_hdr(seller_tok), timeout=30).json()
        files_after = after.get("files", [])
        # Backfill is a no-op when there's nothing new to clone, so counts should match.
        ids_before = sorted(f["id"] for f in files_before)
        ids_after = sorted(f["id"] for f in files_after)
        assert ids_before == ids_after, f"repeated GET created duplicate clones: {ids_before} vs {ids_after}"
