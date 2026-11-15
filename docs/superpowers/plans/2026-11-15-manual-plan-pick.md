# Manual Plan Pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Settings on the booth computer, let the user switch between Automatic and a hand-picked Planning Center plan and service time, reverting to Automatic at local midnight.

**Architecture:** A saved `pco_manual` setting short-circuits `PCO.pick()`: no ProPresenter matching; it returns the chosen plan's `detail()` with its times rebased to today and narrowed to the chosen time. Two pure helpers hold the date logic so it can be unit-tested. The page gets a three-dropdown picker in Settings and a Manual tag on every screen.

**Tech Stack:** Node (Electron main-process `server.js`), plain HTML/JS page (`index.html`), tests with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-15-manual-plan-pick-design.md`

## Global Constraints

- Plan list window: 14 days back, 42 days ahead.
- Reset at local midnight on the booth Mac (`isoDay(new Date())` differs from `pco_manual.day`).
- Default time choice: "By the clock" (`time: ''`).
- The plan list and plan times are booth-only (403 for other devices), like `/api/options`.
- No new dependencies. The published page still goes through `tools/publish_update.py` (compat step).

## Review Focus

- A pick made yesterday must not show after midnight, even if the app was closed over midnight → `manualActive` is false for yesterday's `day`.
- The chosen time was deleted or changed in Planning Center → fall back to By the clock (all times), not an empty time list.
- A plan with no service times → the order still shows; no crash in `manualTimes`.
- Going back to Automatic takes effect within one poll (the PCO client is rebuilt on save, so no stale manual cache).
- No Planning Center token → the picker shows a message and stays on Automatic.

---

### Task 1: Date helpers (pure)

**Files:** Modify `src/server.js` (beside `serviceStart`); Create `tests/manual-pick.test.js`

**Interfaces:**
- Produces: `manualActive(manual, now: Date) -> boolean` and `manualTimes(times: {name, starts_at}[], manual, now: Date) -> {name, starts_at}[]`, both exported.

- [ ] Tests: `manualActive` is true for today's `day` and false for yesterday's, null, or a missing `plan_id`. `manualTimes` rebases a 2026-11-08 09:00 and 11:00 to 2026-11-15 at the same local clock times; with `time` set to the 11:00 `starts_at` it returns only that time; with a `time` that isn't in the list it returns all times; with `[]` it returns `[]`.
- [ ] Run `node --test tests/` → FAIL, then implement → PASS.

### Task 2: Server wiring

**Files:** Modify `src/server.js`: `PCO` constructor and `pick()`, `StatusService.poll`, `saveConfig`, `publicSettings`, `handle()`, `buildState`.

**Interfaces:**
- Consumes: `manualActive`, `manualTimes`.
- Produces: `GET /api/plans?st=<id>` → `{ plans: [{id, label, day}], error }`; `GET /api/plan_times?st=<id>&plan=<id>` → `{ times: [{name, starts_at}], error }`; the `pco_manual` setting; `state.pco.manual = { label } | null`.

- [ ] `pick()`: when `this.manual` is set, `detail({id: plan_id, st, ...labels})`, then return a copy with `times = manualTimes(...)` and `manual: { label }`.
- [ ] `poll()`: when `cfg.pco_manual` is set but `!manualActive(...)`, `saveConfig({ pco_manual: null })`.
- [ ] Verify with curl on the test copy (port 8799, real PCO token, read-only): plans list, times list, a POSTed manual pick shows that plan, and a pick with yesterday's `day` is cleared within one poll.

### Task 3: Settings picker

**Files:** Modify `src/index.html` (Settings sheet markup and `openSettings`, `fillOptions`, `saveSettings`).

- [ ] "Plan to show" select (Automatic / Pick one); when Pick one, show Service type → Plan → Service time selects, loaded from the endpoints in order, plus a "Back to Automatic" button. Save sends `pco_manual` with today's `day`, or `null`.
- [ ] Verify in the browser: pick → save → the header shows the picked plan.

### Task 4: Manual tag on every screen

**Files:** Modify `src/index.html` (`render`, `renderTV`, `renderStage` headers; CSS).

- [ ] A "Manual" pill next to the service name on booth, phone/iPad and /tv, and in the /stage footer, shown when `s.pco.manual` is set, with the plan label as its tooltip.
- [ ] Run `ui_check.py` on all four screens (must stay PASS), then publish 2.0.15.
