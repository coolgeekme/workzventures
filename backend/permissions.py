"""Configurable roles and permissions (Phase 1.75a — foundation).

Decision 6 of the Fund Manager roadmap: instead of hardcoding a fixed set of
profiles, admins define their own roles. A role is a map of

    permission key  ->  scope

where the key says *what* the role may do (``deals.create``) and the scope says
*whose records* it applies to (``own``, ``peers_and_below``, ``org``, ``all``).

The agreed visibility rule is ``peers_and_below``: you see your own records,
your peers' (people reporting to the same manager), and everyone beneath you in
the reporting line — but not your manager's.

STATUS: enforcing on the endpoints listed in `permission_map.py`. The
remaining ownership and org-role checks still run through their original
inline logic and are converted in the next pass.
"""

from typing import Any, Dict, List, Optional, Set

from fastapi import HTTPException

# --------------------------------------------------------------------------
# Permission catalogue
#
# Grouped by the module they belong to. Keep this list as the single source of
# truth — the admin UI (1.75c) renders directly from it, so a permission that
# isn't here cannot be granted.
# --------------------------------------------------------------------------

PERMISSIONS: Dict[str, str] = {
    # Deals (stored as `listings`; "Deal" is the user-facing name)
    "deals.read": "View deals",
    "deals.create": "Create deals",
    "deals.update": "Edit deals",
    "deals.delete": "Delete deals",
    "deals.stage_files": "Manage staged files on a deal",
    # Buy-side
    "marketplace.read": "Browse the marketplace",
    "research.read": "View research briefs",
    "research.create": "Generate research",
    # Deal marketing
    "collateral.read": "View collateral",
    "collateral.create": "Create collateral",
    "buyers.read": "View buyer discovery",
    "buyers.run": "Run buyer discovery scans",
    "outreach.read": "View outreach",
    "outreach.create": "Create outreach campaigns",
    "newsletter.read": "View newsletters",
    "newsletter.send": "Send newsletters",
    "newsletter.personal": "Send a personal newsletter",
    # Pipeline
    "inquiries.read": "View inquiries",
    "inquiries.respond": "Respond to inquiries",
    "alerts.read": "View buyer alerts",
    "alerts.manage": "Dismiss and manage buyer alerts",
    "leads.read": "View leads",
    "leads.manage": "Manage leads",
    # Diligence
    "vault.read": "View the Vault",
    "vault.manage": "Manage Vault access and files",
    "locker.read": "View the Private Locker",
    "locker.write": "Upload to the Private Locker",
    "valuations.read": "View valuations",
    "valuations.create": "Create valuations",
    # Funds (Phases 2-6)
    "funds.read": "View funds",
    "funds.create": "Create funds",
    "funds.manage": "Edit fund settings",
    "commitments.read": "View LP commitments",
    "commitments.manage": "Manage LP commitments",
    "capital.read": "View capital activity",
    "capital.manage": "Record capital calls and distributions",
    "portfolio.read": "View portfolio holdings",
    "portfolio.manage": "Manage portfolio holdings",
    # Platform
    "team.read": "View team members",
    "team.manage": "Invite and manage team members",
    "users.manage": "Administer platform users",
    "roles.manage": "Create and edit roles",
    "audit.read": "View audit logs",
    "automation.read": "View the Automation Monitor",
    "integrations.manage": "Manage integrations",
}

# --------------------------------------------------------------------------
# Scopes — ordered widest last, so `_widest` can pick the most permissive when
# a user holds several roles.
# --------------------------------------------------------------------------

SCOPES: List[str] = ["none", "own", "descendants", "peers_and_below", "org", "all"]
_SCOPE_RANK = {s: i for i, s in enumerate(SCOPES)}

SCOPE_LABELS: Dict[str, str] = {
    "none": "No access",
    "own": "Only their own records",
    "descendants": "Their own and everyone below them",
    "peers_and_below": "Their own, their peers', and everyone below them",
    "org": "Everything in their organization",
    "all": "Everything on the platform",
}


def widest_scope(scopes: List[str]) -> str:
    """When a user holds multiple roles, the most permissive scope wins."""
    best = "none"
    for s in scopes:
        if _SCOPE_RANK.get(s, -1) > _SCOPE_RANK[best]:
            best = s
    return best


# --------------------------------------------------------------------------
# System roles
#
# These reproduce exactly what each existing role can do today, so seeding them
# changes nothing. They are flagged `is_system` and cannot be deleted — an admin
# may clone one to build a custom role, but removing them would orphan every
# user currently holding that role.
# --------------------------------------------------------------------------

def _grant(keys: List[str], scope: str) -> Dict[str, str]:
    return {k: scope for k in keys}


_BUYER_KEYS = [
    "marketplace.read", "research.read", "research.create", "deals.read",
    "deals.stage_files", "newsletter.personal",
    "inquiries.read", "inquiries.respond", "vault.read", "valuations.read",
    "locker.read", "locker.write", "newsletter.read", "automation.read",
    "team.read", "integrations.manage",
]

_SELLER_KEYS = [
    "deals.read", "deals.create", "deals.update", "deals.delete",
    "collateral.read", "collateral.create", "buyers.read", "buyers.run",
    "outreach.read", "outreach.create", "inquiries.read", "inquiries.respond",
    "vault.read", "vault.manage", "leads.read", "leads.manage",
    "alerts.read", "alerts.manage",
    "newsletter.read", "newsletter.send", "automation.read", "team.read",
    "integrations.manage",
]

_FUND_MANAGER_KEYS = sorted(set(_SELLER_KEYS + [
    "valuations.read", "valuations.create", "locker.read", "locker.write",
    "research.read", "research.create", "deals.stage_files", "newsletter.personal",
    "funds.read", "funds.create", "funds.manage",
    "commitments.read", "commitments.manage",
    "capital.read", "capital.manage",
    "portfolio.read", "portfolio.manage",
]))

SYSTEM_ROLES: List[Dict[str, Any]] = [
    {
        "key": "admin",
        "name": "Admin",
        "description": "Full platform access.",
        "permissions": _grant(list(PERMISSIONS), "all"),
    },
    {
        "key": "buyer",
        "name": "Buyer",
        "description": "Acquire companies — research, marketplace, diligence.",
        "permissions": _grant(_BUYER_KEYS, "own"),
    },
    {
        "key": "seller",
        "name": "Seller",
        "description": "Market a portfolio — deals, collateral, outreach.",
        "permissions": _grant(_SELLER_KEYS, "own"),
    },
    {
        "key": "agent",
        "name": "Advisor",
        "description": "Broker / advisor working both sides.",
        "permissions": _grant(sorted(set(_BUYER_KEYS + _SELLER_KEYS)), "own"),
    },
    {
        "key": "fund_manager",
        "name": "Fund Manager",
        "description": "Run funds, LP relationships and the portfolio.",
        # "own" preserves current behaviour exactly — today a fund manager
        # sees only their own records everywhere scope is applied. Widening
        # to "org" is an admin decision, not a side effect of conversion.
        "permissions": _grant(_FUND_MANAGER_KEYS, "own"),
    },
]


async def seed_system_roles(db) -> int:
    """Insert any missing system roles. Idempotent — safe on every boot.

    Existing system roles are refreshed so a deploy that adds a permission key
    grants it to the built-in roles automatically. Custom roles are never
    touched.
    """
    written = 0
    for spec in SYSTEM_ROLES:
        existing = await db.roles.find_one({"key": spec["key"], "is_system": True})
        doc = {
            "key": spec["key"],
            "name": spec["name"],
            "description": spec["description"],
            "permissions": spec["permissions"],
            "is_system": True,
        }
        if existing:
            # Keep the id; refresh the permission map.
            await db.roles.update_one({"key": spec["key"], "is_system": True}, {"$set": doc})
        else:
            import uuid
            doc["id"] = str(uuid.uuid4())
            await db.roles.insert_one(doc)
            written += 1
    return written


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------

async def roles_for_user(db, user: dict) -> List[dict]:
    """Roles a user holds.

    Reads the new `role_ids` list if present, and always falls back to the
    legacy single `role` string so existing accounts keep working untouched.
    """
    docs: List[dict] = []
    role_ids = user.get("role_ids") or []
    if role_ids:
        docs = await db.roles.find({"id": {"$in": role_ids}}, {"_id": 0}).to_list(50)
    legacy = user.get("role")
    if legacy and not any(d.get("key") == legacy for d in docs):
        d = await db.roles.find_one({"key": legacy, "is_system": True}, {"_id": 0})
        if d:
            docs.append(d)
    return docs


async def scope_for(db, user: dict, permission: str) -> str:
    """Widest scope this user has for a permission, or "none"."""
    docs = await roles_for_user(db, user)
    return widest_scope([d.get("permissions", {}).get(permission, "none") for d in docs])


async def has_permission(db, user: dict, permission: str) -> bool:
    return await scope_for(db, user, permission) != "none"


# --------------------------------------------------------------------------
# Hierarchy
#
# The reporting line is a `manager_id` on the user record. These helpers turn
# a scope into the concrete set of user ids whose records are visible.
# --------------------------------------------------------------------------

async def _descendant_ids(db, user_id: str, max_depth: int = 12) -> Set[str]:
    """Everyone below this user in the reporting line."""
    found: Set[str] = set()
    frontier = [user_id]
    depth = 0
    while frontier and depth < max_depth:
        rows = await db.users.find(
            {"manager_id": {"$in": frontier}}, {"_id": 0, "id": 1}
        ).to_list(1000)
        ids = [r["id"] for r in rows if r["id"] not in found]
        if not ids:
            break
        found.update(ids)
        frontier = ids
        depth += 1
    return found


async def _peer_ids(db, user: dict) -> Set[str]:
    """Users reporting to the same manager. Empty when the user has none —
    top-level users have no peers rather than every other rootless user."""
    mgr = user.get("manager_id")
    if not mgr:
        return set()
    rows = await db.users.find({"manager_id": mgr}, {"_id": 0, "id": 1}).to_list(1000)
    return {r["id"] for r in rows if r["id"] != user["id"]}


async def visible_user_ids(db, user: dict, scope: str) -> Optional[Set[str]]:
    """User ids whose records are visible under `scope`.

    Returns None ONLY for `all` — the single scope that means no restriction.
    Every other scope resolves to a concrete set, so a mistake narrows access
    rather than exposing everything. Returns an empty set for `none`, which
    callers must treat as deny.
    """
    if scope == "all":
        return None
    if scope == "none":
        return set()

    if scope == "org":
        # Everyone sharing an org with this user, plus the user.
        rows = await db.org_memberships.find(
            {"user_id": user["id"]}, {"_id": 0, "org_id": 1}
        ).to_list(200)
        org_ids = [r["org_id"] for r in rows]
        if not org_ids:
            return {user["id"]}
        members = await db.org_memberships.find(
            {"org_id": {"$in": org_ids}}, {"_id": 0, "user_id": 1}
        ).to_list(5000)
        return {m["user_id"] for m in members} | {user["id"]}

    ids: Set[str] = {user["id"]}
    if scope in ("descendants", "peers_and_below"):
        ids |= await _descendant_ids(db, user["id"])
    if scope == "peers_and_below":
        ids |= await _peer_ids(db, user)
    return ids


# --------------------------------------------------------------------------
# Enforcement
# --------------------------------------------------------------------------

async def require_permission(db, user: dict, permission: str) -> str:
    """Raise 403 unless the user holds `permission`; return its scope.

    The scope is returned so callers that also need row filtering can pass it
    straight to `visible_user_ids` without a second lookup.
    """
    scope = await scope_for(db, user, permission)
    if scope == "none":
        raise HTTPException(
            status_code=403,
            detail=f"Your role does not allow this action ({permission})",
        )
    return scope
