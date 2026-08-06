"""Compare the permission map against the role gates currently in server.py.

For every mapped endpoint: which roles does the OLD gate allow, and which roles
does the NEW permission grant? They must match, or the conversion changes who
can do what — which is exactly the failure this step exists to prevent.
"""
import io, re, sys
from permission_map import ENDPOINT_PERMISSIONS, ADMIN_ONLY, BRANCH_LEVEL_ONLY
from permissions import SYSTEM_ROLES

def old_gates(path="server.py"):
    lines = io.open(path, encoding="utf-8").read().split("\n")
    dec = re.compile(r'@api_router\.(get|post|put|delete|patch)\("([^"]+)"')
    tup = re.compile(r'user\.get\("role"\)\s*not in\s*\(([^)]*)\)')
    neq = re.compile(r'user\.get\("role"\)\s*!=\s*"([a-z_]+)"')
    ep, out = None, {}
    for l in lines:
        m = dec.search(l)
        if m: ep = f"{m.group(1).upper()} {m.group(2)}"
        if 'user.get("role")' not in l or not ep: continue
        t = l.strip()
        if (mt := tup.search(t)):
            out.setdefault(ep, set()).update(x.strip().strip('"') for x in mt.group(1).split(",") if x.strip())
        elif (mn := neq.search(t)) and " and " not in t:
            out.setdefault(ep, set()).add(mn.group(1))
    return out

roles = {r["key"]: r["permissions"] for r in SYSTEM_ROLES}
old = old_gates()
fail = 0

print(f"{'endpoint':56} {'old gate':30} {'new grant':30} verdict")
print("-" * 130)
for ep, perm in sorted(ENDPOINT_PERMISSIONS.items()):
    o = old.get(ep)
    if o is None:
        print(f"{ep:56} {'(no gate found)':30} {perm:30} REVIEW")
        fail += 1; continue
    if perm == ADMIN_ONLY:
        n = {"admin"}
    else:
        n = {k for k, perms in roles.items() if perms.get(perm, "none") != "none"}
    ok = (o == n)
    if not ok: fail += 1
    print(f"{ep:56} {','.join(sorted(o))[:29]:30} {','.join(sorted(n))[:29]:30} {'ok' if ok else 'MISMATCH'}")

unmapped = sorted(set(old) - set(ENDPOINT_PERMISSIONS) - BRANCH_LEVEL_ONLY)
print(f"\nmapped: {len(ENDPOINT_PERMISSIONS)}   mismatches: {fail}   unmapped gates: {len(unmapped)}")
for u in unmapped: print("  unmapped:", u)
sys.exit(1 if fail else 0)
