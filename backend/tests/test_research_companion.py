"""
Smoke tests for the Research Companion — buyer-only AI grounded on their own
research brief + locker files for a researched company (outside the Vault).
"""
import io
import os
import time
import uuid

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://capos-replica.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _make_brief(token, company_name):
    r = requests.post(
        f"{API}/research/company",
        headers={"Authorization": f"Bearer {token}"},
        json={"company_name": company_name, "company_url": "https://example.com",
              "sector": "FinTech", "notes": "smoke test"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    # Poll up to ~120s for completion
    for _ in range(60):
        try:
            d = requests.get(
                f"{API}/research/detail/{rid}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            ).json()
            if d["status"] in ("completed", "failed"):
                return rid, d
        except Exception:
            pass
        time.sleep(2)
    return rid, d


def test_locker_accepts_research_scope():
    token = _login(BUYER)
    rid, _ = _make_brief(token, f"TestCo-{uuid.uuid4().hex[:6]}")

    payload = b"DD call: top-5 customers concentration is 60%, ARR growing 80%."
    r = requests.post(
        f"{API}/private-locker/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (f"notes-{uuid.uuid4().hex[:6]}.txt", io.BytesIO(payload), "text/plain")},
        data={"research_id": rid, "folder": "notes", "note": "partner call"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["scope"] == "research"
    assert doc["research_id"] == rid

    # List via /research/{rid}/locker shortcut
    lk = requests.get(
        f"{API}/research/{rid}/locker",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert lk.status_code == 200
    assert any(f["id"] == doc["id"] for f in lk.json())

    # cleanup
    requests.delete(
        f"{API}/private-locker/files/{doc['id']}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


def test_seller_cannot_use_companion_or_research_locker():
    stok = _login(SELLER)
    fake_rid = str(uuid.uuid4())
    r = requests.get(
        f"{API}/research/{fake_rid}/copilot",
        headers={"Authorization": f"Bearer {stok}"},
        timeout=15,
    )
    assert r.status_code == 403
    r2 = requests.get(
        f"{API}/research/{fake_rid}/locker",
        headers={"Authorization": f"Bearer {stok}"},
        timeout=15,
    )
    assert r2.status_code == 403


def test_companion_grounds_answer_on_locker_doc():
    token = _login(BUYER)
    rid, _ = _make_brief(token, f"GrowCo-{uuid.uuid4().hex[:6]}")

    payload = (
        "Confidential partner call notes: GrowCo reported FY24 revenue of $42.6M, "
        "up 71% YoY. Net retention 138%. Cap table includes Andreessen and Sequoia. "
        "CEO confirmed plans to raise Series C in Q3 2026."
    ).encode("utf-8")
    up = requests.post(
        f"{API}/private-locker/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (f"call-{uuid.uuid4().hex[:6]}.txt", io.BytesIO(payload), "text/plain")},
        data={"research_id": rid, "folder": "notes", "note": "private call notes"},
        timeout=30,
    )
    assert up.status_code == 200
    fid = up.json()["id"]

    ask = requests.post(
        f"{API}/research/{rid}/copilot",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "What is GrowCo's FY24 revenue and growth rate?"},
        timeout=60,
    )
    assert ask.status_code == 200, ask.text
    body = ask.json()
    assert body["assistant_message"]["content"]
    # The answer must cite the locker file (filename contains "call-")
    labels = [c.get("label", "") for c in body["assistant_message"]["citations"]]
    assert any("call-" in l for l in labels), f"expected locker citation, got {labels}"

    # History endpoint must return both messages
    hist = requests.get(
        f"{API}/research/{rid}/copilot",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert hist.status_code == 200
    assert len(hist.json()) >= 2

    # cleanup
    requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


def test_companion_returns_404_for_other_users_research():
    """Buyer A cannot use Companion on Buyer B's research target."""
    a = _login(BUYER)
    rid_a, _ = _make_brief(a, f"SecretCo-{uuid.uuid4().hex[:6]}")

    # Throwaway buyer
    email = f"other-{uuid.uuid4().hex[:8]}@example.com"
    reg = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "DemoPass123!", "name": "Other",
              "role": "buyer", "organization": "test"},
        timeout=20,
    )
    if reg.status_code not in (200, 201):
        return
    b_token = reg.json()["token"]
    r = requests.post(
        f"{API}/research/{rid_a}/copilot",
        headers={"Authorization": f"Bearer {b_token}"},
        json={"message": "anything"},
        timeout=15,
    )
    assert r.status_code == 404
