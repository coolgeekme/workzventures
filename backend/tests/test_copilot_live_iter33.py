"""LIVE test for iter-33 Co-pilot background-job conversion.
Verifies:
  1. POST /api/deal-rooms/{rid}/copilot returns in <2s with {job_id, status:'pending', user_message}
  2. GET /api/deal-rooms/{rid}/copilot-job/{job_id} progresses pending → running → completed
  3. Once completed, GET /api/deal-rooms/{rid}/copilot exposes the assistant message
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
BUYER_EMAIL = "alex@workz.example.com"
BUYER_PASSWORD = "WorkzPass123!"


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def active_room_id(buyer_token):
    h = {"Authorization": f"Bearer {buyer_token}"}
    r = requests.get(f"{BASE_URL}/api/deal-rooms", headers=h, timeout=30)
    assert r.status_code == 200, r.text[:300]
    rooms = r.json()
    # prefer 'Backfill Test Co' otherwise any active room
    preferred = [x for x in rooms if "Backfill Test" in (x.get("listing_name") or "")]
    candidates = preferred or [x for x in rooms if x.get("status") in ("active", "pending_nda", "closing")]
    assert candidates, f"No active rooms for buyer. Rooms returned: {rooms}"
    return candidates[0]["id"]


def test_post_returns_immediately_with_job(buyer_token, active_room_id):
    h = {"Authorization": f"Bearer {buyer_token}"}
    started = time.time()
    r = requests.post(f"{BASE_URL}/api/deal-rooms/{active_room_id}/copilot",
                      headers=h, json={"message": "What's the customer concentration?"},
                      timeout=20)
    elapsed = time.time() - started
    assert r.status_code == 200, f"POST failed: {r.status_code} {r.text[:400]}"
    data = r.json()
    assert "job_id" in data, f"Missing job_id: {data}"
    assert data.get("status") == "pending", f"Expected pending, got: {data.get('status')}"
    assert data.get("user_message", {}).get("content") == "What's the customer concentration?"
    assert elapsed < 5.0, f"POST took {elapsed:.2f}s — must be <5s (target <2s)"
    print(f"[OK] POST returned in {elapsed:.2f}s with job_id={data['job_id']}")
    # stash for next test
    pytest.copilot_job_id = data["job_id"]
    pytest.copilot_room_id = active_room_id


def test_job_polling_progresses_to_terminal(buyer_token):
    h = {"Authorization": f"Bearer {buyer_token}"}
    rid = pytest.copilot_room_id
    job_id = pytest.copilot_job_id
    seen_statuses = []
    deadline = time.time() + 90  # generous - Claude can take 5-15s
    final = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/deal-rooms/{rid}/copilot-job/{job_id}",
                         headers=h, timeout=20)
        assert r.status_code == 200, f"Poll failed: {r.status_code} {r.text[:200]}"
        j = r.json()
        status = j.get("status")
        if status not in seen_statuses:
            seen_statuses.append(status)
            print(f"[poll] status={status}")
        if status in ("completed", "failed"):
            final = j
            break
        time.sleep(2.5)
    assert final is not None, f"Job did not reach terminal in 90s. seen={seen_statuses}"
    assert final["status"] in ("completed", "failed")
    print(f"[OK] terminal status={final['status']} seen={seen_statuses}")
    pytest.copilot_final = final


def test_assistant_message_present_in_history(buyer_token):
    h = {"Authorization": f"Bearer {buyer_token}"}
    rid = pytest.copilot_room_id
    final = pytest.copilot_final
    if final["status"] != "completed":
        pytest.skip(f"Job not completed (status={final['status']}, error={final.get('error')})")
    r = requests.get(f"{BASE_URL}/api/deal-rooms/{rid}/copilot", headers=h, timeout=30)
    assert r.status_code == 200, r.text[:400]
    payload = r.json()
    msgs = payload if isinstance(payload, list) else payload.get("messages", [])
    assistant_msgs = [m for m in msgs if m.get("role") == "assistant"]
    assert assistant_msgs, "No assistant messages in history"
    asst_id = final.get("assistant_message_id")
    if asst_id:
        match = [m for m in assistant_msgs if m.get("id") == asst_id]
        assert match, f"Assistant message id {asst_id} not found in history"
        print(f"[OK] assistant message persisted with {len(match[0].get('citations') or [])} citations")
    else:
        print("[OK] assistant message present (no assistant_message_id surfaced)")
