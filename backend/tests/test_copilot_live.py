"""Live test for Co-pilot data access against the preview backend.

Verifies:
- POST /api/deal-rooms/{rid}/copilot returns 200 with {user_message, assistant_message}
- assistant_message.citations have {file_id, filename, page}
- Co-pilot answers questions about real files (no 'No documents have been uploaded')
- Completes well within Cloudflare's 100s edge timeout
- GET /api/deal-rooms/{rid}/copilot returns message history with `page` field on citations
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
BUYER_EMAIL = "alex@workz.example.com"
BUYER_PASS = "WorkzPass123!"

# Read REACT_APP_BACKEND_URL straight from frontend env if present
try:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
except FileNotFoundError:
    pass


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BUYER_EMAIL, "password": BUYER_PASS},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def buyer_headers(buyer_token):
    return {"Authorization": f"Bearer {buyer_token}"}


@pytest.fixture(scope="module")
def active_room_with_files(buyer_headers):
    """Find an active deal room with files (Backfill Test Co or any with files)."""
    r = requests.get(f"{BASE_URL}/api/deal-rooms", headers=buyer_headers, timeout=20)
    assert r.status_code == 200, f"deal-rooms list failed: {r.status_code} {r.text[:300]}"
    rooms = r.json()
    assert isinstance(rooms, list) and len(rooms) > 0, "No deal rooms for buyer"

    # Prefer Backfill Test Co
    preferred = [room for room in rooms if "backfill" in (room.get("listing_name", "") or room.get("listing_title", "") or "").lower()]
    candidates = preferred + [r for r in rooms if r not in preferred and (r.get("files_count") or 0) > 0]

    for room in candidates:
        rid = room.get("id") or room.get("room_id")
        if not rid:
            continue
        # Files are returned from the main detail endpoint, not /files
        dr = requests.get(f"{BASE_URL}/api/deal-rooms/{rid}", headers=buyer_headers, timeout=20)
        if dr.status_code != 200:
            continue
        detail = dr.json()
        files = detail.get("files") or []
        if files:
            return rid, room, files
    pytest.skip("No deal room with files available for buyer")


def test_copilot_post_returns_200_with_citations(buyer_headers, active_room_with_files):
    rid, room, files = active_room_with_files
    start = time.time()
    r = requests.post(
        f"{BASE_URL}/api/deal-rooms/{rid}/copilot",
        headers=buyer_headers,
        json={"message": "What files are in this vault? Please list each filename."},
        timeout=110,
    )
    elapsed = time.time() - start
    print(f"\nPOST /copilot rid={rid} took {elapsed:.2f}s status={r.status_code}")
    assert r.status_code == 200, f"copilot POST failed: {r.status_code} {r.text[:500]}"
    assert elapsed < 100, f"copilot took {elapsed:.2f}s — exceeds Cloudflare 100s edge timeout"

    data = r.json()
    assert "user_message" in data, f"missing user_message: {data}"
    assert "assistant_message" in data, f"missing assistant_message: {data}"
    am = data["assistant_message"]
    assert "content" in am or "text" in am, f"assistant_message missing content: {am}"
    answer = (am.get("content") or am.get("text") or "")
    # Must NOT claim no documents when files exist
    assert "no documents have been uploaded" not in answer.lower(), (
        f"Co-pilot said no documents when {len(files)} exist. Answer: {answer[:500]}"
    )
    # Citations should be present and have page field
    citations = am.get("citations") or []
    print(f"Citations returned: {len(citations)}; answer len: {len(answer)}")
    if citations:
        cit = citations[0]
        assert "file_id" in cit, f"citation missing file_id: {cit}"
        assert "filename" in cit, f"citation missing filename: {cit}"
        assert "page" in cit, f"citation missing page (new field): {cit}"
        file_ids_in_vault = {f.get("id") or f.get("file_id") for f in files}
        # At least one citation must point to a real vault file
        cited_ids = {c.get("file_id") for c in citations}
        overlap = cited_ids & file_ids_in_vault
        assert overlap, f"No citation matched a vault file. citations={cited_ids} vault={file_ids_in_vault}"


def test_copilot_get_history_has_page_field(buyer_headers, active_room_with_files):
    rid, _, _ = active_room_with_files
    r = requests.get(f"{BASE_URL}/api/deal-rooms/{rid}/copilot", headers=buyer_headers, timeout=30)
    assert r.status_code == 200, f"GET copilot failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    messages = body if isinstance(body, list) else body.get("messages", [])
    assert isinstance(messages, list), f"expected list of messages, got {type(body)}"
    # Find an assistant message with citations
    cited = [m for m in messages if (m.get("citations") or [])]
    if cited:
        for m in cited:
            for c in m["citations"]:
                assert "page" in c, f"history citation missing page field (should default to 1): {c}"
                assert isinstance(c["page"], int) and c["page"] >= 1, f"invalid page value: {c}"
        print(f"Verified page field on {sum(len(m['citations']) for m in cited)} citations across {len(cited)} messages")
    else:
        print("No prior messages with citations — page-field default check vacuously passes")


def test_copilot_completes_under_60s_for_small_vault(buyer_headers, active_room_with_files):
    """Dynamic char budget should keep small-vault answers fast."""
    rid, _, files = active_room_with_files
    if len(files) > 30:
        pytest.skip(f"vault has {len(files)} files; this test targets ≤30")
    start = time.time()
    r = requests.post(
        f"{BASE_URL}/api/deal-rooms/{rid}/copilot",
        headers=buyer_headers,
        json={"message": "Summarize the company in one sentence."},
        timeout=80,
    )
    elapsed = time.time() - start
    print(f"\nSmall-vault POST /copilot took {elapsed:.2f}s status={r.status_code}")
    assert r.status_code == 200, f"copilot failed: {r.text[:400]}"
    assert elapsed < 60, f"small-vault copilot took {elapsed:.2f}s — should be <60s"
