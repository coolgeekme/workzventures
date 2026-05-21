"""
Workz Ventures · Security Service
- OpenTimestamps: Bitcoin-anchored proof-of-existence for events & files
- AES-256-GCM at-rest encryption for Vault binaries
- Hash-chained audit-log helpers

Pure standards: no third-party API keys; OTS uses free public calendar servers.
"""
import asyncio
import base64
import hashlib
import io
import json
import logging
import os
from typing import List, Optional, Dict, Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from opentimestamps.core.timestamp import Timestamp, DetachedTimestampFile
from opentimestamps.core.op import OpSHA256
from opentimestamps.core.serialize import StreamSerializationContext, StreamDeserializationContext
from opentimestamps.core.notary import BitcoinBlockHeaderAttestation

logger = logging.getLogger("workz.security")

# ---------------------------------------------------------------------------
# CALENDAR CONFIG (free public OpenTimestamps calendars; no key required)
# ---------------------------------------------------------------------------
CALENDARS = [
    "https://alice.btc.calendar.opentimestamps.org",
    "https://bob.btc.calendar.opentimestamps.org",
    "https://finney.calendar.eternitywall.com",
]

USER_AGENT = "workz-ventures/1.0"
DEFAULT_TIMEOUT = 8.0

# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------
def sha256_bytes(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_event_hash(payload: dict) -> bytes:
    """Stable SHA-256 of a JSON-serializable event payload (sorted keys)."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(blob)


# ---------------------------------------------------------------------------
# OpenTimestamps — submit + serialize + upgrade + verify
# ---------------------------------------------------------------------------
async def _submit_one(client: httpx.AsyncClient, base_url: str, digest: bytes) -> Optional[Timestamp]:
    try:
        r = await client.post(
            f"{base_url}/digest",
            content=digest,
            headers={"Accept": "application/vnd.opentimestamps.v1", "User-Agent": USER_AGENT},
            timeout=DEFAULT_TIMEOUT,
        )
        if r.status_code != 200 or not r.content:
            logger.warning(f"OTS calendar {base_url} returned {r.status_code}")
            return None
        ctx = StreamDeserializationContext(io.BytesIO(r.content))
        return Timestamp.deserialize(ctx, digest)
    except Exception as e:
        logger.warning(f"OTS calendar {base_url} failed: {e}")
        return None


async def stamp_digest(digest: bytes) -> bytes:
    """
    Submit a 32-byte SHA-256 digest to multiple OTS calendars and return
    the serialized .ots file bytes (DetachedTimestampFile).
    Returns the .ots binary even if only one calendar responds.
    Raises RuntimeError if every calendar fails.
    """
    if len(digest) != 32:
        raise ValueError("digest must be 32 bytes (SHA-256)")
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_submit_one(client, c, digest) for c in CALENDARS])
    successful = [t for t in results if t is not None]
    if not successful:
        raise RuntimeError("All OTS calendars unreachable")

    # Merge calendar responses into a single timestamp
    base = successful[0]
    for other in successful[1:]:
        try:
            base.merge(other)
        except Exception as e:
            logger.warning(f"OTS merge failed (continuing with primary): {e}")

    dtf = DetachedTimestampFile(OpSHA256(), base)
    buf = io.BytesIO()
    dtf.serialize(StreamSerializationContext(buf))
    return buf.getvalue()


def parse_ots(ots_bytes: bytes) -> DetachedTimestampFile:
    """Parse .ots file bytes into a DetachedTimestampFile."""
    ctx = StreamDeserializationContext(io.BytesIO(ots_bytes))
    return DetachedTimestampFile.deserialize(ctx)


def find_btc_attestation(ts: Timestamp) -> Optional[Dict[str, Any]]:
    """Walk a Timestamp tree and return Bitcoin attestation info if present."""
    for attestation in ts.attestations:
        if isinstance(attestation, BitcoinBlockHeaderAttestation):
            return {"block_height": int(attestation.height)}
    for sub in ts.ops.values():
        found = find_btc_attestation(sub)
        if found is not None:
            return found
    return None


def _collect_pending_commitments(ts: Timestamp, current_commit: bytes, out: List[Dict[str, Any]]):
    """Walk timestamp tree collecting all pending-calendar commitments (digest, calendar_url)."""
    from opentimestamps.core.notary import PendingAttestation
    for attestation in ts.attestations:
        if isinstance(attestation, PendingAttestation):
            try:
                uri = attestation.uri
            except Exception:
                uri = None
            out.append({"commit_hex": current_commit.hex(), "calendar_url": uri})
    for op, sub in ts.ops.items():
        try:
            next_commit = op.call(current_commit)
        except Exception:
            next_commit = current_commit
        _collect_pending_commitments(sub, next_commit, out)


async def upgrade_ots(ots_bytes: bytes) -> Dict[str, Any]:
    """
    Attempt to upgrade a pending OTS proof: query each calendar's /timestamp/<commit>
    endpoint to fetch the Bitcoin-anchored extension of the timestamp.
    Returns {"upgraded": bool, "ots_bytes": bytes, "btc_block_height": int|None}.
    """
    dtf = parse_ots(ots_bytes)
    ts = dtf.timestamp

    # Already confirmed?
    btc = find_btc_attestation(ts)
    if btc is not None:
        return {"upgraded": False, "ots_bytes": ots_bytes, "btc_block_height": btc["block_height"]}

    pending: List[Dict[str, Any]] = []
    _collect_pending_commitments(ts, ts.msg, pending)

    if not pending:
        return {"upgraded": False, "ots_bytes": ots_bytes, "btc_block_height": None}

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        upgraded_any = False
        for entry in pending:
            url = entry.get("calendar_url")
            commit_hex = entry.get("commit_hex")
            if not url or not commit_hex:
                continue
            try:
                r = await client.get(
                    f"{url}/timestamp/{commit_hex}",
                    headers={"Accept": "application/vnd.opentimestamps.v1", "User-Agent": USER_AGENT},
                )
                if r.status_code != 200 or not r.content:
                    continue
                commit_digest = bytes.fromhex(commit_hex)
                upgraded_ts = Timestamp.deserialize(
                    StreamDeserializationContext(io.BytesIO(r.content)),
                    commit_digest,
                )
                # Find sub-timestamp matching this commit and merge in
                _merge_at_commit(ts, ts.msg, commit_digest, upgraded_ts)
                upgraded_any = True
            except Exception as e:
                logger.warning(f"OTS upgrade fetch failed for {url}: {e}")

    btc = find_btc_attestation(ts)
    buf = io.BytesIO()
    new_dtf = DetachedTimestampFile(dtf.file_hash_op, ts)
    new_dtf.serialize(StreamSerializationContext(buf))
    return {
        "upgraded": upgraded_any,
        "ots_bytes": buf.getvalue(),
        "btc_block_height": btc["block_height"] if btc else None,
    }


def _merge_at_commit(ts: Timestamp, current_commit: bytes, target_commit: bytes, replacement: Timestamp):
    """Walk the tree and merge `replacement` at the node whose commit matches target."""
    if current_commit == target_commit:
        try:
            ts.merge(replacement)
        except Exception:
            pass
        return
    for op, sub in ts.ops.items():
        try:
            next_commit = op.call(current_commit)
        except Exception:
            continue
        _merge_at_commit(sub, next_commit, target_commit, replacement)


def verify_ots(ots_bytes: bytes, original_digest: bytes) -> Dict[str, Any]:
    """
    Best-effort offline verification: parse the .ots, confirm it stamps the given digest,
    and report any Bitcoin attestation found in the tree.
    For *cryptographic* Bitcoin verification, callers should query a full node — this
    function reports the attested block height which downstream UI links to a public
    explorer.
    """
    dtf = parse_ots(ots_bytes)
    parsed_digest = bytes(dtf.timestamp.msg)
    matches = parsed_digest == original_digest
    btc = find_btc_attestation(dtf.timestamp)
    return {
        "matches_digest": matches,
        "stamped_digest_hex": parsed_digest.hex(),
        "btc_block_height": btc["block_height"] if btc else None,
        "pending": btc is None,
    }


# ---------------------------------------------------------------------------
# AES-256-GCM file encryption (envelope: 12-byte nonce || ciphertext+tag)
# ---------------------------------------------------------------------------
_MASTER_KEY: Optional[bytes] = None


def _get_master_key() -> bytes:
    global _MASTER_KEY
    if _MASTER_KEY is None:
        b64 = os.environ.get("WORKZ_FILE_ENCRYPTION_KEY")
        if not b64:
            raise RuntimeError("WORKZ_FILE_ENCRYPTION_KEY not configured")
        _MASTER_KEY = base64.b64decode(b64)
        if len(_MASTER_KEY) != 32:
            raise RuntimeError("WORKZ_FILE_ENCRYPTION_KEY must decode to 32 bytes (AES-256)")
    return _MASTER_KEY


def encryption_configured() -> bool:
    return bool(os.environ.get("WORKZ_FILE_ENCRYPTION_KEY"))


def encrypt_bytes(plaintext: bytes, associated_data: Optional[bytes] = None) -> Dict[str, Any]:
    """Returns dict with envelope (nonce||ct+tag), nonce, ciphertext_only, all as raw bytes."""
    key = _get_master_key()
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext, associated_data)
    envelope = nonce + ct
    return {
        "envelope": envelope,
        "nonce": nonce,
        "ciphertext_with_tag": ct,
        "alg": "AES-256-GCM",
    }


def decrypt_envelope(envelope: bytes, associated_data: Optional[bytes] = None) -> bytes:
    key = _get_master_key()
    aes = AESGCM(key)
    if len(envelope) < 12 + 16:
        raise ValueError("Envelope too short")
    nonce, ct = envelope[:12], envelope[12:]
    return aes.decrypt(nonce, ct, associated_data)


# ---------------------------------------------------------------------------
# Audit-log hash-chain helpers
# ---------------------------------------------------------------------------
GENESIS_HASH = "0" * 64  # hex string


def compute_content_hash(entry: dict) -> str:
    """Stable hash of an audit entry (excluding chain metadata)."""
    payload = {
        "id": entry["id"],
        "actor_id": entry.get("actor_id"),
        "action": entry.get("action"),
        "target": entry.get("target"),
        "meta": entry.get("meta") or {},
        "timestamp": entry.get("timestamp"),
        "prev_hash": entry.get("prev_hash", GENESIS_HASH),
        "seq": entry.get("seq", 0),
    }
    return canonical_event_hash(payload).hex()
