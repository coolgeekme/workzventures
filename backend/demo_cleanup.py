"""
Demo account data retention.

Demo accounts (alex/mira/admin @ workz.example.com) are evaluation-only.
Anything they create is purged 48 hours after creation, while seed data
(listings, deals, the demo users themselves) is preserved so the platform
always demonstrates working features.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Tuple

from bson import ObjectId

logger = logging.getLogger("workz.demo_cleanup")

DEMO_EMAILS = {
    "alex@workz.example.com",
    "mira@workz.example.com",
    "admin@workz.example.com",
}
DEMO_RETENTION_HOURS = 48
SCHEDULER_INTERVAL_SECONDS = 60 * 60  # hourly sweep

# Collections whose row carries a top-level "user_id" pointing at the creator.
USER_OWNED_COLLECTIONS: List[str] = [
    "research",
    "detailed_reports",
    "collateral",
    "outreach",
    "newsletters",
    "leads",
    "watchlist",
    "agent_activity",
    "composio_connections",
]


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cutoff_iso() -> str:
    return (_now_utc() - timedelta(hours=DEMO_RETENTION_HOURS)).isoformat()


async def get_demo_user_ids(db) -> List[str]:
    cur = db.users.find({"email": {"$in": list(DEMO_EMAILS)}}, {"_id": 0, "id": 1})
    return [u["id"] async for u in cur]


async def _delete_gridfs(bucket, gridfs_id: str) -> None:
    try:
        await bucket.delete(ObjectId(gridfs_id))
    except Exception as e:
        logger.debug(f"gridfs delete skipped {gridfs_id}: {e}")


async def _purge_deal_rooms(db, demo_ids: Iterable[str], cutoff: str,
                            gridfs_bucket, listing_files_bucket) -> Tuple[int, int]:
    """Cascade-delete deal rooms (and their files / findings / messages / requests)."""
    demo_ids = list(demo_ids)
    rooms = await db.deal_rooms.find(
        {
            "$and": [
                {"$or": [{"buyer_id": {"$in": demo_ids}}, {"seller_id": {"$in": demo_ids}}]},
                {"created_at": {"$lt": cutoff}},
                {"is_seed": {"$ne": True}},
            ]
        },
        {"_id": 0, "id": 1},
    ).to_list(None)
    if not rooms:
        return 0, 0
    room_ids = [r["id"] for r in rooms]

    # Delete GridFS blobs for files attached to these rooms
    files_cur = db.deal_room_files.find(
        {"room_id": {"$in": room_ids}, "gridfs_id": {"$exists": True}},
        {"_id": 0, "gridfs_id": 1},
    )
    files_deleted = 0
    async for f in files_cur:
        if f.get("gridfs_id"):
            await _delete_gridfs(gridfs_bucket, f["gridfs_id"])
            files_deleted += 1

    await db.deal_room_files.delete_many({"room_id": {"$in": room_ids}})
    await db.deal_room_findings.delete_many({"room_id": {"$in": room_ids}})
    await db.deal_room_messages.delete_many({"room_id": {"$in": room_ids}})
    await db.deal_room_requests.delete_many({"room_id": {"$in": room_ids}})
    res = await db.deal_rooms.delete_many({"id": {"$in": room_ids}})
    return res.deleted_count, files_deleted


async def _purge_inquiries(db, demo_ids: Iterable[str], cutoff: str) -> int:
    demo_ids = list(demo_ids)
    rows = await db.inquiries.find(
        {
            "$and": [
                {"$or": [{"buyer_id": {"$in": demo_ids}}, {"seller_id": {"$in": demo_ids}}]},
                {"created_at": {"$lt": cutoff}},
                {"is_seed": {"$ne": True}},
            ]
        },
        {"_id": 0, "id": 1},
    ).to_list(None)
    if not rows:
        return 0
    ids = [r["id"] for r in rows]
    await db.inquiry_messages.delete_many({"inquiry_id": {"$in": ids}})
    res = await db.inquiries.delete_many({"id": {"$in": ids}})
    return res.deleted_count


async def _purge_listings(db, demo_ids: Iterable[str], cutoff: str,
                          listing_files_bucket) -> Tuple[int, int]:
    demo_ids = list(demo_ids)
    listings = await db.listings.find(
        {
            "seller_id": {"$in": demo_ids},
            "created_at": {"$lt": cutoff},
            "is_seed": {"$ne": True},
        },
        {"_id": 0, "id": 1},
    ).to_list(None)
    if not listings:
        return 0, 0
    lids = [li["id"] for li in listings]

    staged_cur = db.listing_staged_files.find(
        {"listing_id": {"$in": lids}}, {"_id": 0, "gridfs_id": 1}
    )
    staged_deleted = 0
    async for s in staged_cur:
        if s.get("gridfs_id"):
            await _delete_gridfs(listing_files_bucket, s["gridfs_id"])
            staged_deleted += 1
    await db.listing_staged_files.delete_many({"listing_id": {"$in": lids}})

    # Buyer Discovery artifacts tied to demo listings
    await db.buyer_matches.delete_many({"listing_id": {"$in": lids}})
    await db.buyer_alerts.delete_many({"listing_id": {"$in": lids}})
    await db.buyer_scans.delete_many({"listing_id": {"$in": lids}})

    res = await db.listings.delete_many({"id": {"$in": lids}})
    return res.deleted_count, staged_deleted


async def _purge_user_owned(db, demo_ids: Iterable[str], cutoff: str) -> int:
    demo_ids = list(demo_ids)
    total = 0
    for col in USER_OWNED_COLLECTIONS:
        res = await db[col].delete_many(
            {
                "user_id": {"$in": demo_ids},
                "created_at": {"$lt": cutoff},
                "is_seed": {"$ne": True},
            }
        )
        total += res.deleted_count
    return total


async def _purge_seller_alerts(db, demo_ids: Iterable[str], cutoff: str) -> int:
    """Buyer alerts/matches/scans that survived listing purge but belong to demo sellers."""
    demo_ids = list(demo_ids)
    total = 0
    for col in ("buyer_matches", "buyer_alerts", "buyer_scans"):
        res = await db[col].delete_many(
            {"seller_id": {"$in": demo_ids}, "created_at": {"$lt": cutoff}}
        )
        total += res.deleted_count
    return total


async def _purge_private_locker(db, demo_ids: Iterable[str], cutoff: str,
                                private_locker_bucket) -> Tuple[int, int]:
    demo_ids = list(demo_ids)
    rows = await db.private_locker_files.find(
        {
            "user_id": {"$in": demo_ids},
            "created_at": {"$lt": cutoff},
            "is_seed": {"$ne": True},
        },
        {"_id": 0, "id": 1, "gridfs_id": 1},
    ).to_list(None)
    if not rows:
        return 0, 0
    blobs_deleted = 0
    for r in rows:
        if r.get("gridfs_id"):
            await _delete_gridfs(private_locker_bucket, r["gridfs_id"])
            blobs_deleted += 1
    res = await db.private_locker_files.delete_many({"id": {"$in": [r["id"] for r in rows]}})
    return res.deleted_count, blobs_deleted


async def purge_demo_data(db, gridfs_bucket, listing_files_bucket, private_locker_bucket=None) -> dict:
    """One pass: returns counts per category."""
    demo_ids = await get_demo_user_ids(db)
    if not demo_ids:
        return {"skipped": "no demo users"}
    cutoff = _cutoff_iso()

    rooms, room_files = await _purge_deal_rooms(
        db, demo_ids, cutoff, gridfs_bucket, listing_files_bucket
    )
    inquiries = await _purge_inquiries(db, demo_ids, cutoff)
    listings, staged_files = await _purge_listings(db, demo_ids, cutoff, listing_files_bucket)
    user_owned = await _purge_user_owned(db, demo_ids, cutoff)
    seller_alerts = await _purge_seller_alerts(db, demo_ids, cutoff)
    locker_rows, locker_blobs = (0, 0)
    if private_locker_bucket is not None:
        locker_rows, locker_blobs = await _purge_private_locker(
            db, demo_ids, cutoff, private_locker_bucket
        )

    summary = {
        "cutoff": cutoff,
        "demo_user_count": len(demo_ids),
        "deleted": {
            "deal_rooms": rooms,
            "deal_room_files": room_files,
            "inquiries": inquiries,
            "listings": listings,
            "listing_staged_files": staged_files,
            "user_owned_rows": user_owned,
            "seller_buyer_discovery_rows": seller_alerts,
            "private_locker_files": locker_rows,
            "private_locker_blobs": locker_blobs,
        },
        "at": _now_utc().isoformat(),
    }
    logger.info(f"demo_cleanup pass: {summary['deleted']}")
    return summary


async def demo_cleanup_scheduler(db, gridfs_bucket, listing_files_bucket,
                                 private_locker_bucket=None) -> None:
    """Hourly sweep. Started from server.py on_event('startup')."""
    # Initial pass shortly after boot so stale data is gone before the user logs in
    await asyncio.sleep(30)
    while True:
        try:
            await purge_demo_data(db, gridfs_bucket, listing_files_bucket, private_locker_bucket)
        except Exception as e:
            logger.warning(f"demo cleanup loop error: {e}")
        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)
