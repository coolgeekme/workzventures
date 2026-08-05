# NextCapOS Code Review — Iter-55 (2026-02-17)

**Status: READY WITH FIXES** — No confirmed HIGH/CRITICAL. Four MEDIUM reliability/maintainability defects + partial test coverage on new paths.

---

## Findings (ranked by impact)

### 🟡 MEDIUM [CONFIRMED] — Valuations stuck "pending" forever after a deploy/worker crash
- **Location**: `backend/server.py:3299` (`_run_autofill_job`), fired at `:3429`, `:3489`; no startup reaper.
- **Trigger**: A 60–180s autofill in flight when the backend restarts (happens on every deploy).
- **Defect**: `asyncio.create_task(...)` fire-and-forget with no persistence/recovery. On restart the coroutine dies; nothing resets `autofill_status` from `pending`.
- **Impact**: Workbench and Vault card spin for 6 min then say "refresh" — fair-value never arrives. Same class affects sync/findings/copilot jobs.
- **Fix**: On startup, sweep valuations with `autofill_status="pending"` older than N minutes → set to `failed` (or re-enqueue). Keep strong refs to running tasks.
- **Regression test**: Insert `autofill_status="pending"` with no running task → run startup hook → assert status transitions away from pending.

### 🟡 MEDIUM [LIKELY] — Zero database indexes; every query does a full collection scan
- **Location**: `backend/server.py` — 0 `create_index()` calls anywhere.
- **Hot paths affected**: `get_current_user` (every authenticated request), `login`, all list endpoints filtering on `id`, `user_id`, `email`, `token`, `listing_id`, `room_id`.
- **Impact**: Latency grows linearly with data. Auth and list endpoints degrade platform-wide as `users`, `audit_logs`, `deal_room_files` grow.
- **Fix**: Add indexes at startup on high-traffic filter fields:
  - `users.id`, `users.email`
  - `*.user_id` on listings, deal_rooms, valuations, findings, inquiries
  - `deal_room_files.room_id`
  - `audit_logs.seq`
- **Regression test**: `list_indexes()` post-startup asserts expected indexes exist.

### 🟡 MEDIUM [CONFIRMED] — 20+ inline role-gate copy-pastes instead of using the existing helper
- **Location**: `backend/server.py` — inline `if user.get("role") not in ("seller","admin","agent","fund_manager")` at ~20 sites (e.g. `:1824, 4758, 5164, 9475, 9972`) while `require_role()` already exists at `:329`.
- **Trigger**: Adding a role or endpoint — as happened with `fund_manager` in Iter-54.
- **Defect**: Each gate is hand-maintained. Iter-55 shows 7 write endpoints were missed, giving the entire Fund Manager role 403 on every write action until patched. Risk recurs on the next role added.
- **Impact**: Repeatable, role-wide broken-workflow regressions. Latent (not active) after Iter-55 patch.
- **Fix**: Replace inline tuples with `require_role(user, ROLE_SET)` dependency; define named role sets once.
- **Regression test**: Parametrized `@pytest.mark.parametrize` test asserting each write endpoint accepts every intended role.

### 🟡 MEDIUM [CONFIRMED] — `server.py` is an 11,676-line monolith (blocks focused testing)
- **Defect**: Route handlers, business logic, background jobs, Pydantic models, seeding, and integrations all live in one module. Focused unit tests and safe edits become hard — this is where the role-gate and orphan-job defects hide.
- **Impact**: Elevated regression risk on every change; blocks isolated testing of services.
- **Refactor plan (staged, do it in this order)**:
  1. **Extract Pydantic models** → `/app/backend/models/` (auth, listings, funds, valuations, deal_rooms, findings) — pure data classes, lowest risk.
  2. **Lift pure helpers** → `/app/backend/services/` (`require_role`, notarize, text extraction, `_merge_autofill_inputs`, workspace scoping, `safe_json_loads`).
  3. **Move background jobs** → `/app/backend/services/jobs.py` with a lifecycle registry — this also fixes finding #1 (orphan reaper).
  4. **Split routes** → `/app/backend/routes/{auth, admin, listings, inquiries, deal_rooms, valuations, funds, newsletter, composio}.py`, each mounting on `api_router`.
- **Attack order** (smallest / newest first): auth → funds → valuations → deal_rooms → listings.
- **Regression test**: Keep existing pytest suites green after each extraction.

---

## Top 5 tests to add

1. **`GET /funds` / `POST /funds` / `GET /funds/{id}` scoping** — manager sees own, org member sees org's, admin sees all, other role gets 403.
2. **`update_external_source_folders` wipe-then-resync** — mock old files present, verify `_wipe_external_source_files` runs before sync, `file_count` resets to 0.
3. **Orphaned `pending` autofill recovery** — insert stale pending row, run startup hook, assert transition.
4. **`admin/users/{uid}/purge` cascade + audit-chain integrity** — ensure related listings/vaults/valuations wiped, chain remains verifiable.
5. **Per-role write-endpoint authorization matrix** — locks finding #3, catches next role addition.

---

## Minor Issues (LOW)

- `zip_uploads.py:106` — error says "250 MB total" but real cap is now 1024 MB (Iter-52 stale message)
- `zip_uploads.py:109` — `> MAX_ZIP_FILES` allows 251 files (off-by-one)
- `create_fund` (`server.py:11615`) — stores `body.name.strip()` without rejecting empty/whitespace → blank-named fund in the switcher
- Stray useless expression `()` at `server.py:11676` (B018)
- ~9 unused imports (F401) and unused `inq` locals (F841 at `:9386, :9820`) — auth call still runs, only the var is unused
- Ruff: 612 findings total, overwhelmingly style (B008 / formatting)
- CORS defaults to `*` with `allow_credentials=True` (`server.py:11656`) — P3 (security audit territory)

---

## Frontend polling review

Traced `ValuationWorkbench.jsx:112` and `VaultValuationCard.jsx:54`:
- Intervals AND `visibilitychange` listeners cleaned up in effect returns ✅
- No memory leaks
- No material stale-closure / race conditions

Iter-44's rewrite holds up.

---

## Coverage & Limitations

**Complete**: Requirements compliance, API/schema contract, data integrity, state transition, error/partial-failure handling, frontend state/async, source structure, dead code / dependency hygiene, lint (ruff + ESLint — frontend clean).

**Partial**:
- Test adequacy — new funds / health-viz / orphan-job / authorization-matrix paths lack automated tests
- Resource bounds — index/scan impact inferred (no runtime load data captured)

**Not executed** (per read-only policy): DB / runtime perf profiling, exhaustive security audit (that's `security_audit_agent`).

---

## Verdict

**READY WITH FIXES**. Ship-ready today. Recommended sequence:
1. **This week** — Add DB indexes (finding #2) and orphan-job reaper (finding #1). Both are ~1 hour, huge wins.
2. **Next week** — Fix low-effort minors (empty fund name, stale zip error msg, remove dead code).
3. **This month** — Begin the server.py refactor (finding #4). Start with `models/` extraction and `funds` route split.
4. **Ongoing** — Fill test gaps as endpoints are touched (finding #3 authorization matrix should land with the role-gate refactor).
