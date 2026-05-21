"""
Iter-11 CRUD: delete / edit / messaging / collateral actions.
Focus: cross-role authorization, soft-delete filter correctness, push-to-vault chain.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}
ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _s(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def buyer():
    t, u = _login(BUYER)
    return {"token": t, "user": u, "s": _s(t)}


@pytest.fixture(scope="module")
def seller():
    t, u = _login(SELLER)
    return {"token": t, "user": u, "s": _s(t)}


@pytest.fixture(scope="module")
def admin():
    t, u = _login(ADMIN)
    return {"token": t, "user": u, "s": _s(t)}


# -------------------- Research delete (hard) --------------------
def test_research_delete_owner_and_excluded_from_list(buyer):
    # Create a research brief via /research/company (long-running LLM)
    r = buyer["s"].post(f"{API}/research/company", json={
        "company_name": f"TEST_Acme_{uuid.uuid4().hex[:6]}",
        "sector": "SaaS",
        "region": "NA",
    }, timeout=180)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]

    # Confirm in history
    hist = buyer["s"].get(f"{API}/research/history", timeout=15).json()
    assert any(x["id"] == rid for x in hist)

    # Delete
    d = buyer["s"].delete(f"{API}/research/{rid}", timeout=15)
    assert d.status_code == 200

    # No longer in history
    hist2 = buyer["s"].get(f"{API}/research/history", timeout=15).json()
    assert not any(x["id"] == rid for x in hist2)

    # 2nd delete -> 404
    assert buyer["s"].delete(f"{API}/research/{rid}", timeout=15).status_code == 404


def test_research_delete_non_owner_404(buyer, seller):
    r = buyer["s"].post(f"{API}/research/company", json={
        "company_name": f"TEST_Owned_{uuid.uuid4().hex[:6]}",
        "sector": "SaaS", "region": "EMEA",
    }, timeout=180)
    assert r.status_code == 200
    rid = r.json()["id"]
    # Seller cannot delete buyer's research
    assert seller["s"].delete(f"{API}/research/{rid}", timeout=15).status_code == 404
    # Cleanup
    buyer["s"].delete(f"{API}/research/{rid}", timeout=15)


# -------------------- Inquiry create + messaging + soft delete --------------------
@pytest.fixture(scope="module")
def live_listing(seller):
    r = seller["s"].get(f"{API}/listings", timeout=15)
    assert r.status_code == 200
    listings = r.json()
    live = next((x for x in listings if x.get("status") == "live"), None)
    assert live, "no live listing for seller"
    return live


@pytest.fixture(scope="module")
def inquiry(buyer, live_listing):
    r = buyer["s"].post(f"{API}/marketplace/{live_listing['id']}/inquire", json={
        "message": "Initial buyer interest TEST",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_inquiry_messages_participant_scoping(buyer, seller, inquiry, admin):
    iid = inquiry["id"]
    # Buyer posts
    r = buyer["s"].post(f"{API}/inquiries/{iid}/messages", json={"body": "hello from buyer TEST"}, timeout=15)
    assert r.status_code == 200, r.text
    # Seller posts reply
    r2 = seller["s"].post(f"{API}/inquiries/{iid}/messages", json={"body": "thanks for reaching out"}, timeout=15)
    assert r2.status_code == 200
    # GET list returns chronological
    msgs = buyer["s"].get(f"{API}/inquiries/{iid}/messages", timeout=15).json()
    assert len(msgs) >= 2
    # admin can see
    msgs_admin = admin["s"].get(f"{API}/inquiries/{iid}/messages", timeout=15).json()
    assert isinstance(msgs_admin, list)


def test_inquiry_non_participant_403(seller, buyer, admin):
    # Create a fresh outsider account
    em = f"TEST_outsider_{uuid.uuid4().hex[:8]}@example.com"
    reg = requests.post(f"{API}/auth/register", json={
        "email": em, "password": "WorkzPass123!", "name": "Outsider TEST",
        "organization": "External", "role": "buyer",
    }, timeout=20)
    assert reg.status_code == 200, reg.text
    out_s = _s(reg.json()["token"])

    # Buyer creates a fresh inquiry (use marketplace endpoint, requires auth)
    listings = buyer["s"].get(f"{API}/marketplace", timeout=15).json()
    listing = next(x for x in listings if x.get("status") == "live")
    inq = buyer["s"].post(f"{API}/marketplace/{listing['id']}/inquire", json={"message": "TEST scope"}, timeout=20).json()
    iid = inq["id"]

    # Outsider 403 on GET messages
    assert out_s.get(f"{API}/inquiries/{iid}/messages", timeout=15).status_code == 403
    # Outsider 403 on POST messages
    assert out_s.post(f"{API}/inquiries/{iid}/messages", json={"body": "intrusion"}, timeout=15).status_code == 403
    # Outsider 403 on DELETE
    assert out_s.delete(f"{API}/inquiries/{iid}", timeout=15).status_code == 403

    # Buyer soft-deletes
    d = buyer["s"].delete(f"{API}/inquiries/{iid}", timeout=15)
    assert d.status_code == 200

    # After soft delete, /api/inquiries omits it for buyer AND seller
    buyer_list = buyer["s"].get(f"{API}/inquiries", timeout=15).json()
    seller_list = seller["s"].get(f"{API}/inquiries", timeout=15).json()
    assert not any(x["id"] == iid for x in buyer_list), "soft-deleted inquiry still in buyer list"
    assert not any(x["id"] == iid for x in seller_list), "soft-deleted inquiry still in seller list"


# -------------------- Deal-Room soft delete --------------------
@pytest.fixture(scope="module")
def deal_room(buyer):
    rooms = buyer["s"].get(f"{API}/deal-rooms", timeout=15).json()
    if rooms:
        return rooms[0]
    pytest.skip("No deal rooms available")


def test_dealroom_soft_delete_excluded_from_list(buyer, seller):
    rooms = buyer["s"].get(f"{API}/deal-rooms", timeout=15).json()
    if not rooms:
        pytest.skip("no rooms")
    # Pick a room whose deletion won't affect other tests too much - last one
    room = rooms[-1]
    rid = room["id"]
    d = buyer["s"].delete(f"{API}/deal-rooms/{rid}", timeout=15)
    assert d.status_code == 200, d.text

    # Buyer list excludes
    buyer_after = buyer["s"].get(f"{API}/deal-rooms", timeout=15).json()
    assert not any(x["id"] == rid for x in buyer_after)
    # Seller list also excludes (if seller was participant)
    seller_after = seller["s"].get(f"{API}/deal-rooms", timeout=15).json()
    assert not any(x["id"] == rid for x in seller_after)


# -------------------- Newsletter edit + delete --------------------
@pytest.fixture
def newsletter(seller):
    # Seller drafts a broadcast (buyers cannot use /newsletter/draft)
    r = seller["s"].post(f"{API}/newsletter/draft", json={
        "topic": f"TEST Weekly {uuid.uuid4().hex[:6]}",
    }, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


def test_newsletter_edit_owner_only(seller, buyer, newsletter):
    nid = newsletter["id"]
    # owner (seller) can patch
    r = seller["s"].patch(f"{API}/newsletter/{nid}", json={"title": "TEST Edited"}, timeout=15)
    assert r.status_code == 200
    # non-owner -> 404 (scoped by user_id)
    r2 = buyer["s"].patch(f"{API}/newsletter/{nid}", json={"title": "hijack"}, timeout=15)
    assert r2.status_code == 404


def test_newsletter_delete_hard_for_draft(seller, newsletter):
    nid = newsletter["id"]
    d = seller["s"].delete(f"{API}/newsletter/{nid}", timeout=15)
    assert d.status_code == 200
    assert d.json().get("hard_deleted") is True
    # 404 on second delete
    assert seller["s"].delete(f"{API}/newsletter/{nid}", timeout=15).status_code == 404


# -------------------- /me/interests --------------------
def test_me_interests_update_persists(buyer):
    r = buyer["s"].patch(f"{API}/me/interests", json={
        "interests": ["SaaS", "HealthTech", "TEST"],
        "newsletter_opt_in": True,
        "newsletter_cadence": "biweekly",
    }, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "password_hash" not in j
    assert "TEST" in j.get("interests", [])
    assert j.get("newsletter_cadence") == "biweekly"
    # Verify with /auth/me
    me = buyer["s"].get(f"{API}/auth/me", timeout=15).json()
    assert "TEST" in me.get("interests", [])


# -------------------- Outreach edit + delete --------------------
@pytest.fixture
def campaign(seller):
    r = seller["s"].post(f"{API}/outreach/campaigns", json={
        "name": f"TEST campaign {uuid.uuid4().hex[:6]}",
        "target_persona": "PE buyers",
        "message_brief": "Sourcing dialogue",
        "audience_size": 25,
    }, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def test_outreach_edit_and_delete_cycle(seller, buyer, campaign):
    cid = campaign["id"]
    # Buyer cannot edit seller's draft -> 404
    assert buyer["s"].patch(f"{API}/outreach/campaigns/{cid}", json={"name": "hijack"}, timeout=15).status_code == 404
    # Owner edits OK
    r = seller["s"].patch(f"{API}/outreach/campaigns/{cid}", json={"name": "TEST renamed"}, timeout=15)
    assert r.status_code == 200, r.text
    # Owner hard-deletes draft
    d = seller["s"].delete(f"{API}/outreach/campaigns/{cid}", timeout=15)
    assert d.status_code == 200
    assert d.json().get("hard_deleted") is True


# -------------------- Collateral edit / versions / pdf / delete / cross-role --------------------
@pytest.fixture(scope="module")
def collateral(seller, live_listing):
    r = seller["s"].post(f"{API}/collateral/generate", json={
        "asset_type": "one_pager",
        "deal_name": live_listing.get("company_name") or "TEST Deal",
        "target_audience": "Institutional PE buyers",
        "key_points": "growth, margins, recurring revenue",
        "tone": "professional-institutional",
    }, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


def test_collateral_edit_creates_version_and_updates_data(seller, collateral):
    cid = collateral["id"]
    # snapshot count before
    v0 = seller["s"].get(f"{API}/collateral/{cid}/versions", timeout=15).json()
    n0 = len(v0)
    # patch headline
    r = seller["s"].patch(f"{API}/collateral/{cid}", json={"headline": "TEST New Headline"}, timeout=15)
    assert r.status_code == 200, r.text
    refreshed = r.json()
    assert (refreshed.get("data") or {}).get("headline") == "TEST New Headline"
    # version count incremented
    v1 = seller["s"].get(f"{API}/collateral/{cid}/versions", timeout=15).json()
    assert len(v1) == n0 + 1
    # newest first
    assert v1[0]["created_at"] >= (v1[1]["created_at"] if len(v1) > 1 else v1[0]["created_at"])


def test_collateral_cross_role_403_or_404(buyer, seller, collateral):
    cid = collateral["id"]
    # Buyer cannot edit/delete seller's collateral -> 404 (since query is scoped by user_id)
    assert buyer["s"].patch(f"{API}/collateral/{cid}", json={"headline": "X"}, timeout=15).status_code == 404
    assert buyer["s"].delete(f"{API}/collateral/{cid}", timeout=15).status_code == 404
    assert buyer["s"].get(f"{API}/collateral/{cid}/versions", timeout=15).status_code == 404
    assert buyer["s"].get(f"{API}/collateral/{cid}/pdf", timeout=15).status_code == 404


def test_collateral_pdf_export(seller, collateral):
    cid = collateral["id"]
    r = seller["s"].get(f"{API}/collateral/{cid}/pdf", timeout=30)
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:5] == b"%PDF-"
    assert "attachment" in (r.headers.get("content-disposition") or "")


def test_collateral_attach_to_listing(seller, collateral, live_listing):
    cid = collateral["id"]
    r = seller["s"].post(f"{API}/collateral/{cid}/attach-to-listing",
                          json={"listing_id": live_listing["id"]}, timeout=15)
    assert r.status_code == 200, r.text
    atts = r.json().get("attachments") or []
    assert any(a.get("collateral_id") == cid for a in atts)
    # Idempotent (dedupe)
    r2 = seller["s"].post(f"{API}/collateral/{cid}/attach-to-listing",
                           json={"listing_id": live_listing["id"]}, timeout=15)
    atts2 = r2.json().get("attachments") or []
    assert sum(1 for a in atts2 if a.get("collateral_id") == cid) == 1


def test_collateral_attach_other_seller_listing_404(seller, buyer, collateral):
    # Buyer has no listings — try to attach to a non-existent listing
    cid = collateral["id"]
    r = seller["s"].post(f"{API}/collateral/{cid}/attach-to-listing",
                          json={"listing_id": "non-existent-id"}, timeout=15)
    assert r.status_code == 404


def test_collateral_push_to_vault_chain(seller, buyer, collateral):
    cid = collateral["id"]
    # Need an active (non-pending) vault where seller is participant
    rooms = seller["s"].get(f"{API}/deal-rooms", timeout=15).json()
    active = next((r for r in rooms if r.get("status") != "pending_nda"), None)
    if not active:
        pytest.skip("No active (non-pending-NDA) vault available")
    rid = active["id"]

    # files before
    room_detail_before = seller["s"].get(f"{API}/deal-rooms/{rid}", timeout=15).json()
    files_before = room_detail_before.get("files") or []
    n_before = len(files_before)

    r = seller["s"].post(f"{API}/collateral/{cid}/push-to-vault",
                          json={"room_id": rid, "folder": "commercial"}, timeout=60)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc.get("source_collateral_id") == cid
    assert doc.get("storage") == "gridfs"
    assert doc.get("content_type") == "application/pdf"
    # Encryption should be on (per env)
    assert doc.get("encrypted") is True
    assert doc.get("encryption_alg")

    # files after — row visible
    room_detail_after = seller["s"].get(f"{API}/deal-rooms/{rid}", timeout=15).json()
    files_after = room_detail_after.get("files") or []
    assert len(files_after) == n_before + 1
    assert any(f.get("id") == doc["id"] for f in files_after)

    # OTS proof — give it a moment, then check
    time.sleep(2.0)
    proofs = seller["s"].get(f"{API}/security/proofs", timeout=15)
    if proofs.status_code == 200:
        plist = proofs.json()
        # Best-effort: at least one vault.file proof referencing this file_id
        assert any(
            (p.get("kind") == "vault.file" and (p.get("target_id") == doc["id"]))
            for p in plist
        ), "Expected vault.file proof for pushed collateral PDF"


def test_collateral_send_to_inquiry(seller, buyer, live_listing):
    # Buyer creates a fresh inquiry via marketplace; seller sends collateral into it.
    inq = buyer["s"].post(f"{API}/marketplace/{live_listing['id']}/inquire",
                          json={"message": "TEST send"}, timeout=20).json()
    iid = inq["id"]
    # Need a collateral owned by seller
    coll = seller["s"].get(f"{API}/collateral", timeout=15).json()
    if not coll:
        pytest.skip("seller has no collateral")
    cid = coll[0]["id"]
    r = seller["s"].post(f"{API}/collateral/{cid}/send-to-inquiry",
                          json={"inquiry_id": iid, "note": "see attached"}, timeout=20)
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg.get("attachment", {}).get("id") == cid
    # buyer can see it
    msgs = buyer["s"].get(f"{API}/inquiries/{iid}/messages", timeout=15).json()
    assert any(m.get("attachment", {}) and m["attachment"].get("id") == cid for m in msgs)
    # cleanup
    buyer["s"].delete(f"{API}/inquiries/{iid}", timeout=15)


def test_collateral_delete_removes_versions(seller, live_listing):
    # Make a fresh one, then delete it
    r = seller["s"].post(f"{API}/collateral/generate", json={
        "asset_type": "one_pager",
        "deal_name": "TEST_ToDelete",
        "target_audience": "Family offices",
        "key_points": "growth, retention",
    }, timeout=180)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    seller["s"].patch(f"{API}/collateral/{cid}", json={"headline": "Snap-v1"}, timeout=15)
    versions = seller["s"].get(f"{API}/collateral/{cid}/versions", timeout=15).json()
    assert len(versions) >= 1
    d = seller["s"].delete(f"{API}/collateral/{cid}", timeout=15)
    assert d.status_code == 200
    # versions list -> 404 (collateral no longer exists)
    assert seller["s"].get(f"{API}/collateral/{cid}/versions", timeout=15).status_code == 404


# -------------------- Security: non-existent ids --------------------
def test_404_on_nonexistent_ids(seller):
    fake = str(uuid.uuid4())
    assert seller["s"].patch(f"{API}/collateral/{fake}", json={"headline": "x"}, timeout=15).status_code == 404
    assert seller["s"].delete(f"{API}/collateral/{fake}", timeout=15).status_code == 404
    assert seller["s"].get(f"{API}/collateral/{fake}/pdf", timeout=15).status_code == 404
    assert seller["s"].patch(f"{API}/outreach/campaigns/{fake}", json={"name": "x"}, timeout=15).status_code == 404
    assert seller["s"].delete(f"{API}/inquiries/{fake}", timeout=15).status_code == 404
    assert seller["s"].delete(f"{API}/deal-rooms/{fake}", timeout=15).status_code == 404
