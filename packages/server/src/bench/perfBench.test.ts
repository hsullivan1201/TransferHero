import assert from 'node:assert/strict'
import {
  DEFAULT_PERF_GATE_THRESHOLDS,
  evaluatePerfGate,
  type PerfBenchSummary
} from './perfBench.js'

function makeSummary(overrides: Partial<PerfBenchSummary> = {}): PerfBenchSummary {
  const base: PerfBenchSummary = {
    rows: [
      {
        key: 'parseUpdatesToTrains',
        metric: 'parse',
        oldMs: 100,
        newMs: 50,
        cpuGain: 50,
        oldMem: 1,
        newMem: 1,
        memGain: 0
      },
      {
        key: 'getArrivalAtStation',
        metric: 'arrival',
        oldMs: 100,
        newMs: 10,
        cpuGain: 90,
        oldMem: 1,
        newMem: 1,
        memGain: 0
      },
      {
        key: 'findDepartedTrains',
        metric: 'departed',
        oldMs: 100,
        newMs: 10,
        cpuGain: 90,
        oldMem: 1,
        newMem: 1,
        memGain: 0
      },
      {
        key: 'fetchDestinationArrivals',
        metric: 'destination',
        oldMs: 100,
        newMs: 10,
        cpuGain: 90,
        oldMem: 1,
        newMem: 1,
        memGain: 0
      }
    ],
    coalescing: {
      oldUpstreamCalls: 120,
      newUpstreamCalls: 1,
      duplicateCallReduction: 99.2
    },
    freshness: {
      railOldSec: 75,
      railNewSec: 40,
      railGain: 46.7,
      busOldSec: 360,
      busNewSec: 40,
      busGain: 88.9
    }
  }

  return {
    ...base,
    ...overrides,
    rows: overrides.rows ?? base.rows,
    coalescing: overrides.coalescing ?? base.coalescing,
    freshness: overrides.freshness ?? base.freshness
  }
}

function gatePassesForExpectedNumbers() {
  const summary = makeSummary()
  const failures = evaluatePerfGate(summary)

  assert.deepEqual(failures, [])
  console.log('✓ perf gate passes for baseline benchmark values')
}

function gateFailsWhenRegressionDropsBelowThreshold() {
  const summary = makeSummary({
    rows: [
      {
        key: 'parseUpdatesToTrains',
        metric: 'parse',
        oldMs: 100,
        newMs: 70,
        cpuGain: 30,
        oldMem: 1,
        newMem: 1,
        memGain: 0
      },
      ...makeSummary().rows.slice(1)
    ],
    coalescing: {
      oldUpstreamCalls: 100,
      newUpstreamCalls: 20,
      duplicateCallReduction: 80
    }
  })

  const failures = evaluatePerfGate(summary, DEFAULT_PERF_GATE_THRESHOLDS)
  assert.ok(failures.some(f => f.includes('parseUpdatesToTrains CPU gain')))
  assert.ok(failures.some(f => f.includes('Coalescing duplicate call reduction')))
  console.log('✓ perf gate fails when CPU or coalescing regress below thresholds')
}

gatePassesForExpectedNumbers()
gateFailsWhenRegressionDropsBelowThreshold()
console.log('perf bench gate tests passed')
