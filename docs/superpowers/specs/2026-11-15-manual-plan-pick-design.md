# Manual plan pick (Planning Center)

Approved 2026-11-15.

## Why

Automatic mode picks the Planning Center plan by matching what's open in ProPresenter, and picks the service time (9AM / 11AM) by the clock, switching 15 minutes before each start. The booth needs a way to override both by hand when that guess isn't what they want.

## Goals

- **Plan to show: Automatic / Pick one**, in Settings on the booth computer (Settings is already booth-only). Every phone, iPad and TV follows the booth.
- Pick one = three dropdowns from their Planning Center: **service type → plan → service time**.
  - Plans: that service type's plans from 14 days ago to 42 days ahead, labeled by date and series or title.
  - Service time: **By the clock** (default; the same 15-minutes-before rule as Automatic) or one specific time.
- **Back to Automatic at midnight**, local time on the booth Mac. The pick is saved with the date it was made, so this holds through app restarts.
- A **Manual** tag in the header of every screen (booth, phone/iPad, /tv, /stage) while a pick is on, plus a **Back to Automatic** button in Settings.

## Non-goals

- No change to ProPresenter matching, the confidence monitor or the timers.
- Phones and iPads can't change the pick.
- The existing "Service type" setting stays, and applies to Automatic only.

## Approaches

1. **Override inside the existing PCO client (chosen).** A saved `pco_manual` setting makes `PCO.pick()` skip the ProPresenter matching and return the chosen plan's detail, with its times narrowed to the chosen time. Everything downstream (order, vs plan, projections, run history) works unchanged.
2. Separate "manual plan" state outside the PCO client. Rejected: it duplicates detail/caching and every consumer would need to know about it.
3. Pick on each device. Rejected: the screens would disagree, and Settings is booth-only on purpose.

## Builder's calls

- When the picked plan isn't today's (a rehearsal on last week's plan, say), its service times move onto today at the same clock times, so "vs plan" and the projections stay meaningful.
- Config shape: `pco_manual: { st, st_name, plan_id, plan_label, time, time_name, day }`. `time` is '' for By the clock, otherwise the chosen `starts_at`. `day` is the local date it was picked.
- New booth-only endpoints: `GET /api/plans?st=<id>` and `GET /api/plan_times?st=<id>&plan=<id>`.
- `state.pco.manual = { label }` drives the tag.
