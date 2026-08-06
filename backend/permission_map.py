"""Endpoint -> permission mapping (Phase 1.75b).

Each entry says which permission key an endpoint requires. This is kept as
data, separate from the conversion itself, so the mapping can be reviewed on
its own — a wrong entry here either locks people out or exposes data, and that
is much easier to spot in a table than spread across 85 edits.

`check_parity.py` compares every entry against the role gate currently in
`server.py`. Any disagreement is reported rather than silently accepted.

Entries marked ADMIN_ONLY keep their existing admin-only gate; they are
platform operations with no meaningful non-admin equivalent.
"""

from typing import Dict

ADMIN_ONLY = "__admin_only__"

ENDPOINT_PERMISSIONS: Dict[str, str] = {
    # --- Deals -------------------------------------------------------------
    "POST /listings": "deals.create",
    "DELETE /listings/{lid}/staged-files/{file_id}": "deals.stage_files",

    # --- Buyer discovery ---------------------------------------------------
    "GET /buyer-discovery/overview": "buyers.read",
    "GET /buyer-discovery/listings/{lid}/matches": "buyers.read",
    "POST /buyer-discovery/listings/{lid}/scan": "buyers.run",
    "PATCH /buyer-discovery/matches/{mid}": "buyers.run",
    "DELETE /buyer-discovery/matches/{mid}": "buyers.run",
    "POST /buyer-discovery/matches/{mid}/find-contacts": "buyers.run",
    "POST /buyer-discovery/matches/{mid}/generate-outreach": "buyers.run",
    "POST /buyer-discovery/matches/{mid}/add-to-leads": "leads.manage",
    "POST /buyer-discovery/matches/{mid}/contacts/{contact_idx}/add-to-leads": "leads.manage",

    # --- Buyer alerts ------------------------------------------------------
    "GET /buyer-alerts": "alerts.read",
    "GET /buyer-alerts/count": "alerts.read",
    "PATCH /buyer-alerts/{aid}/seen": "alerts.manage",
    "POST /buyer-alerts/mark-all-seen": "alerts.manage",
    "DELETE /buyer-alerts/{aid}": "alerts.manage",

    # --- Research ----------------------------------------------------------
    "POST /research/detailed": "research.create",
    "GET /research/detailed": ADMIN_ONLY,
    "DELETE /research/detailed/{rid}": ADMIN_ONLY,

    # --- Engagement --------------------------------------------------------
    "POST /newsletter/draft": "newsletter.send",
    "GET /newsletter/recipient-candidates": "newsletter.send",
    "POST /newsletter/personal": "newsletter.personal",
    "POST /collateral/{cid}/send-to-inquiry": ADMIN_ONLY,

    # --- Pipeline ----------------------------------------------------------
    "POST /inquiries/{inquiry_id}/open-room": "vault.manage",
    "PATCH /inquiries/{iid}/status": ADMIN_ONLY,

    # --- Platform ----------------------------------------------------------
    # Pushing a lead to Zoho is a lead action, not general integration admin —
    # mapping it to integrations.manage would hand it to every buyer.
    "POST /composio/zoho/push-lead/{inquiry_id}": "leads.manage",
    "GET /security/audit/verify": "audit.read",
    "POST /admin/demo/purge": ADMIN_ONLY,
    "POST /admin/listings/{lid}/sources/cleanup-corrupt": ADMIN_ONLY,
}

# Endpoints whose gate the parser resolved but which are NOT whole-endpoint
# gates — the role check guards a branch inside the handler, not entry to it.
# Listed explicitly so parity doesn't flag them and so the conversion skips them.
BRANCH_LEVEL_ONLY = {
    "GET /auth/me",
}
