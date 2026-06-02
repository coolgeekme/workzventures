"""Backend tests for the listing-level pre-stage data room + auto-clone on Vault open.

Covers:
- GET/POST/DELETE /api/listings/{lid}/staged-files (+ download)
- AES-256-GCM encryption at rest (response shape + decryption round trip)
- Authorization: only seller/admin can read/write; buyer gets 403
- Vault auto-clone via POST /api/inquiries/{iid}/open-room
- Audit log entries: listing.stagedfile.*, dealroom.open (cloned_staged_files count)
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
    # read from /app/frontend/.env
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
ADMIN = ("admin@workz.example.com", "WorkzAdmin123!")


# ---- helpers ---------------------------------------------------------------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def seller_tok():
    return _login(*SELLER)


@pytest.fixture(scope="session")
def buyer_tok():
    return _login(*BUYER)


@pytest.fixture(scope="session")
def admin_tok():
    return _login(*ADMIN)


@pytest.fixture(scope="session")
def vertex_listing_id(seller_tok):
    # Cleanest unpolluted listing per main agent context
    r = requests.get(f"{API}/listings", headers=_hdr(seller_tok), timeout=30)
    assert r.status_code == 200
    listings = r.json()
    # try the documented uuid first
    target = "fa271f52-9aa7-4c1f-9c93-d39e6ec5cb40"
    if any(l["id"] == target for l in listings):
        return target
    # fallback: pick the one whose company_name contains "Vertex"
    for l in listings:
        if "vertex" in l.get("company_name", "").lower():
            return l["id"]
    pytest.skip("Vertex Climate listing not found on Mira's account")


@pytest.fixture(scope="session")
def helios_listing_id(seller_tok):
    r = requests.get(f"{API}/listings", headers=_hdr(seller_tok), timeout=30)
    assert r.status_code == 200
    for l in r.json():
        if "helios" in l.get("company_name", "").lower():
            return l["id"]
    pytest.skip("Helios MedTech listing not found")


# ---- staged-files CRUD -----------------------------------------------------
class TestListingStagedFiles:
    def test_list_initial(self, seller_tok, vertex_listing_id):
        r = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files",
                         headers=_hdr(seller_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_buyer_forbidden_to_list(self, buyer_tok, vertex_listing_id):
        r = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files",
                         headers=_hdr(buyer_tok), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_upload_round_trip(self, seller_tok, vertex_listing_id):
        body = b"TEST_dataroom financials Q4 2025\nLine 2\nLine 3\n"
        sha = hashlib.sha256(body).hexdigest()
        files = {"file": ("TEST_financials.txt", io.BytesIO(body), "text/plain")}
        data = {"folder": "financials", "note": "TEST_iter13"}
        r = requests.post(f"{API}/listings/{vertex_listing_id}/staged-files/binary",
                          files=files, data=data, headers=_hdr(seller_tok), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        # response shape
        assert d.get("encrypted") is True
        assert d.get("encryption_alg") == "AES-256-GCM"
        assert d.get("sha256_hex") == sha
        assert d.get("folder") == "financials"
        assert d.get("size_bytes") == len(body)
        assert "_id" not in d
        assert "content" not in d
        assert "pages" not in d
        fid = d["id"]

        # appears in list
        r2 = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files",
                          headers=_hdr(seller_tok), timeout=30)
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json()]
        assert fid in ids

        # download returns original bytes
        r3 = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files/{fid}/download",
                          headers=_hdr(seller_tok), timeout=30)
        assert r3.status_code == 200
        assert r3.content == body
        assert hashlib.sha256(r3.content).hexdigest() == sha

        # buyer cannot download
        r4 = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files/{fid}/download",
                          headers=_hdr(_login(*BUYER)), timeout=30)
        assert r4.status_code == 403

        # delete
        r5 = requests.delete(f"{API}/listings/{vertex_listing_id}/staged-files/{fid}",
                             headers=_hdr(seller_tok), timeout=30)
        assert r5.status_code == 200

        # gone from list
        r6 = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files",
                         headers=_hdr(seller_tok), timeout=30)
        assert fid not in [x["id"] for x in r6.json()]

        # download → 404
        r7 = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files/{fid}/download",
                          headers=_hdr(seller_tok), timeout=30)
        assert r7.status_code == 404

    def test_unknown_folder_coerced_to_other(self, seller_tok, vertex_listing_id):
        files = {"file": ("TEST_weird.txt", io.BytesIO(b"x"), "text/plain")}
        data = {"folder": "marketing-deck"}
        r = requests.post(f"{API}/listings/{vertex_listing_id}/staged-files/binary",
                          files=files, data=data, headers=_hdr(seller_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["folder"] == "other"
        # cleanup
        requests.delete(
            f"{API}/listings/{vertex_listing_id}/staged-files/{r.json()['id']}",
            headers=_hdr(seller_tok), timeout=30,
        )

    def test_empty_file_400(self, seller_tok, vertex_listing_id):
        files = {"file": ("TEST_empty.txt", io.BytesIO(b""), "text/plain")}
        r = requests.post(f"{API}/listings/{vertex_listing_id}/staged-files/binary",
                          files=files, headers=_hdr(seller_tok), timeout=30)
        assert r.status_code == 400, r.text

    def test_oversize_413(self, seller_tok, vertex_listing_id):
        # 25MB+1
        big = b"\0" * (25 * 1024 * 1024 + 1)
        files = {"file": ("TEST_big.bin", io.BytesIO(big), "application/octet-stream")}
        r = requests.post(f"{API}/listings/{vertex_listing_id}/staged-files/binary",
                          files=files, headers=_hdr(seller_tok), timeout=120)
        assert r.status_code == 413, f"got {r.status_code}: {r.text[:200]}"

    def test_buyer_cannot_upload(self, buyer_tok, vertex_listing_id):
        files = {"file": ("TEST_buyer.txt", io.BytesIO(b"nope"), "text/plain")}
        r = requests.post(f"{API}/listings/{vertex_listing_id}/staged-files/binary",
                          files=files, headers=_hdr(buyer_tok), timeout=30)
        assert r.status_code == 403, r.text

    def test_admin_can_list(self, admin_tok, vertex_listing_id):
        r = requests.get(f"{API}/listings/{vertex_listing_id}/staged-files",
                         headers=_hdr(admin_tok), timeout=30)
        assert r.status_code == 200


# ---- auto-clone on Vault open ---------------------------------------------
class TestVaultAutoClone:
    def test_clone_into_vault(self, seller_tok, buyer_tok, helios_listing_id):
        # 1) stage 2 files (different folders) on Helios
        f1 = b"TEST_clone financials body\n" * 5
        f2 = b"TEST_clone legal body\n" * 5
        sha1 = hashlib.sha256(f1).hexdigest()
        sha2 = hashlib.sha256(f2).hexdigest()
        u1 = requests.post(f"{API}/listings/{helios_listing_id}/staged-files/binary",
                           files={"file": ("TEST_clone_fin.txt", io.BytesIO(f1), "text/plain")},
                           data={"folder": "financials"},
                           headers=_hdr(seller_tok), timeout=60)
        u2 = requests.post(f"{API}/listings/{helios_listing_id}/staged-files/binary",
                           files={"file": ("TEST_clone_legal.txt", io.BytesIO(f2), "text/plain")},
                           data={"folder": "legal"},
                           headers=_hdr(seller_tok), timeout=60)
        assert u1.status_code == 200 and u2.status_code == 200, (u1.text, u2.text)
        fid1, fid2 = u1.json()["id"], u2.json()["id"]

        # 2) buyer creates inquiry
        inq = requests.post(f"{API}/marketplace/{helios_listing_id}/inquire",
                            json={"message": "TEST_iter13 clone flow"},
                            headers=_hdr(buyer_tok), timeout=30)
        assert inq.status_code == 200, inq.text
        iid = inq.json()["id"]

        # 3) seller must engage the inquiry first
        eng = requests.patch(f"{API}/inquiries/{iid}/status",
                             json={"status": "engaged"},
                             headers=_hdr(seller_tok), timeout=30)
        assert eng.status_code in (200, 204), f"engage failed: {eng.status_code} {eng.text}"

        # 4) seller opens vault
        opn = requests.post(f"{API}/inquiries/{iid}/open-room",
                            headers=_hdr(seller_tok), timeout=60)
        assert opn.status_code == 200, opn.text
        room = opn.json()
        rid = room["id"]

        # 5) GET vault → files contain both staged clones
        rd = requests.get(f"{API}/deal-rooms/{rid}", headers=_hdr(seller_tok), timeout=30)
        assert rd.status_code == 200, rd.text
        detail = rd.json()
        files = detail.get("files") or []
        cloned = [f for f in files if f.get("cloned_from_listing_file") in (fid1, fid2)]
        assert len(cloned) == 2, f"expected 2 cloned files, got {len(cloned)}: {files}"
        for cf in cloned:
            assert cf.get("encrypted") is True
            assert cf.get("encryption_alg") == "AES-256-GCM"
            assert cf.get("cloned_from_listing_file") in (fid1, fid2)

        # 6) buyer signs NDA then downloads cloned files → identical plaintext
        nda = requests.post(f"{API}/deal-rooms/{rid}/accept-nda",
                            json={"signed_name": "Alex Cascade"},
                            headers=_hdr(buyer_tok), timeout=30)
        assert nda.status_code in (200, 204), f"accept-nda failed: {nda.status_code} {nda.text}"

        expected = {fid1: (f1, sha1), fid2: (f2, sha2)}
        for cf in cloned:
            src_id = cf["cloned_from_listing_file"]
            body, sha = expected[src_id]
            dl = requests.get(f"{API}/deal-rooms/{rid}/files/{cf['id']}/download",
                              headers=_hdr(buyer_tok), timeout=30)
            assert dl.status_code == 200, f"buyer download failed: {dl.status_code} {dl.text}"
            assert dl.content == body, "cloned file plaintext mismatch"
            assert hashlib.sha256(dl.content).hexdigest() == sha

        # 7) Audit logs (admin endpoint)
        adm = _login(*ADMIN)
        a = requests.get(f"{API}/audit/logs", headers=_hdr(adm), timeout=30)
        assert a.status_code == 200, f"audit log fetch: {a.status_code} {a.text[:200]}"
        events = a.json() if isinstance(a.json(), list) else a.json().get("items", [])
        actions = [e.get("action") for e in events]
        assert "listing.stagedfile.upload" in actions
        assert "dealroom.open" in actions
        # check cloned_staged_files metadata on a dealroom.open event for this room
        opens = [e for e in events if e.get("action") == "dealroom.open" and (e.get("target") == rid or e.get("target_id") == rid)]
        assert opens, "no dealroom.open audit row for this room"
        meta = opens[0].get("meta") or opens[0].get("metadata") or {}
        assert meta.get("cloned_staged_files", 0) >= 2, f"meta: {meta}"

        # cleanup staged
        for fid in (fid1, fid2):
            requests.delete(f"{API}/listings/{helios_listing_id}/staged-files/{fid}",
                            headers=_hdr(seller_tok), timeout=30)
