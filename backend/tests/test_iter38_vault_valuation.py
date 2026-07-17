"""Iter-38 backend test — Vault-grounded valuations ('Value this target')

Covers:
  * GET  /api/deal-rooms/{rid}/valuation as buyer (200) — Helios vault
  * Response contains private_grounded=True + vault_files_used non-empty w/ priority
  * Idempotent POST /api/deal-rooms/{rid}/valuation (same id both times)
  * Buyer-private: seller GET returns 404 (or 200 without leaking peer valuations)
  * Third-party (not in room) → 403 via participant_check
  * Memo PDF cover contains 'Private Data Room' + 'file' string
  * Regression: base Phase-A valuation (no deal_room_id) still not private_grounded
"""
import os
import io
import re
import time
import requests
import pytest

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as _f:
            for line in _f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return None

BASE = os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()
assert BASE, "REACT_APP_BACKEND_URL missing"
BASE = BASE.rstrip("/")
HELIOS_RID = "a3f76340-6436-458c-99b7-4c6bdbcc8e73"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}
ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER)


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- 1. Buyer GET on Helios vault -------------------------------------
def test_buyer_get_helios_vault_valuation(buyer_token):
    r = requests.get(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(buyer_token), timeout=15)
    assert r.status_code == 200, f"got {r.status_code}: {r.text[:400]}"
    d = r.json()
    assert d.get("deal_room_id") == HELIOS_RID
    assert d.get("private_grounded") is True, "expected private_grounded=True"
    vfu = d.get("vault_files_used") or []
    assert isinstance(vfu, list) and len(vfu) > 0, "vault_files_used should be non-empty"
    priorities = {"TERM_SHEET", "CAP_TABLE", "FINANCIALS", "OTHER"}
    for f in vfu:
        assert "id" in f and "filename" in f and "priority" in f
        assert f["priority"] in priorities, f"unexpected priority {f['priority']}"
    agg = d.get("aggregate") or {}
    assert agg.get("base_usd"), "expected an aggregate base_usd"
    # store id for later tests
    pytest.helios_vid = d["id"]


# ---------- 2. Idempotent POST -----------------------------------------------
def test_post_valuation_is_idempotent(buyer_token):
    r1 = requests.post(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(buyer_token), timeout=30)
    assert r1.status_code in (200, 201), f"first POST failed: {r1.status_code} {r1.text[:400]}"
    id1 = r1.json()["id"]
    r2 = requests.post(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(buyer_token), timeout=30)
    assert r2.status_code in (200, 201)
    id2 = r2.json()["id"]
    assert id1 == id2, "POST /valuation must be idempotent — got different ids"


# ---------- 3. Seller does NOT see buyer's valuation -------------------------
def test_seller_cannot_see_buyer_valuation(seller_token):
    r = requests.get(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(seller_token), timeout=15)
    # Two acceptable outcomes: seller not a participant → 403, OR they are room owner
    # but query is scoped by user_id → 404
    assert r.status_code in (403, 404), (
        f"Seller MUST NOT see buyer's valuation (buyer-private). Got {r.status_code}: {r.text[:400]}"
    )


# ---------- 4. Unrelated third-party → 403 -----------------------------------
def test_unrelated_third_party_forbidden():
    """Try agent account first (not a Helios participant); if unavailable, register a fresh buyer."""
    tok = None
    # Try agent
    r = requests.post(f"{BASE}/api/auth/login", json={
        "email": "agent@workz.example.com", "password": "WorkzPass123!"}, timeout=15)
    if r.status_code == 200:
        tok = r.json()["token"]
    else:
        import uuid as _u
        email = f"TEST_intruder_{_u.uuid4().hex[:8]}@example.com"
        reg = requests.post(f"{BASE}/api/auth/register", json={
            "email": email, "password": "WorkzPass123!", "name": "Intruder", "role": "buyer",
            "organization_name": "TEST Intruder Co",
        }, timeout=15)
        tok = (reg.json() or {}).get("token") if reg.status_code in (200, 201) else None
    if not tok:
        pytest.skip("could not obtain an unrelated user token")
    r = requests.get(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(tok), timeout=15)
    # If agent happens to have been invited into Helios we accept 404 as well (still safe)
    assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code}: {r.text[:200]}"


# ---------- 5. Memo PDF contains Private Data Room text ----------------------
def test_memo_pdf_contains_private_data_room(buyer_token):
    vid = getattr(pytest, "helios_vid", None)
    if not vid:
        r = requests.get(f"{BASE}/api/deal-rooms/{HELIOS_RID}/valuation", headers=_h(buyer_token), timeout=15)
        vid = r.json()["id"]
    # List snapshots
    r = requests.get(f"{BASE}/api/valuations/{vid}/snapshots", headers=_h(buyer_token), timeout=15)
    if r.status_code != 200 or not r.json():
        # create one
        cr = requests.post(f"{BASE}/api/valuations/{vid}/snapshots",
                           headers=_h(buyer_token), json={"note": "TEST_iter38"}, timeout=30)
        assert cr.status_code in (200, 201), f"snapshot create failed: {cr.status_code} {cr.text[:300]}"
        sid = cr.json()["id"]
    else:
        sid = r.json()[0]["id"]
    # Fetch PDF
    pdf = requests.get(f"{BASE}/api/valuations/{vid}/snapshots/{sid}/pdf",
                       headers=_h(buyer_token), timeout=30)
    assert pdf.status_code == 200, f"pdf fetch failed {pdf.status_code}"
    assert pdf.headers.get("content-type", "").startswith("application/pdf")
    body = pdf.content
    assert body.startswith(b"%PDF"), "not a PDF"
    # Try to extract text
    text = ""
    try:
        from pypdf import PdfReader
        rdr = PdfReader(io.BytesIO(body))
        text = "\n".join((p.extract_text() or "") for p in rdr.pages)
    except Exception:
        # fallback: raw-bytes grep (PDFs often contain literal strings)
        text = body.decode("latin-1", errors="ignore")
    assert "Private Data Room" in text, "PDF cover missing 'Private Data Room' text"
    assert re.search(r"file", text, re.IGNORECASE), "PDF cover missing 'file' count"


# ---------- 6. Regression: Phase-A workbench w/o vault ----------------------
def test_regression_phase_a_valuation_no_vault(buyer_token):
    # Create a plain valuation (no deal_room_id)
    payload = {
        "company_name": "TEST_iter38_public_only",
        "sector": "SaaS",
        "autofill": False,
    }
    r = requests.post(f"{BASE}/api/valuations", headers=_h(buyer_token), json=payload, timeout=15)
    assert r.status_code in (200, 201), f"plain create failed: {r.status_code} {r.text[:300]}"
    d = r.json()
    assert d.get("deal_room_id") in (None, "")
    assert d.get("private_grounded") in (False, None)
    assert not (d.get("vault_files_used") or []), "expected empty vault_files_used"
    # Cleanup
    requests.delete(f"{BASE}/api/valuations/{d['id']}", headers=_h(buyer_token), timeout=10)
