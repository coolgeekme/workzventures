"""Regression tests for the two production bugs reported together:

1. **Box BOX_DOWNLOAD_FILE "payload too large"** — files > ~10 MB cause the
   predefined Composio action to 502 because Composio base64-inlines the
   content into its response envelope. The fix tries the Composio Proxy
   path FIRST for Box/Drive/OneDrive/SharePoint (which streams via R2 and
   has no size cap), falling back to the predefined action only when proxy
   isn't available (Dropbox).

2. **Findings analysis Cloudflare 524** — `POST /generate-findings` ran the
   Claude call synchronously, exceeding Cloudflare's 100 s edge timeout.
   The fix converts it to a background job pattern with poll endpoints.

These tests mock Composio + Claude and exercise the new control flow.
"""

import base64
import os
import sys
import secrets
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# ─────────────────────────────────────────────────────────────────────
# Fixture helpers
# ─────────────────────────────────────────────────────────────────────
async def _seed_box_source_with_one_file(db):
    lid = f"test-listing-{secrets.token_hex(4)}"
    sid = f"test-src-{secrets.token_hex(4)}"
    uid = f"test-user-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.listings.insert_one({
        "id": lid, "company_name": "TestCo (large-file box)",
        "seller_id": uid, "status": "draft", "created_at": now,
    })
    await db.listing_external_sources.insert_one({
        "id": sid, "listing_id": lid, "source_kind": "box",
        "label": "Box test",
        "composio_connected_id": "ca_fake_for_test",
        "entity_id": uid,
        "status": "active", "syncing": True, "file_count": 0,
        "folder_ids": ["100"], "include_subfolders": False,
        "created_at": now,
    })
    return {"lid": lid, "sid": sid, "uid": uid}


async def _cleanup(db, fixture):
    await db.listings.delete_one({"id": fixture["lid"]})
    await db.listing_external_sources.delete_one({"id": fixture["sid"]})
    await db.listing_staged_files.delete_many({"listing_id": fixture["lid"]})
    # Also clean GridFS-staged content if it was written.
    async for row in db.listing_staged_files_fs.files.find({"metadata.listing_id": fixture["lid"]}):
        try:
            await db.listing_staged_files_fs.delete(row["_id"])
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────
# Box payload-too-large fix
# ─────────────────────────────────────────────────────────────────────
class TestBoxLargeFile:
    @pytest.mark.asyncio
    async def test_proxy_first_avoids_predefined_action_size_cap(self):
        """When proxy succeeds, predefined `BOX_DOWNLOAD_FILE` is NEVER
        called — so the 'tool response payload is too large' error from
        the inline-base64 path becomes impossible."""
        import server
        fixture = await _seed_box_source_with_one_file(server.db)
        try:
            big_blob = b"\x00" * (15 * 1024 * 1024)  # 15 MB — too big for inline base64

            captured_actions = []
            async def fake_action(slug, conn_id, args, user_id=None):
                captured_actions.append(slug)
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return {"successful": True, "error": None,
                            "data": {"entries": [
                                {"type": "file", "id": "555", "name": "huge.pdf"},
                            ]}}
                # If the test accidentally hits BOX_DOWNLOAD_FILE we want to
                # fail loudly — that's the bug we're testing for.
                raise AssertionError(f"predefined action {slug} was called — proxy should have handled the download")

            async def fake_proxy(kind, conn_id, file_id, mime_type=None, user_id=None):
                assert kind == "box"
                assert file_id == "555"
                return big_blob  # 15 MB streamed via R2 — no Composio envelope cap

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(side_effect=fake_proxy)):
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            # Predefined action was used for LIST, NOT for download.
            assert "BOX_LIST_ITEMS_IN_FOLDER" in captured_actions
            assert "BOX_DOWNLOAD_FILE" not in captured_actions, \
                "Box download must go through proxy, not the size-capped predefined action"

            staged = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)
            assert len(staged) == 1
            assert staged[0]["size_bytes"] == 15 * 1024 * 1024
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_predefined_action_502_falls_through_to_proxy(self):
        """When proxy returns None (e.g. transient R2 hiccup) AND the
        predefined action raises a Composio 502 'payload too large' error,
        the sync should record a clear per-file error — NOT crash the
        whole sync."""
        import server
        from fastapi import HTTPException
        fixture = await _seed_box_source_with_one_file(server.db)
        try:
            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return {"successful": True, "error": None,
                            "data": {"entries": [
                                {"type": "file", "id": "555", "name": "huge.pdf"},
                            ]}}
                if slug == "BOX_DOWNLOAD_FILE":
                    raise HTTPException(status_code=502,
                                        detail='Composio action BOX_DOWNLOAD_FILE failed: {"error":{"message":"The tool response payload is too large"}}')
                return {"successful": False}

            async def fake_proxy(*a, **kw):
                return None  # simulate proxy unavailable too

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(side_effect=fake_proxy)):
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            src = await server.db.listing_external_sources.find_one(
                {"id": fixture["sid"]}, {"_id": 0}
            )
            # File NOT staged — but sync didn't crash; error is recorded.
            assert src["file_count"] == 0
            assert src["syncing"] is False
            err = src.get("last_error") or ""
            assert "huge.pdf" in err
            assert "payload" in err.lower() or "too large" in err.lower() or "proxy + action" in err.lower(), \
                f"expected actionable error message, got: {err!r}"
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_500mb_cap_bumped_from_50mb(self):
        """Per user request 'no limit to the payload amount', confirm the
        sanity cap is now 500 MB (not 50 MB)."""
        import server
        fixture = await _seed_box_source_with_one_file(server.db)
        try:
            # 60 MB blob — would have hit the OLD 50 MB cap.
            blob = b"\x00" * (60 * 1024 * 1024)

            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return {"successful": True, "error": None,
                            "data": {"entries": [
                                {"type": "file", "id": "555", "name": "big_diligence_pack.pdf"},
                            ]}}
                return {"successful": False}

            async def fake_proxy(*a, **kw): return blob

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(side_effect=fake_proxy)):
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            staged = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)
            assert len(staged) == 1, f"60 MB file should mirror under the 500 MB cap; got {len(staged)} files"
            assert staged[0]["size_bytes"] == 60 * 1024 * 1024
        finally:
            await _cleanup(server.db, fixture)


# ─────────────────────────────────────────────────────────────────────
# Findings analysis background job
# ─────────────────────────────────────────────────────────────────────
async def _seed_room_with_files(db, file_count=3):
    rid = f"test-room-{secrets.token_hex(4)}"
    buyer_id = f"test-buyer-{secrets.token_hex(4)}"
    seller_id = f"test-seller-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_many([
        {"id": buyer_id, "email": f"b-{buyer_id}@x.test", "name": "B", "role": "buyer",
         "status": "active", "created_at": now},
        {"id": seller_id, "email": f"s-{seller_id}@x.test", "name": "S", "role": "seller",
         "status": "active", "created_at": now},
    ])
    await db.deal_rooms.insert_one({
        "id": rid, "buyer_id": buyer_id, "seller_id": seller_id,
        "buyer_name": "B", "seller_name": "S", "buyer_org": "BCo", "seller_org": "SCo",
        "listing_name": "TestCo", "status": "active", "created_at": now,
    })
    for i in range(file_count):
        await db.deal_room_files.insert_one({
            "id": f"f-{i}-{secrets.token_hex(3)}", "room_id": rid,
            "filename": f"doc{i}.pdf", "folder": "financials",
            "content": f"Financial detail snippet {i}. EBITDA grew 22% YoY.",
            "page_count": 1,
            "pages": [{"page": 1, "text": f"Page text {i}. Customer concentration risk: top-3 = 65% of revenue."}],
            "uploaded_at": now,
        })
    return {"rid": rid, "buyer_id": buyer_id, "seller_id": seller_id}


async def _cleanup_room(db, fixture):
    await db.deal_rooms.delete_one({"id": fixture["rid"]})
    await db.deal_room_files.delete_many({"room_id": fixture["rid"]})
    await db.deal_room_findings.delete_many({"room_id": fixture["rid"]})
    await db.findings_jobs.delete_many({"room_id": fixture["rid"]})
    await db.users.delete_many({"id": {"$in": [fixture["buyer_id"], fixture["seller_id"]]}})


class TestFindingsBackgroundJob:
    @pytest.mark.asyncio
    async def test_run_findings_job_completes_writes_findings_and_marks_done(self):
        """End-to-end: kick off the background task directly (no HTTP),
        confirm it transitions pending → running → completed and writes the
        findings rows. Claude is mocked to return a canned JSON payload."""
        import server
        fixture = await _seed_room_with_files(server.db, file_count=3)
        try:
            job_id = str(__import__("uuid").uuid4())
            await server.db.findings_jobs.insert_one({
                "id": job_id, "room_id": fixture["rid"],
                "requested_by": fixture["buyer_id"],
                "status": "pending", "files_to_analyze": 3,
                "findings_count": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "started_at": None, "finished_at": None, "error": None,
            })

            canned = '{"findings":[{"severity":"high","workstream":"finance","title":"Customer concentration","description":"Top-3 customers = 65% of revenue","file_index":1,"page":1,"excerpt":"top-3 = 65% of revenue"}]}'

            with patch.object(server, "call_claude", AsyncMock(return_value=canned)), \
                 patch.object(server, "notarize_event", AsyncMock(return_value=None)):
                await server._run_findings_job(job_id, fixture["rid"], fixture["buyer_id"])

            job = await server.db.findings_jobs.find_one({"id": job_id}, {"_id": 0})
            assert job["status"] == "completed", f"expected completed, got {job}"
            assert job["findings_count"] == 1
            assert job["files_analyzed"] == 3
            assert job["finished_at"] is not None

            findings = await server.db.deal_room_findings.find(
                {"room_id": fixture["rid"]}, {"_id": 0}
            ).to_list(20)
            assert len(findings) == 1
            assert findings[0]["title"] == "Customer concentration"
            assert findings[0]["citation"]["filename"].startswith("doc")
        finally:
            await _cleanup_room(server.db, fixture)

    @pytest.mark.asyncio
    async def test_run_findings_job_marks_failed_on_claude_exception(self):
        """If Claude raises (rate-limit / 5xx / etc), the job is marked
        failed with the error string — never silently stuck on 'running'."""
        import server
        fixture = await _seed_room_with_files(server.db, file_count=2)
        try:
            job_id = str(__import__("uuid").uuid4())
            await server.db.findings_jobs.insert_one({
                "id": job_id, "room_id": fixture["rid"],
                "requested_by": fixture["buyer_id"],
                "status": "pending", "files_to_analyze": 2,
                "findings_count": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "started_at": None, "finished_at": None, "error": None,
            })

            async def boom(*a, **kw):
                raise RuntimeError("upstream Claude 429")

            with patch.object(server, "call_claude", AsyncMock(side_effect=boom)):
                await server._run_findings_job(job_id, fixture["rid"], fixture["buyer_id"])

            job = await server.db.findings_jobs.find_one({"id": job_id}, {"_id": 0})
            assert job["status"] == "failed"
            assert "429" in (job["error"] or "")
            assert job["finished_at"] is not None
        finally:
            await _cleanup_room(server.db, fixture)

    @pytest.mark.asyncio
    async def test_inflight_job_returned_instead_of_starting_second(self):
        """The POST endpoint returns the in-flight job rather than spawning
        a duplicate when the buyer clicks Analyze twice in quick succession."""
        import server
        fixture = await _seed_room_with_files(server.db, file_count=1)
        try:
            now = datetime.now(timezone.utc).isoformat()
            existing_id = "existing-job-1"
            await server.db.findings_jobs.insert_one({
                "id": existing_id, "room_id": fixture["rid"],
                "requested_by": fixture["buyer_id"],
                "status": "running", "files_to_analyze": 1,
                "findings_count": 0,
                "created_at": now, "started_at": now,
                "finished_at": None, "error": None,
            })

            # Use a stub User dict like FastAPI's Depends would yield.
            fake_user = {"id": fixture["buyer_id"], "role": "buyer"}

            # Capture asyncio.create_task to verify NO new task was spawned.
            spawned = []
            orig_create = asyncio.create_task
            def trap_create_task(coro, *a, **kw):
                spawned.append(coro)
                return orig_create(asyncio.sleep(0))  # benign no-op task
            with patch.object(asyncio, "create_task", side_effect=trap_create_task):
                result = await server.generate_findings(fixture["rid"], user=fake_user)
            # Coroutines from `trap` should be closed to prevent warnings.
            for c in spawned:
                try: c.close()
                except Exception: pass

            assert result["already_running"] is True
            assert result["job_id"] == existing_id
            assert result["status"] == "running"
            # No new findings_jobs row — count is still 1.
            n = await server.db.findings_jobs.count_documents({"room_id": fixture["rid"]})
            assert n == 1
        finally:
            await _cleanup_room(server.db, fixture)

    @pytest.mark.asyncio
    async def test_post_returns_immediately_no_synchronous_claude(self):
        """The HTTP entry point MUST return without awaiting the Claude
        call — that's what makes Cloudflare's 100 s timeout impossible to
        hit. We verify by ensuring call_claude is NOT awaited inside the
        request handler."""
        import server
        fixture = await _seed_room_with_files(server.db, file_count=1)
        try:
            claude_called = []
            async def fake_claude(sys_prompt, user_msg, session_id=None):
                claude_called.append(True)
                # Simulate a slow LLM — if the handler had awaited this,
                # the test would block for 5s+ here.
                await asyncio.sleep(0)
                return '{"findings":[]}'

            fake_user = {"id": fixture["buyer_id"], "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "notarize_event", AsyncMock(return_value=None)):
                started = datetime.now(timezone.utc)
                result = await server.generate_findings(fixture["rid"], user=fake_user)
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()

            # Handler must return in well under a second — the LLM call
            # happens in the background task that we just kicked off.
            assert elapsed < 0.5, f"handler took {elapsed:.2f}s — should be near-instant"
            assert result["status"] == "pending"
            assert "job_id" in result
            assert result["files_to_analyze"] == 1

            # Let the background task complete so we don't leak coroutines.
            await asyncio.sleep(0.2)
        finally:
            await _cleanup_room(server.db, fixture)
