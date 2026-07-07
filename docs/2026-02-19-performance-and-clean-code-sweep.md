# 2026-02-19: Performance + Clean Code Sweep

This doc summarizes what shipped in today's backend reliability/performance/clean-code push.

## Goals

- Reduce latency and CPU in train/bus critical paths without sacrificing data quality.
- Keep data fresher while avoiding unnecessary WMATA API traffic.
- Move toward a cleaner backend architecture (smaller route files, better boundaries).
- Add tests and CI gates so regressions are caught automatically.

## High-level outcome

- Hot-path train computations are substantially faster in synthetic benchmarks.
- Duplicate upstream WMATA calls were heavily reduced via coalescing.
- Worst-case freshness windows improved for rail and bus.
- `/api/trips` route logic was decomposed into a dedicated planner service.
- Added integration-style route pipeline tests.
- Added CI-enforced quality and perf gates.

## Performance and freshness work

### WMATA/rail service improvements

- Added in-flight request coalescing for station predictions and GTFS-RT requests.
- Added per-process WMATA upstream telemetry counters:
  - total calls
  - calls in last minute
  - calls in last 5 minutes
  - failures
- Exposed telemetry in `/api/health` under `wmataUpstream`.
- Kept stale-fallback behavior for resilience when WMATA responses fail.

### Benchmark and perf gate

- Added benchmark harness with structured output and gate mode:
  - `packages/server/src/bench/perfBench.ts`
- Added perf gate assertions (threshold-based) for:
  - CPU wins in key paths
  - duplicate-call reduction
  - freshness envelope improvements
- Added gate tests:
  - `packages/server/src/bench/perfBench.test.ts`

### Latest benchmark snapshot (CI run)

- `parseUpdatesToTrains`: `66.9%` faster
- `getArrivalAtStation`: `98.0%` faster
- `findDepartedTrains`: `92.9%` faster
- `fetchDestinationArrivals` fallback matching: `94.4%` faster
- Duplicate upstream-call reduction (same-key burst): `99.2%`
- Freshness envelope improvement:
  - rail: `46.7%` better worst-case age
  - bus: `88.9%` better worst-case age

Note: per-op heap deltas in this microbenchmark are very small/noisy; CPU/call/freshness metrics are the stable signal.

## Clean Code architecture work

### Route decomposition

- Replaced large trip route logic with planner service abstraction:
  - New planner: `packages/server/src/services/tripPlannerService.ts`
  - Route now focuses on validation/logging/wiring: `packages/server/src/routes/trips.ts`
- Added explicit route handler factory for easier test injection:
  - `createTripHandlers(...)`

### App composition split

- Added app factory module:
  - `packages/server/src/app.ts`
- Simplified server startup module:
  - `packages/server/src/index.ts`

This separates app wiring from startup side effects, making route-level testing simpler.

## Testing additions

### Integration-style route pipeline tests

Added `packages/server/src/routes/trips.integration.test.ts` to cover:

- Direct trip payload shape
- Trip cache hit behavior (no duplicate realtime calls)
- Stale fallback behavior during simulated upstream failure
- Leg2 pipeline behavior for transfer trips

These tests run through middleware + route handlers with deterministic injected planner deps.

### Existing tests expanded

- Added WMATA upstream stats test in `packages/server/src/services/wmata.test.ts`.

## CI quality/perf guardrails

### New scripts

Root (`package.json`):

- `npm run quality:check`
- `npm run perf:bench`
- `npm run perf:gate`
- `npm run ci` now includes quality + perf gates

Server (`packages/server/package.json`):

- `quality:check`
- `perf:bench`
- `perf:gate`
- test suite includes `trips.integration.test.ts` and `perfBench.test.ts`

### Quality gate

Added lightweight AST-based quality gate script:

- `packages/server/scripts/qualityGate.mjs`

Checks include:

- file-size ceilings (with explicit overrides where needed)
- function cyclomatic complexity ceilings
- import-boundary rules (e.g. route layer should not directly pull trip data internals)

## Validation summary

Full repo CI passed after changes:

- typecheck
- quality check
- tests (unit + route integration-style)
- perf gate
- production build

## Follow-up candidates

- Continue splitting very large service files (`busGtfsLoader`, `busRouteFinder`, `wmata`) into smaller modules.
- Add end-to-end HTTP tests in an environment that allows socket binding.
- Add performance trend tracking over time (persist perf gate outputs across CI runs).
