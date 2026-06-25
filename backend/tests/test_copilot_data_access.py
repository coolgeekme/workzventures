"""Vault Co-pilot must access every file in the data room — including ones
mirrored from Composio external sources — AND must NOT block the request
beyond Cloudflare's 100 s edge timeout regardless of vault size.

This file replaces the earlier `test_copilot_data_access.py` after the
endpoint was converted to a background-job pattern (iter-33). It tests:
  - The HTTP handler returns <0.5 s with `{job_id, user_message}`
  - `_run_copilot_job` builds the right per-page inventory
  - 200-file cap, dynamic char budget, [filename p.N] citations
  - Composio-mirrored files surface via the backfill-clone path
  - Failure path: Claude exceptions mark job 'failed' (never stuck)
"""

import os
import sys
import secrets
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


async def _seed_vault_with_files(db, *, file_count, composio_files=None):
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
    composio_set = set(composio_files or [])
    for i in range(file_count):
        is_composio = i in composio_set
        await db.deal_room_files.insert_one({
            "id": f"f-{i}-{secrets.token_hex(2)}",
            "room_id": rid,
            "filename": f"file_{i:03d}{'_composio' if is_composio else ''}.pdf",
            "folder": "other",
            "content_type": "application/pdf",
            "size_bytes": 1024,
            "page_count": 3,
            "pages": [
                {"page": 1, "text": f"Header page for file {i}. Key fact: revenue Y{i} = $1,234,567."},
                {"page": 2, "text": f"Body of file {i}. Customer concentration: {i*5}% top-3."},
                {"page": 3, "text": f"Tail of file {i}. Signed by Party {i}."},
            ],
            "content": f"flat text for file {i}",
            "source": {"kind": "box", "sid": "sid-1", "external_id": f"box-{i}"} if is_composio else None,
            "uploaded_at": now,
        })
    return {"rid": rid, "buyer_id": buyer_id, "seller_id": seller_id}


async def _cleanup(db, fixture):
    await db.deal_rooms.delete_one({"id": fixture["rid"]})
    await db.deal_room_files.delete_many({"room_id": fixture["rid"]})
    await db.deal_room_messages.delete_many({"room_id": fixture["rid"]})
    await db.copilot_jobs.delete_many({"room_id": fixture["rid"]})
    await db.users.delete_many({"id": {"$in": [fixture["buyer_id"], fixture["seller_id"]]}})


async def _spawn_job(db, rid, user_id, question="What's the customer concentration?"):
    """Match what `ask_copilot` does to set up a job row + user message,
    so the test can then drive `_run_copilot_job` directly."""
    import uuid as _u
    user_msg_id = str(_u.uuid4())
    job_id = str(_u.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.deal_room_messages.insert_one({
        "id": user_msg_id, "room_id": rid, "role": "user", "user_id": user_id,
        "user_name": "B", "content": question, "citations": [], "created_at": now,
    })
    await db.copilot_jobs.insert_one({
        "id": job_id, "room_id": rid, "user_message_id": user_msg_id,
        "requested_by": user_id, "status": "pending", "question": question,
        "created_at": now, "started_at": None, "finished_at": None, "error": None,
    })
    return job_id, user_msg_id


# ─────────────────────────────────────────────────────────────────────
# Background job — inventory + citation parsing
# ─────────────────────────────────────────────────────────────────────
class TestCopilotJob:
    @pytest.mark.asyncio
    async def test_composio_mirrored_files_appear_in_inventory(self):
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=8, composio_files=[5, 6, 7])
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Per [file_005_composio.pdf p.2], top-3 customers represent 25%."

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")

            # The Composio file MUST appear in the prompt inventory with its source tag.
            assert "file_005_composio.pdf" in captured["user"]
            assert "source=box" in captured["user"]
            assert "<page n=" in captured["user"]

            # Job marked completed; assistant message written with citation.
            job = await server.db.copilot_jobs.find_one({"id": job_id}, {"_id": 0})
            assert job["status"] == "completed"
            assert job["assistant_message_id"]
            assert job["citation_count"] == 1
            asst = await server.db.deal_room_messages.find_one(
                {"id": job["assistant_message_id"]}, {"_id": 0},
            )
            assert asst["citations"][0]["filename"] == "file_005_composio.pdf"
            assert asst["citations"][0]["page"] == 2
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_120_files_no_truncation_warning(self):
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=120, composio_files=list(range(115, 120)))
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Answer."
            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")
            for i in [0, 50, 100, 115, 119]:
                assert f"file_{i:03d}" in captured["user"], f"file {i} missing from inventory"
            assert "only the 200 oldest" not in captured["user"]
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_220_files_truncation_warning(self):
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=220)
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Answer."
            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")
            assert "only the 200 oldest" in captured["user"]
            assert "220 files" in captured["user"]
            job = await server.db.copilot_jobs.find_one({"id": job_id}, {"_id": 0})
            assert job["truncated"] is True
            assert job["total_files_in_room"] == 220
            assert job["files_analyzed"] == 200
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_legacy_citation_defaults_to_page_1(self):
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=3)
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            async def fake_claude(*a, **kw):
                return "Per [file_001.pdf], revenue grew 22%."
            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")
            job = await server.db.copilot_jobs.find_one({"id": job_id}, {"_id": 0})
            asst = await server.db.deal_room_messages.find_one(
                {"id": job["assistant_message_id"]}, {"_id": 0},
            )
            assert asst["citations"][0]["filename"] == "file_001.pdf"
            assert asst["citations"][0]["page"] == 1
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_clone_backfill_fires_regardless_of_status(self):
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=1)
        await server.db.deal_rooms.update_one(
            {"id": fixture["rid"]}, {"$set": {"status": "closing", "listing_id": "L-test"}},
        )
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            backfill_called = []
            async def fake_backfill(listing_id, room_id, user_id, only_missing=False):
                backfill_called.append((listing_id, room_id, only_missing))
                return 0
            async def fake_claude(*a, **kw): return "Answer."
            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room",
                              AsyncMock(side_effect=fake_backfill)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")
            assert backfill_called, "backfill must run for closing-status rooms too"
            assert backfill_called[0][0] == "L-test"
            assert backfill_called[0][2] is True
        finally:
            await _cleanup(server.db, fixture)


# ─────────────────────────────────────────────────────────────────────
# Cloudflare 524 root cause — HTTP handler must return immediately
# ─────────────────────────────────────────────────────────────────────
class TestCopilotHandlerReturnsImmediately:
    @pytest.mark.asyncio
    async def test_post_returns_under_half_second_no_synchronous_claude(self):
        """The HTTP entry point MUST return without awaiting the Claude
        call — this is what makes Cloudflare's 100 s edge timeout
        impossible to hit, regardless of vault size."""
        import server
        # 50-file vault — would have taken 60+ s synchronously.
        fixture = await _seed_vault_with_files(server.db, file_count=50)
        try:
            claude_calls = []
            async def slow_claude(*a, **kw):
                claude_calls.append(True)
                await asyncio.sleep(0.05)  # tiny so the bg task still finishes for cleanup
                return "Answer."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=slow_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                started = datetime.now(timezone.utc)
                result = await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Hi"),
                    user=fake_user,
                )
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()

            assert elapsed < 0.5, f"handler took {elapsed:.2f}s — must be near-instant"
            assert result["status"] == "pending"
            assert "job_id" in result
            assert result["user_message"]["content"] == "Hi"
            # Give the background task a moment to finish so we don't leak.
            await asyncio.sleep(0.3)
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_failed_job_marks_status_failed_not_stuck(self):
        """When Claude raises, the job is marked failed with the error
        string. Frontend stops polling on terminal status."""
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=2)
        try:
            job_id, msg_id = await _spawn_job(server.db, fixture["rid"], fixture["buyer_id"])
            async def boom(*a, **kw):
                raise RuntimeError("upstream Claude 429")
            with patch.object(server, "call_claude", AsyncMock(side_effect=boom)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                await server._run_copilot_job(job_id, fixture["rid"], fixture["buyer_id"],
                                                "B", msg_id, "Q?")
            job = await server.db.copilot_jobs.find_one({"id": job_id}, {"_id": 0})
            assert job["status"] == "failed"
            assert "429" in (job["error"] or "")
            assert job["finished_at"] is not None
        finally:
            await _cleanup(server.db, fixture)
