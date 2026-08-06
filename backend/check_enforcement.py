"""Post-conversion check: does each mapped endpoint enforce the right permission?

`check_parity.py` validated the map against the OLD gates before conversion.
This validates the CONVERTED code: every mapped endpoint must either call
require_permission / scope_for with its mapped key, or be admin-only — and no
mapped endpoint may still carry an old inline role tuple.
"""
import io, re, sys
from permission_map import ENDPOINT_PERMISSIONS, ADMIN_ONLY

lines = io.open("server.py", encoding="utf-8").read().split("\n")
dec = re.compile(r'@api_router\.(get|post|put|delete|patch)\("([^"]+)"')
order = []
for i, l in enumerate(lines):
    m = dec.search(l)
    if m: order.append((f"{m.group(1).upper()} {m.group(2)}", i))
spans = {}
for n, (k, i) in enumerate(order):
    spans.setdefault(k, (i, order[n+1][1] if n+1 < len(order) else len(lines)))

fail = 0
for ep, perm in sorted(ENDPOINT_PERMISSIONS.items()):
    if ep not in spans:
        print(f"MISSING ENDPOINT  {ep}"); fail += 1; continue
    a, b = spans[ep]
    body = "\n".join(lines[a:b])
    stale = 'user.get("role") not in (' in body
    if perm == ADMIN_ONLY:
        ok = 'user.get("role") != "admin"' in body or 'user.get("role") not in ("admin"' in body
        note = "admin-only (unchanged)"
    else:
        ok = f'"{perm}"' in body and ("require_permission(" in body or "scope_for(" in body)
        note = f"enforces {perm}"
    if stale and perm != ADMIN_ONLY:
        ok = False; note += "  [STALE role tuple still present]"
    print(f"{'ok  ' if ok else 'FAIL'}  {ep:56} {note}")
    if not ok: fail += 1

print(f"\nchecked {len(ENDPOINT_PERMISSIONS)} mapped endpoints, {fail} problem(s)")
sys.exit(1 if fail else 0)
