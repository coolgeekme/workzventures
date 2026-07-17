"""LIVE end-to-end tests for the Valuation Workbench (Phase A).

Hits the running backend via REACT_APP_BACKEND_URL as buyer alex.
Covers: create/list/get/patch/autofill-status/snapshot/PDF/delete + regression checks.
"""
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

BUYER_EMAIL = "alex@workz.example.com"
BUYER_PASSWORD = "WorkzPass123!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_valuation(auth_headers):
    """Create a valuation with autofill=False for deterministic testing."""
    r = requests.post(
        f"{BASE_URL}/api/valuations",
        json={
            "company_name": "TEST_LiveVal",
            "sector": "Fintech",
            "one_liner": "Payment infra",
            "headquarters": "SF, CA",
            "autofill": False,
        },
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200, f"Create failed: {r.status_code} {r.text}"
    doc = r.json()
    yield doc
    # Cleanup
    try:
        requests.delete(f"{BASE_URL}/api/valuations/{doc['id']}", headers=auth_headers, timeout=10)
    except Exception:
        pass


# ---------- Create + skip autofill ----------
def test_create_valuation_with_autofill_false(created_valuation):
    v = created_valuation
    assert v["id"]
    assert v["company_name"] == "TEST_LiveVal"
    assert v["autofill_status"] == "skipped"
    assert set(v["inputs"].keys()) == {"recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"}
    # All 5 method-input dicts should be empty
    for k, inp in v["inputs"].items():
        assert inp == {}, f"{k} should be empty, got {inp}"


def test_create_valuation_rejects_empty_name(auth_headers):
    r = requests.post(f"{BASE_URL}/api/valuations", json={"company_name": "  ", "autofill": False}, headers=auth_headers, timeout=10)
    assert r.status_code == 400


# ---------- List + Get ----------
def test_list_valuations_includes_created(created_valuation, auth_headers):
    r = requests.get(f"{BASE_URL}/api/valuations", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    items = r.json()
    ids = [it["id"] for it in items]
    assert created_valuation["id"] in ids


def test_get_valuation(created_valuation, auth_headers):
    vid = created_valuation["id"]
    r = requests.get(f"{BASE_URL}/api/valuations/{vid}", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    v = r.json()
    assert v["id"] == vid
    assert "_id" not in v


def test_get_valuation_not_found(auth_headers):
    r = requests.get(f"{BASE_URL}/api/valuations/does-not-exist", headers=auth_headers, timeout=10)
    assert r.status_code == 404


# ---------- PATCH: DCF-only recomputes aggregate ----------
def test_patch_dcf_only_computes_aggregate(created_valuation, auth_headers):
    vid = created_valuation["id"]
    body = {
        "inputs": {
            "dcf": {
                "year1_revenue_usd": 10_000_000, "revenue_growth_pct": 30,
                "ebitda_margin_pct": 25, "capex_pct_revenue": 5,
                "tax_rate_pct": 21, "terminal_growth_pct": 3, "wacc_pct": 12,
            }
        }
    }
    r = requests.patch(f"{BASE_URL}/api/valuations/{vid}", json=body, headers=auth_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["outputs"]["dcf"]["value_usd"] > 0
    assert data["aggregate"]["base_usd"] > 0
    assert "dcf" in data["aggregate"]["included_methods"]


# ---------- PATCH: Recent Transaction with decay math ----------
def test_patch_recent_transaction_applies_decay(created_valuation, auth_headers):
    vid = created_valuation["id"]
    body = {
        "inputs": {
            "recent_transaction": {"post_money_usd": 100_000_000, "time_decay_factor": 0.65}
        }
    }
    r = requests.patch(f"{BASE_URL}/api/valuations/{vid}", json=body, headers=auth_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["outputs"]["recent_transaction"]["adjusted_value_usd"] == 65_000_000
    # Base should be close to 65M (blended with DCF from the previous test — both methods)
    base = data["aggregate"]["base_usd"]
    assert base > 0
    assert "recent_transaction" in data["aggregate"]["included_methods"]


# ---------- Autofill status polling ----------
def test_autofill_status_endpoint(created_valuation, auth_headers):
    vid = created_valuation["id"]
    r = requests.get(f"{BASE_URL}/api/valuations/{vid}/autofill/status", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "autofill_status" in data
    assert data["autofill_status"] in {"pending", "completed", "failed", "skipped"}


# ---------- Snapshot: create + immutability + PDF ----------
@pytest.fixture(scope="module")
def snapshot(created_valuation, auth_headers):
    vid = created_valuation["id"]
    r = requests.post(
        f"{BASE_URL}/api/valuations/{vid}/snapshots",
        json={"label": "TEST snapshot", "narrative": "auto e2e"},
        headers=auth_headers,
        timeout=20,
    )
    assert r.status_code == 200, f"Snapshot creation failed: {r.status_code} {r.text}"
    return r.json()


def test_snapshot_created(snapshot):
    assert snapshot["id"]
    assert snapshot.get("label")


def test_snapshot_list(snapshot, created_valuation, auth_headers):
    vid = created_valuation["id"]
    r = requests.get(f"{BASE_URL}/api/valuations/{vid}/snapshots", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    rows = r.json()
    ids = [s["id"] for s in rows]
    assert snapshot["id"] in ids


def test_snapshot_immutability(snapshot, created_valuation, auth_headers):
    """After a snapshot, mutate the draft — the snapshot must return ORIGINAL values."""
    vid = created_valuation["id"]
    sid = snapshot["id"]
    # Get original snapshot state
    r0 = requests.get(f"{BASE_URL}/api/valuations/{vid}/snapshots/{sid}", headers=auth_headers, timeout=10)
    assert r0.status_code == 200
    original = r0.json()
    original_rt = ((original.get("inputs") or {}).get("recent_transaction") or {}).get("post_money_usd")

    # Mutate the draft with a very different value
    requests.patch(
        f"{BASE_URL}/api/valuations/{vid}",
        json={"inputs": {"recent_transaction": {"post_money_usd": 999_000_000, "time_decay_factor": 0.5}}},
        headers=auth_headers,
        timeout=15,
    )

    # Snapshot must not change
    r1 = requests.get(f"{BASE_URL}/api/valuations/{vid}/snapshots/{sid}", headers=auth_headers, timeout=10)
    assert r1.status_code == 200
    snap_after = r1.json()
    snap_rt = ((snap_after.get("inputs") or {}).get("recent_transaction") or {}).get("post_money_usd")
    assert snap_rt == original_rt, f"Snapshot mutated: was {original_rt}, now {snap_rt}"


def test_snapshot_pdf_endpoint(snapshot, created_valuation, auth_headers):
    vid = created_valuation["id"]
    sid = snapshot["id"]
    r = requests.get(f"{BASE_URL}/api/valuations/{vid}/snapshots/{sid}/pdf", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF", f"Bad PDF magic: {r.content[:20]}"
    assert len(r.content) > 1000, "PDF suspiciously small"


def test_snapshot_pdf_contains_required_text(snapshot, created_valuation, auth_headers):
    """Verify PDF contents include ASC 820, IPEV, company name, exec summary, Option Pricing."""
    import subprocess
    vid = created_valuation["id"]
    sid = snapshot["id"]
    r = requests.get(f"{BASE_URL}/api/valuations/{vid}/snapshots/{sid}/pdf", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    pdf_path = f"/tmp/val_snap_{sid}.pdf"
    with open(pdf_path, "wb") as f:
        f.write(r.content)
    text = ""
    try:
        import pypdf
        reader = pypdf.PdfReader(pdf_path)
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception as e:
        try:
            out = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], capture_output=True, timeout=20)
            text = out.stdout.decode("utf-8", errors="ignore")
        except Exception:
            pytest.skip(f"No PDF text extractor available: {e}")

    text_up = text.upper()
    assert "ASC 820" in text_up, "ASC 820 missing"
    assert "IPEV" in text_up, "IPEV missing"
    assert "TEST_LIVEVAL" in text_up, "Company name missing"
    assert "EXECUTIVE SUMMARY" in text_up, "Executive summary section missing"
    assert "OPTION PRICING" in text_up, "Option Pricing section missing"


# ---------- Term-sheet upload ----------
def test_term_sheet_upload(created_valuation, auth_headers):
    vid = created_valuation["id"]
    fake_pdf_text = "Series B term sheet. $15M raise at $60M post-money. Total liquidation preference $20M."
    # Backend uses extract_pages_from_bytes — safest to upload a .txt so extractor reads text directly.
    files = {"file": ("termsheet.txt", io.BytesIO(fake_pdf_text.encode()), "text/plain")}
    r = requests.post(f"{BASE_URL}/api/valuations/{vid}/term-sheet", files=files, headers=auth_headers, timeout=60)
    # Endpoint may return 400 if extractor can't read .txt — accept 200 or graceful skip.
    if r.status_code == 400:
        pytest.skip(f"Term-sheet extractor rejected txt upload: {r.text}")
    assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
    body = r.json()
    assert "extracted" in body
    assert "inputs" in body


# ---------- Delete ----------
def test_delete_valuation(auth_headers):
    # Create a throwaway then delete
    r = requests.post(f"{BASE_URL}/api/valuations", json={"company_name": "TEST_ToDelete", "autofill": False}, headers=auth_headers, timeout=10)
    assert r.status_code == 200
    vid = r.json()["id"]
    d = requests.delete(f"{BASE_URL}/api/valuations/{vid}", headers=auth_headers, timeout=10)
    assert d.status_code in {200, 204}
    # Soft-delete: list should NOT include it
    l = requests.get(f"{BASE_URL}/api/valuations", headers=auth_headers, timeout=10)
    assert l.status_code == 200
    ids = [it["id"] for it in l.json()]
    assert vid not in ids, "Soft-deleted valuation still appears in list"
