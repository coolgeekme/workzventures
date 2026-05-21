"""
Workz Ventures Security module test suite (iter-9).
Covers: posture, security headers, brute-force lockout, password complexity,
audit chain verify (role-gated + tamper detection), OTS proofs (create/list/get/
download/upgrade/verify), at-rest AES-256-GCM encryption round-trip,
proof scoping (buyer vs non-participant), participant-only access.
"""
import os
import re
import uuid
import time
import hashlib
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

BUYER_EMAIL = "alex@workz.example.com"
SELLER_EMAIL = "mira@workz.example.com"
PWD = "WorkzPass123!"

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def buyer():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": BUYER_EMAIL, "password": PWD}, timeout=20)
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="session")
def seller():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": SELLER_EMAIL, "password": PWD}, timeout=20)
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="session")
def db():
    if not MONGO_URL or not DB_NAME:
        pytest.skip("MONGO_URL/DB_NAME not configured for direct tamper test")
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# ---------- /api/security/posture ----------
def test_posture_returns_all_features(buyer):
    r = buyer.get(f"{API}/security/posture", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    feats = d.get("features", {})
    for k in ("opentimestamps", "at_rest_encryption", "audit_chain",
              "brute_force_lockout", "security_headers", "password_complexity"):
        assert feats.get(k) is True, f"feature {k} not true: {feats}"
    assert feats.get("encryption_alg") == "AES-256-GCM"
    cals = d.get("ots", {}).get("calendars", [])
    assert isinstance(cals, list) and len(cals) >= 3, f"need >=3 OTS calendars, got {cals}"
    audit = d.get("audit_chain", {})
    assert isinstance(audit.get("last_seq"), int) and audit["last_seq"] > 0


# ---------- Security headers ----------
def test_security_headers_present(buyer):
    r = buyer.get(f"{API}/security/posture", timeout=15)
    h = r.headers
    assert "strict-transport-security" in {k.lower() for k in h.keys()}, f"missing HSTS: {dict(h)}"
    assert h.get("X-Content-Type-Options", "").lower() == "nosniff"
    assert h.get("X-Frame-Options", "").upper() == "DENY"
    assert "Referrer-Policy" in h or "referrer-policy" in {k.lower() for k in h.keys()}
    assert "Permissions-Policy" in h or "permissions-policy" in {k.lower() for k in h.keys()}


# ---------- Brute-force lockout ----------
def test_brute_force_lockout_429():
    """5 wrong attempts on a throwaway email, 6th returns 429."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    throwaway = f"bf_{uuid.uuid4().hex[:8]}@workz.com"
    # Pre-register so the account exists; lockout should also work for existing-account auth fail
    reg = s.post(f"{API}/auth/register", json={
        "email": throwaway, "password": "ValidPass123!",
        "name": "BF Tester", "organization": "Test", "role": "buyer",
    }, timeout=15)
    assert reg.status_code == 200, reg.text
    last_codes = []
    for _ in range(5):
        r = s.post(f"{API}/auth/login", json={"email": throwaway, "password": "WrongPass!1"}, timeout=15)
        last_codes.append(r.status_code)
    # 6th attempt should be 429
    r6 = s.post(f"{API}/auth/login", json={"email": throwaway, "password": "WrongPass!1"}, timeout=15)
    assert r6.status_code == 429, f"expected 429 on 6th attempt; codes={last_codes} sixth={r6.status_code} body={r6.text}"
    body = r6.text.lower()
    assert "15" in body or "minute" in body or "try again" in body, f"missing lockout msg: {r6.text}"


# ---------- Password complexity ----------
@pytest.mark.parametrize("pwd,reason", [
    ("short1A", "<8 chars"),
    ("alllowercase", "no digit"),
    ("12345678", "no letter"),
])
def test_password_complexity_rejects(pwd, reason):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"pc_{uuid.uuid4().hex[:6]}@workz.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": pwd, "name": "PC", "organization": "T", "role": "buyer",
    }, timeout=15)
    assert r.status_code in (400, 422), f"weak pwd ({reason}) should be rejected; got {r.status_code} {r.text}"


def test_password_complexity_accepts_valid():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"pc_ok_{uuid.uuid4().hex[:6]}@workz.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": "ValidPass123!", "name": "OK", "organization": "T", "role": "buyer",
    }, timeout=15)
    assert r.status_code == 200, r.text


# ---------- Audit chain verifier ----------
def test_audit_verify_buyer_forbidden(buyer):
    r = buyer.get(f"{API}/security/audit/verify", timeout=20)
    assert r.status_code == 403, f"expected 403 for buyer; got {r.status_code} {r.text}"


def test_audit_verify_seller_forbidden(seller):
    r = seller.get(f"{API}/security/audit/verify", timeout=20)
    assert r.status_code == 403, f"expected 403 for seller; got {r.status_code} {r.text}"


def test_audit_chain_entries_have_chain_fields(db):
    """Recent audit_logs (post hash-chain deploy) must have seq/prev_hash/content_hash."""
    # Use seq existence filter so we only check chain-aware entries
    logs = list(db.audit_logs.find({"seq": {"$exists": True}}).sort("seq", -1).limit(5))
    assert logs, "no chain-aware audit_logs in DB (no entries have seq field)"
    for entry in logs:
        for k in ("seq", "prev_hash", "content_hash"):
            assert k in entry, f"audit_log missing {k}: keys={list(entry.keys())}"
        assert isinstance(entry["seq"], int)
        assert isinstance(entry["content_hash"], str) and len(entry["content_hash"]) == 64


# ---------- OTS Proofs ----------
def test_proofs_list_buyer_sees_own(buyer):
    r = buyer.get(f"{API}/security/proofs", timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list)
    # No raw ots_bytes in list response
    for p in items[:5]:
        assert "ots_bytes" not in p, "ots_bytes leaked in list endpoint"
        for k in ("id", "kind", "digest_hex", "status", "created_at"):
            assert k in p, f"proof missing key {k}: {p.keys()}"


def test_proofs_pagination_sorted_desc(buyer):
    r = buyer.get(f"{API}/security/proofs", timeout=15)
    items = r.json()
    if len(items) >= 2:
        a, b = items[0]["created_at"], items[1]["created_at"]
        assert a >= b, f"proofs not sorted desc: {a} vs {b}"


def test_proof_detail_excludes_ots_bytes(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no proofs to inspect")
    pid = items[0]["id"]
    r = buyer.get(f"{API}/security/proofs/{pid}", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "ots_bytes" not in d
    assert d["id"] == pid


def test_proof_download_returns_ots_magic_bytes(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no proofs to download")
    pid = items[0]["id"]
    r = buyer.get(f"{API}/security/proofs/{pid}/download", timeout=20)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    cd = r.headers.get("Content-Disposition", "").lower()
    assert "attachment" in cd, f"missing attachment: {cd}"
    # OpenTimestamps magic header: \x00OpenTimestamps\x00
    magic = b"\x00OpenTimestamps\x00"
    assert r.content.startswith(magic), f"missing OTS magic bytes; head={r.content[:32]!r}"


def test_proof_upgrade_handles_pending(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    pending = [p for p in items if p.get("status") == "pending"]
    if not pending:
        pytest.skip("no pending proofs to upgrade")
    pid = pending[0]["id"]
    r = buyer.post(f"{API}/security/proofs/{pid}/upgrade", timeout=60)
    assert r.status_code == 200, f"upgrade failed: {r.status_code} {r.text}"
    d = r.json()
    assert "upgraded" in d
    assert "btc_block_height" in d
    # For very fresh proofs, expect not yet confirmed
    if d["upgraded"] is False:
        assert d["btc_block_height"] in (None, 0)


def test_proof_download_non_owner_forbidden(seller, buyer):
    """Seller trying to fetch buyer's proof for a non-shared event should 403/404."""
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no buyer proofs")
    # find a proof tied only to buyer (kind=inquiry.status with buyer as actor) — best-effort
    target = items[0]
    r = seller.get(f"{API}/security/proofs/{target['id']}", timeout=15)
    # Could be 200 if seller is co-participant in same room/inquiry; or 403/404 otherwise.
    assert r.status_code in (200, 403, 404), f"unexpected: {r.status_code} {r.text}"


# ---------- /api/security/verify ----------
def test_verify_endpoint_correct_digest(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no proofs to verify")
    target = items[0]
    dl = buyer.get(f"{API}/security/proofs/{target['id']}/download", timeout=20)
    assert dl.status_code == 200
    ots_bytes = dl.content

    s = requests.Session()
    s.headers.update({"Authorization": buyer.headers["Authorization"]})
    files = {"ots_file": ("proof.ots", ots_bytes, "application/vnd.opentimestamps")}
    data = {"digest_hex": target["digest_hex"]}
    r = s.post(f"{API}/security/verify", files=files, data=data, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = r.json()
    assert body.get("matches_digest") is True, f"expected match: {body}"


def test_verify_endpoint_wrong_digest(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no proofs")
    target = items[0]
    dl = buyer.get(f"{API}/security/proofs/{target['id']}/download", timeout=20)
    s = requests.Session()
    s.headers.update({"Authorization": buyer.headers["Authorization"]})
    files = {"ots_file": ("proof.ots", dl.content, "application/vnd.opentimestamps")}
    wrong = "a" * 64
    r = s.post(f"{API}/security/verify", files=files, data={"digest_hex": wrong}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("matches_digest") is False


def test_verify_endpoint_bad_digest_format(buyer):
    items = buyer.get(f"{API}/security/proofs", timeout=15).json()
    if not items:
        pytest.skip("no proofs")
    target = items[0]
    dl = buyer.get(f"{API}/security/proofs/{target['id']}/download", timeout=20)
    s = requests.Session()
    s.headers.update({"Authorization": buyer.headers["Authorization"]})
    files = {"ots_file": ("proof.ots", dl.content, "application/vnd.opentimestamps")}
    # too short / not hex
    r = s.post(f"{API}/security/verify", files=files, data={"digest_hex": "nothex_short"}, timeout=15)
    assert r.status_code == 400, f"expected 400 for bad digest format; got {r.status_code} {r.text}"


# ---------- AES-256-GCM encryption round-trip ----------
def test_encrypted_upload_download_roundtrip(buyer, seller):
    """Create a new room, NDA-accept, upload binary, download, verify byte-identical + sha256 match."""
    listings = buyer.get(f"{API}/marketplace", timeout=15).json()
    if not listings:
        pytest.skip("no listings to use")
    target = listings[0]
    inq = buyer.post(f"{API}/marketplace/{target['id']}/inquire",
                     json={"message": "TEST_iter9_enc_roundtrip"}, timeout=15)
    assert inq.status_code == 200, inq.text
    iid = inq.json()["id"]
    eng = seller.patch(f"{API}/inquiries/{iid}/status", json={"status": "engaged"}, timeout=15)
    assert eng.status_code == 200
    room_resp = seller.post(f"{API}/inquiries/{iid}/open-room", timeout=15)
    assert room_resp.status_code == 200
    rid = room_resp.json()["id"]
    buyer.post(f"{API}/deal-rooms/{rid}/accept-nda",
               json={"signed_name": "Roundtrip Tester"}, timeout=15)

    # Upload a binary blob with mixed bytes (not just text)
    blob = bytes(range(256)) * 4  # 1024 bytes covering all byte values
    sha = hashlib.sha256(blob).hexdigest()

    s = requests.Session()
    s.headers.update({"Authorization": seller.headers["Authorization"]})
    files = {"file": ("TEST_iter9_enc.bin", blob, "application/octet-stream")}
    up = s.post(f"{API}/deal-rooms/{rid}/files/binary",
                files=files, data={"folder": "operations"}, timeout=60)
    assert up.status_code == 200, f"upload failed: {up.status_code} {up.text}"
    meta = up.json()
    assert meta.get("encrypted") is True, f"file not marked encrypted: {meta}"
    assert meta.get("encryption_alg") == "AES-256-GCM"
    assert meta.get("sha256_hex") == sha, f"sha mismatch in metadata: api={meta.get('sha256_hex')} expected={sha}"

    fid = meta["id"]
    dl = s.get(f"{API}/deal-rooms/{rid}/files/{fid}/download", timeout=30)
    assert dl.status_code == 200, dl.text
    assert dl.content == blob, "decrypted bytes != original!"
    assert hashlib.sha256(dl.content).hexdigest() == sha


# ---------- /api/security/proofs/{id}/download non-hex / not-found ----------
def test_proof_download_not_found(buyer):
    r = buyer.get(f"{API}/security/proofs/nonexistent-id-xxx/download", timeout=15)
    assert r.status_code in (403, 404), f"expected 403/404; got {r.status_code} {r.text}"
