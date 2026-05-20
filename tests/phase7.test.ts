import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import {
  MetricsCollector,
  formatMetricsReport,
  metricsToJson,
  type DemoMetrics
} from '../src/demo/metrics-collector'
import {
  DemoRunner,
  type DemoRunnerOptions,
  type DemoScenario
} from '../src/demo/demo-runner'

/**
 * Phase 7 tests: Demo framework + metrics collection.
 * No real Minecraft server needed; we test the plumbing in isolation.
 */

describe('MetricsCollector', () => {
  it('records tick samples and computes distance', () => {
    const mc = new MetricsCollector({ sampleInterval: 1 })
    mc.recordTick(new Vec3(0, 64, 0), new Vec3(0, 0, 0), true, { forward: true, sprint: false })
    mc.recordTick(new Vec3(1, 64, 0), new Vec3(0.2, 0, 0), true, { forward: true, sprint: false })
    mc.recordTick(new Vec3(2, 64, 0), new Vec3(0.2, 0, 0), true, { forward: true, sprint: true })

    const m = mc.buildMetrics('walk', true, undefined, 5)
    expect(m.success).toBe(true)
    expect(m.distanceTraveled).toBeCloseTo(2, 1)
    expect(m.positionSamples).toBe(3)
    expect(m.controlChanges).toBe(1) // sprint toggled on tick 3
    expect(m.groundTimePct).toBe(1)
    expect(m.airTimePct).toBe(0)
  })

  it('computes speeds correctly', () => {
    const mc = new MetricsCollector({ sampleInterval: 1 })
    mc.recordTick(new Vec3(0, 64, 0), new Vec3(0.2, 0, 0), true, {})
    mc.recordTick(new Vec3(0, 64, 1), new Vec3(0, 0, 0.3), true, {})

    const m = mc.buildMetrics('speed', true)
    expect(m.avgSpeed).toBeGreaterThan(0)
    expect(m.maxSpeed).toBeGreaterThanOrEqual(m.avgSpeed)
    expect(m.minSpeed).toBeLessThanOrEqual(m.avgSpeed)
  })

  it('tracks air vs ground time', () => {
    const mc = new MetricsCollector({ sampleInterval: 1 })
    mc.recordTick(new Vec3(0, 64, 0), new Vec3(0, 0, 0), true, {})
    mc.recordTick(new Vec3(0, 65, 0), new Vec3(0, 0.4, 0), false, {})
    mc.recordTick(new Vec3(0, 66, 0), new Vec3(0, 0.4, 0), false, {})

    const m = mc.buildMetrics('jump', true)
    expect(m.groundTimePct).toBeCloseTo(1 / 3, 2)
    expect(m.airTimePct).toBeCloseTo(2 / 3, 2)
  })

  it('resets state cleanly', () => {
    const mc = new MetricsCollector()
    mc.recordTick(new Vec3(0, 64, 0), new Vec3(0, 0, 0), true, {})
    mc.reset()
    const m = mc.buildMetrics('reset-test', true)
    expect(m.distanceTraveled).toBe(0)
    expect(m.positionSamples).toBe(0)
  })
})

describe('formatMetricsReport', () => {
  it('renders a success run', () => {
    const m: DemoMetrics = {
      scenario: 'Parkour',
      startTime: 0,
      endTime: 5000,
      durationMs: 5000,
      success: true,
      pathLengthNodes: 12,
      distanceTraveled: 42.5,
      avgSpeed: 0.18,
      maxSpeed: 0.35,
      minSpeed: 0.05,
      groundTimePct: 0.7,
      airTimePct: 0.3,
      controlChanges: 45,
      positionSamples: 100
    }
    const report = formatMetricsReport(m)
    expect(report).toContain('Parkour')
    expect(report).toContain('YES')
    expect(report).toContain('42.50 blocks')
    expect(report).toContain('12')
  })

  it('renders a failed run with reason', () => {
    const m: DemoMetrics = {
      scenario: 'PvP',
      startTime: 0,
      endTime: 2000,
      durationMs: 2000,
      success: false,
      failureReason: 'No target player',
      pathLengthNodes: 0,
      distanceTraveled: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      minSpeed: 0,
      groundTimePct: 0,
      airTimePct: 0,
      controlChanges: 0,
      positionSamples: 0
    }
    const report = formatMetricsReport(m)
    expect(report).toContain('NO')
    expect(report).toContain('No target player')
  })
})

describe('metricsToJson', () => {
  it('round-trips through JSON', () => {
    const m: DemoMetrics = {
      scenario: 'Escape',
      startTime: 0,
      endTime: 1000,
      durationMs: 1000,
      success: true,
      pathLengthNodes: 8,
      distanceTraveled: 30,
      avgSpeed: 0.2,
      maxSpeed: 0.4,
      minSpeed: 0.1,
      groundTimePct: 0.8,
      airTimePct: 0.2,
      controlChanges: 20,
      positionSamples: 50
    }
    const json = metricsToJson(m)
    const parsed = JSON.parse(json) as DemoMetrics
    expect(parsed.scenario).toBe('Escape')
    expect(parsed.distanceTraveled).toBe(30)
  })
})

describe('DemoRunnerOptions', () => {
  it('has sensible defaults', () => {
    const opts: DemoRunnerOptions = {}
    expect(opts.host).toBeUndefined()
    expect(opts.port).toBeUndefined()
    expect(opts.username).toBeUndefined()
    expect(opts.autoDisconnect).toBeUndefined()
  })
})

describe('DemoScenario interface (type check)', () => {
  it('accepts a valid scenario object', () => {
    const scenario: DemoScenario = {
      name: 'Test',
      run: async (_bot, _plugin, _collector) => {
        // no-op
      }
    }
    expect(scenario.name).toBe('Test')
  })
})
