"""Iter-56 — Orphaned-job reaper: on startup, valuations stuck in
`autofill_status="pending"` (because a fire-and-forget background task
died with the previous process) must be reset to `failed` so the polling
UI unblocks immediately instead of spinning for 6 minutes.

This runs an integration-style test against a live Mongo instance using
the same env the server uses.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _now_iso(): return datetime.now(timezone.utc).isoformat()
def _iso_ago(**kw): return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


async def _run_reaper(db):
    """Mirror of the reaper block in server.py `seed_demo()` startup."""
    cutoff = _iso_ago(minutes=1)
    return await db.valuations.update_many(
        {"autofill_status": "pending",
         "$or": [{"autofilled_at": {"$lt": cutoff}}, {"autofilled_at": {"$exists": False}}, {"autofilled_at": None}],
         "updated_at": {"$lt": cutoff}},
        {"$set": {
            "autofill_status": "failed",
            "autofill_error": "Job interrupted by server restart — click Re-autofill to retry.",
            "updated_at": _now_iso(),
        }},
    )


@pytest.mark.asyncio
async def test_reaper_resets_stale_pending_to_failed():
    if not os.environ.get("MONGO_URL"):
        pytest.skip("no MONGO_URL configured")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    vid = str(uuid.uuid4())
    old = _iso_ago(hours=2)
    await db.valuations.insert_one({
        "id": vid, "user_id": "reaper_test", "company_name": "REAPER_STALE",
        "autofill_status": "pending",
        "updated_at": old,
    })
    try:
        result = await _run_reaper(db)
        assert result.modified_count >= 1

        doc = await db.valuations.find_one({"id": vid})
        assert doc["autofill_status"] == "failed"
        assert "restart" in doc["autofill_error"].lower()
    finally:
        await db.valuations.delete_one({"id": vid})


@pytest.mark.asyncio
async def test_reaper_leaves_recent_pending_alone():
    """A pending row updated seconds ago (a legit in-flight job) must NOT
    be reaped — reaper only touches jobs that missed at least one minute."""
    if not os.environ.get("MONGO_URL"):
        pytest.skip("no MONGO_URL configured")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    vid = str(uuid.uuid4())
    await db.valuations.insert_one({
        "id": vid, "user_id": "reaper_test", "company_name": "REAPER_FRESH",
        "autofill_status": "pending",
        "updated_at": _now_iso(),  # right now
    })
    try:
        await _run_reaper(db)
        doc = await db.valuations.find_one({"id": vid})
        assert doc["autofill_status"] == "pending", "reaper must not touch fresh pending rows"
    finally:
        await db.valuations.delete_one({"id": vid})


@pytest.mark.asyncio
async def test_reaper_leaves_completed_and_failed_alone():
    if not os.environ.get("MONGO_URL"):
        pytest.skip("no MONGO_URL configured")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    ids = [str(uuid.uuid4()) for _ in range(2)]
    old = _iso_ago(hours=2)
    await db.valuations.insert_many([
        {"id": ids[0], "user_id": "reaper_test", "company_name": "REAPER_DONE",
         "autofill_status": "completed", "updated_at": old},
        {"id": ids[1], "user_id": "reaper_test", "company_name": "REAPER_DEAD",
         "autofill_status": "failed", "updated_at": old},
    ])
    try:
        await _run_reaper(db)
        docs = await db.valuations.find({"id": {"$in": ids}}).to_list(10)
        statuses = {d["id"]: d["autofill_status"] for d in docs}
        assert statuses[ids[0]] == "completed"
        assert statuses[ids[1]] == "failed"
    finally:
        await db.valuations.delete_many({"id": {"$in": ids}})
