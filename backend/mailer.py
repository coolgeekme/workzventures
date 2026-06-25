"""
Resend email helper — minimal, async, no SDK. Just an HTTP POST.

Env:
  RESEND_API_KEY        - bearer token (required for sends; logs+skip otherwise)
  RESEND_FROM_EMAIL     - "from" address; must be on a Resend-verified domain.
                          For unverified setups, "onboarding@resend.dev" works.
  FRONTEND_URL          - base URL used to build links inside the email body.
  REQUEST_NOTIFY_EMAIL  - inbox that receives "new access request" alerts.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

import httpx

logger = logging.getLogger("nextcapos.mailer")

RESEND_API_BASE = "https://api.resend.com"


def _config():
    return {
        "key": os.environ.get("RESEND_API_KEY"),
        "from": os.environ.get("RESEND_FROM_EMAIL") or "onboarding@resend.dev",
        "frontend_url": (os.environ.get("FRONTEND_URL") or "").rstrip("/"),
        "notify": os.environ.get("REQUEST_NOTIFY_EMAIL") or "",
    }


async def send_email(
    to: str | List[str],
    subject: str,
    html: str,
    *,
    reply_to: Optional[str] = None,
    text: Optional[str] = None,
) -> dict:
    cfg = _config()
    if not cfg["key"]:
        logger.warning("RESEND_API_KEY not set — skipping email '%s' to %s", subject, to)
        return {"skipped": True, "reason": "no api key"}

    to_list = [to] if isinstance(to, str) else to
    body: dict = {
        "from": cfg["from"],
        "to": to_list,
        "subject": subject,
        "html": html,
    }
    if text:
        body["text"] = text
    if reply_to:
        body["reply_to"] = reply_to

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{RESEND_API_BASE}/emails",
                headers={
                    "Authorization": f"Bearer {cfg['key']}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if r.status_code >= 300:
            logger.warning("Resend %s: %s", r.status_code, r.text[:300])
            return {"ok": False, "status": r.status_code, "body": r.text[:500]}
        return {"ok": True, "id": r.json().get("id")}
    except Exception as e:
        logger.exception("Resend send failed")
        return {"ok": False, "error": str(e)}


async def send_email_with_attachment(
    to: str,
    subject: str,
    html: str,
    *,
    attachment_filename: str,
    attachment_bytes: bytes,
    attachment_mime: str = "application/pdf",
    reply_to: Optional[str] = None,
) -> dict:
    """Like `send_email` but with one attachment. Resend's API accepts an
    `attachments: [{filename, content}]` array where `content` is the
    raw bytes base64-encoded. Used by the Findings PDF email share."""
    cfg = _config()
    if not cfg["key"]:
        logger.warning("RESEND_API_KEY not set — skipping attachment email '%s' to %s", subject, to)
        return {"skipped": True, "reason": "no api key"}
    import base64
    body: dict = {
        "from": cfg["from"],
        "to": [to],
        "subject": subject,
        "html": html,
        "attachments": [{
            "filename": attachment_filename,
            "content": base64.b64encode(attachment_bytes).decode("ascii"),
            "content_type": attachment_mime,
        }],
    }
    if reply_to:
        body["reply_to"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{RESEND_API_BASE}/emails",
                headers={
                    "Authorization": f"Bearer {cfg['key']}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if r.status_code >= 300:
            logger.warning("Resend attachment %s: %s", r.status_code, r.text[:300])
            return {"ok": False, "status": r.status_code, "body": r.text[:500]}
        return {"ok": True, "id": r.json().get("id")}
    except Exception as e:
        logger.exception("Resend attachment send failed")
        return {"ok": False, "error": str(e)}



def link(path: str) -> str:
    base = (os.environ.get("FRONTEND_URL") or "").rstrip("/")
    return f"{base}{path}" if base else path
