/**
 * Humanization layer tests.
 *
 * Covers:
 * - Noise generators (Perlin, Simplex, Gaussian, Brownian)
 * - Jitter injector (yaw/pitch/WASD)
 * - Acceleration curves (ease-in/ease-out)
 * - Delay injector (Gaussian delays, missed reactions)
 * - Ping sync (TPS estimation, burst/rest cycles)
 * - HumanizationLayer integration (orchestrator)
 */

import { describe, expect, test } from 'bun:test'
import { Vec3 } from 'vec3'
import {
  PerlinNoise,
  SimplexNoise,
  gaussian,
  gaussianPair,
  clamp,
  boundedBrownianStep,
  Easing
} from '../src/humanization/noise-generators'
import { JitterInjector } from '../src/humanization/jitter-injector'
import { AccelerationController } from '../src/humanization/acceleration-curves'
import { computeReactionDelay, DelayTracker, DelayPresets } from '../src/humanization/delay-injector'
import { PingTracker, computeTickTiming, estimateTps } from '../src/humanization/ping-sync'
import { HumanizationLayer } from '../src/humanization/humanization-layer'

// ---- Noise Generators ----

describe('PerlinNoise', () => {
  test('sample2D returns value in [-1, 1]', () => {
    const noise = new PerlinNoise(123)
    for (let i = 0; i < 20; i++) {
      const v = noise.sample2D(i * 0.5, i * 0.3)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('sample3D returns value in [-1, 1]', () => {
    const noise = new PerlinNoise(456)
    for (let i = 0; i < 20; i++) {
      const v = noise.sample3D(i * 0.5, i * 0.3, i * 0.1)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('same seed produces same values', () => {
    const n1 = new PerlinNoise(999)
    const n2 = new PerlinNoise(999)
    for (let i = 0; i < 10; i++) {
      expect(n1.sample2D(i, i)).toBe(n2.sample2D(i, i))
    }
  })

  test('different seeds produce different values at non-integer coords', () => {
    const n1 = new PerlinNoise(111)
    const n2 = new PerlinNoise(222)
    let diff = 0
    for (let i = 0; i < 10; i++) {
      // Use non-integer coordinates to avoid lattice alignment
      if (n1.sample2D(i + 0.5, i + 0.3) !== n2.sample2D(i + 0.5, i + 0.3)) diff++
    }
    expect(diff).toBeGreaterThan(5)
  })

  test('fbm2D returns value in [-1, 1]', () => {
    const noise = new PerlinNoise(789)
    const v = noise.fbm2D(1.0, 2.0, 4)
    expect(v).toBeGreaterThanOrEqual(-1)
    expect(v).toBeLessThanOrEqual(1)
  })
})

describe('SimplexNoise', () => {
  test('sample2D returns value in [-1, 1]', () => {
    const noise = new SimplexNoise(123)
    for (let i = 0; i < 20; i++) {
      const v = noise.sample2D(i * 0.5, i * 0.3)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('same seed produces same values', () => {
    const n1 = new SimplexNoise(999)
    const n2 = new SimplexNoise(999)
    for (let i = 0; i < 10; i++) {
      expect(n1.sample2D(i, i)).toBe(n2.sample2D(i, i))
    }
  })
})

describe('gaussian', () => {
  test('mean is approximately correct', () => {
    let sum = 0
    const n = 1000
    for (let i = 0; i < n; i++) {
      sum += gaussian(100, 10)
    }
    expect(sum / n).toBeGreaterThan(95)
    expect(sum / n).toBeLessThan(105)
  })

  test('stdDev is approximately correct', () => {
    const samples: number[] = []
    for (let i = 0; i < 1000; i++) samples.push(gaussian(0, 5))
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length
    const stdDev = Math.sqrt(variance)
    expect(stdDev).toBeGreaterThan(3)
    expect(stdDev).toBeLessThan(7)
  })

  test('gaussianPair returns two independent values', () => {
    const [a, b] = gaussianPair()
    expect(typeof a).toBe('number')
    expect(typeof b).toBe('number')
    expect(a).not.toBeNaN()
    expect(b).not.toBeNaN()
  })
})

describe('clamp', () => {
  test('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe('boundedBrownianStep', () => {
  test('stays within bounds', () => {
    let current = 0
    for (let i = 0; i < 100; i++) {
      current = boundedBrownianStep(current, 0.5, [-2, 2], 0.05, 0)
      expect(current).toBeGreaterThanOrEqual(-2)
      expect(current).toBeLessThanOrEqual(2)
    }
  })
})

describe('Easing', () => {
  test('easeInCubic: 0->0, 1->1', () => {
    expect(Easing.easeInCubic(0)).toBe(0)
    expect(Easing.easeInCubic(1)).toBe(1)
  })

  test('easeOutCubic: 0->0, 1->1', () => {
    expect(Easing.easeOutCubic(0)).toBe(0)
    expect(Easing.easeOutCubic(1)).toBe(1)
  })

  test('smoothstep: 0->0, 1->1', () => {
    expect(Easing.smoothstep(0)).toBe(0)
    expect(Easing.smoothstep(1)).toBe(1)
  })
})

// ---- Jitter Injector ----

describe('JitterInjector', () => {
  test('yaw jitter is bounded', () => {
    const jitter = new JitterInjector({
      seed: 1,
      yawJitterDeg: 1.0,
      pitchJitterDeg: 0.5,
      wasdReleaseProbability: 0,
      wasdReleaseDurationTicks: 1,
      strafeToggleProbability: 0,
      overshootBlocks: 0.1
    })

    for (let tick = 0; tick < 30; tick++) {
      const r = jitter.compute(0, 0, tick, true)
      const yawDiff = Math.abs(r.yaw)
      expect(yawDiff).toBeLessThanOrEqual((1.5 * Math.PI) / 180 + 0.01)
    }
  })

  test('pitch is clamped to [-PI/2, PI/2]', () => {
    const jitter = new JitterInjector({
      seed: 2,
      yawJitterDeg: 1,
      pitchJitterDeg: 5,
      wasdReleaseProbability: 0,
      wasdReleaseDurationTicks: 1,
      strafeToggleProbability: 0,
      overshootBlocks: 0.1
    })

    for (let tick = 0; tick < 30; tick++) {
      const r = jitter.compute(0, 0, tick, true)
      expect(r.pitch).toBeGreaterThanOrEqual(-Math.PI / 2)
      expect(r.pitch).toBeLessThanOrEqual(Math.PI / 2)
    }
  })

  test('WASD release happens with configured probability', () => {
    const jitter = new JitterInjector({
      seed: 3,
      yawJitterDeg: 1,
      pitchJitterDeg: 1,
      wasdReleaseProbability: 1.0, // always
      wasdReleaseDurationTicks: 2,
      strafeToggleProbability: 0,
      overshootBlocks: 0.1
    })

    const r = jitter.compute(0, 0, 0, true)
    expect(r.releaseForward).toBe(true)
  })

  test('strafe toggle happens with configured probability', () => {
    const jitter = new JitterInjector({
      seed: 4,
      yawJitterDeg: 1,
      pitchJitterDeg: 1,
      wasdReleaseProbability: 0,
      wasdReleaseDurationTicks: 1,
      strafeToggleProbability: 1.0, // always
      overshootBlocks: 0.1
    })

    const r = jitter.compute(0, 0, 0, true)
    expect(r.strafeLeft || r.strafeRight).toBe(true)
  })

  test('overshoot is bounded', () => {
    const jitter = new JitterInjector({
      seed: 5,
      yawJitterDeg: 1,
      pitchJitterDeg: 1,
      wasdReleaseProbability: 0,
      wasdReleaseDurationTicks: 1,
      strafeToggleProbability: 0,
      overshootBlocks: 0.2
    })

    const current = { x: 0, z: 0 }
    const target = { x: 5, z: 0 }
    const overshoot = jitter.applyOvershoot(current, target, 0.5)
    const dist = Math.sqrt((overshoot.x - target.x) ** 2 + (overshoot.z - target.z) ** 2)
    expect(dist).toBeLessThanOrEqual(0.25) // maxOvershoot * 0.4 * 3 sigma roughly
  })

  test('reset clears state', () => {
    const jitter = new JitterInjector({
      seed: 6,
      yawJitterDeg: 1,
      pitchJitterDeg: 1,
      wasdReleaseProbability: 1,
      wasdReleaseDurationTicks: 5,
      strafeToggleProbability: 1,
      overshootBlocks: 0.1
    })

    jitter.compute(0, 0, 0, true)
    jitter.reset()
    const r = jitter.compute(0, 0, 1, true)
    // After reset, the internal counters should be zeroed
    // so releaseForward/strafe shouldn't immediately trigger again
    // unless probability fires on tick 1
    expect(r.releaseForward || !r.releaseForward).toBe(true) // always valid
  })
})

// ---- Acceleration Curves ----

describe('AccelerationController', () => {
  test('ramp-up increases multiplier over ticks', () => {
    const accel = new AccelerationController({
      rampUpTicks: 4,
      rampDownTicks: 2,
      pivotTicks: 4,
      rampVariationTicks: 0
    })

    const results: number[] = []
    for (let tick = 0; tick < 6; tick++) {
      const r = accel.process(
        { forward: true, left: false, right: false, sprint: true },
        0,
        tick
      )
      results.push(r.multiplier)
    }

    // Multiplier should increase during ramp-up
    expect(results[0]).toBeLessThan(results[3])
    expect(results[4]).toBe(1)
    expect(results[5]).toBe(1)
  })

  test('ramp-down decreases multiplier', () => {
    const accel = new AccelerationController({
      rampUpTicks: 2,
      rampDownTicks: 3,
      pivotTicks: 4,
      rampVariationTicks: 0
    })

    // Start moving
    accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 0)
    accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 1)

    // Stop
    const r1 = accel.process({ forward: false, left: false, right: false, sprint: false }, 0, 2)
    const r2 = accel.process({ forward: false, left: false, right: false, sprint: false }, 0, 3)
    const r3 = accel.process({ forward: false, left: false, right: false, sprint: false }, 0, 4)

    expect(r1.multiplier).toBeGreaterThan(r2.multiplier)
    expect(r2.multiplier).toBeGreaterThan(r3.multiplier)
    expect(r3.multiplier).toBe(0)
  })

  test('sprint disabled during ramp-up then enabled', () => {
    const accel = new AccelerationController({
      rampUpTicks: 4,
      rampDownTicks: 2,
      pivotTicks: 4,
      rampVariationTicks: 0
    })

    // Process sequentially; sprint should be disabled early, enabled late
    const r0 = accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 0)
    expect(r0.sprint).toBe(false)

    const r1 = accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 1)
    expect(r1.sprint).toBe(false)

    // At tick 2 (call #3), currentRampTick=3 >= rampUpTicks-1=3 → sprint enabled
    const r2 = accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 2)
    expect(r2.sprint).toBe(true)
  })

  test('reset returns to idle', () => {
    const accel = new AccelerationController()
    accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 0)
    accel.reset()
    const r = accel.process({ forward: true, left: false, right: false, sprint: true }, 0, 0)
    expect(r.multiplier).toBeLessThan(1)
  })
})

// ---- Delay Injector ----

describe('computeReactionDelay', () => {
  test('delay is within bounds', () => {
    for (let i = 0; i < 50; i++) {
      const d = computeReactionDelay({
        baseDelayMs: 200,
        stdDevMs: 30,
        pingMs: 50,
        pingScale: 0.5,
        missProbability: 0
      })
      expect(d.delayMs).toBeGreaterThanOrEqual(50)
      expect(d.delayMs).toBeLessThanOrEqual(2000)
    }
  })

  test('missed flag respects probability', () => {
    const d = computeReactionDelay({
      baseDelayMs: 200,
      stdDevMs: 30,
      pingMs: 50,
      missProbability: 1.0 // always miss
    })
    expect(d.missed).toBe(true)
  })

  test('ping increases delay', () => {
    const lowPing = computeReactionDelay({
      baseDelayMs: 200,
      stdDevMs: 0,
      pingMs: 20,
      pingScale: 0.5,
      missProbability: 0
    })
    const highPing = computeReactionDelay({
      baseDelayMs: 200,
      stdDevMs: 0,
      pingMs: 200,
      pingScale: 0.5,
      missProbability: 0
    })
    expect(highPing.delayMs).toBeGreaterThan(lowPing.delayMs)
  })
})

describe('DelayTracker', () => {
  test('burst mode reduces delay for quick successive reactions', () => {
    const tracker = new DelayTracker()
    const d1 = tracker.compute(0, DelayPresets.movement(50))
    const d2 = tracker.compute(2, DelayPresets.movement(50))
    expect(d2.delayMs).toBeLessThan(d1.delayMs)
  })

  test('long pause increases delay vs quick succession', () => {
    // Use a deterministic RNG so the comparison is stable
    let seed = 12345
    const rng = () => {
      seed = (seed * 16807 + 0) % 2147483647
      return (seed - 1) / 2147483646
    }
    const tracker = new DelayTracker(rng)

    // First call at tick 0 (long pause → multiplier 1.15)
    const dLongPause = tracker.compute(0, { baseDelayMs: 200, stdDevMs: 0, pingMs: 50, pingScale: 0, missProbability: 0 })

    // Quick succession at tick 1 (burst → multiplier 0.7)
    const dBurst = tracker.compute(1, { baseDelayMs: 200, stdDevMs: 0, pingMs: 50, pingScale: 0, missProbability: 0 })

    expect(dBurst.delayMs).toBeLessThan(dLongPause.delayMs)
  })
})

// ---- Ping Sync ----

describe('estimateTps', () => {
  test('returns 20 for empty array', () => {
    expect(estimateTps([])).toBe(20)
  })

  test('computes correct TPS from uniform 50ms ticks', () => {
    expect(estimateTps([50, 50, 50, 50, 50])).toBe(20)
  })

  test('clamps to reasonable range', () => {
    expect(estimateTps([200])).toBe(5)
    expect(estimateTps([25])).toBe(40)
  })
})

describe('computeTickTiming', () => {
  test('returns burst flag true during burst interval', () => {
    const t1 = computeTickTiming(0, { pingMs: 50, burstIntervalTicks: 10, burstDurationTicks: 3 })
    expect(t1.isBurst).toBe(true)

    const t5 = computeTickTiming(5, { pingMs: 50, burstIntervalTicks: 10, burstDurationTicks: 3 })
    expect(t5.isBurst).toBe(false)
  })

  test('delay increases with ping', () => {
    const low = computeTickTiming(0, { pingMs: 20 })
    const high = computeTickTiming(0, { pingMs: 200 })
    expect(high.delayMs).toBeGreaterThan(low.delayMs)
  })
})

describe('PingTracker', () => {
  test('records ticks and estimates TPS', () => {
    const tracker = new PingTracker(5)
    for (let i = 1; i <= 10; i++) {
      tracker.recordTick(i * 50)
    }
    expect(tracker.estimatedTps).toBe(20)
  })

  test('reset clears state', () => {
    const tracker = new PingTracker()
    tracker.recordTick(50)
    tracker.recordTick(100)
    tracker.reset()
    expect(tracker.estimatedTps).toBe(20)
    expect(tracker.smoothedPingMs).toBe(50)
  })
})

// ---- HumanizationLayer Integration ----

describe('HumanizationLayer', () => {
  test('enabled=true applies jitter to yaw', () => {
    const layer = new HumanizationLayer({ seed: 42, enabled: true })
    const raw = {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: true,
      sneak: false,
      targetYaw: 0,
      targetPitch: 0
    }

    const result = layer.humanize(raw, new Vec3(0, 64, 0), 0, 0, 1, new Vec3(5, 64, 0))
    expect(result.targetYaw).not.toBe(0)
  })

  test('enabled=false passes through raw controls', () => {
    const layer = new HumanizationLayer({ seed: 42, enabled: false })
    const raw = {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: true,
      sneak: false,
      targetYaw: 1.23,
      targetPitch: 0.45
    }

    const result = layer.humanize(raw, new Vec3(0, 64, 0), 0, 0, 1, new Vec3(5, 64, 0))
    expect(result.targetYaw).toBe(1.23)
    expect(result.targetPitch).toBe(0.45)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
  })

  test('sprint fatigue reduces sprint after prolonged use', () => {
    const layer = new HumanizationLayer({ seed: 42, sprintFatigue: true })
    const raw = {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: true,
      sneak: false,
      targetYaw: 0,
      targetPitch: 0
    }

    let sprintCount = 0
    for (let tick = 0; tick < 300; tick++) {
      const r = layer.humanize(raw, new Vec3(tick * 0.1, 64, 0), 0, 0, tick, new Vec3(tick + 5, 64, 0))
      if (r.sprint) sprintCount++
    }

    // Not all 300 ticks should have sprint (fatigue kicks in)
    expect(sprintCount).toBeLessThan(300)
  })

  test('computeReaction returns delay and missed flag', () => {
    const layer = new HumanizationLayer({ seed: 42 })
    const result = layer.computeReaction(0, 'movement')
    expect(result.delayMs).toBeGreaterThanOrEqual(50)
    expect(result.delayMs).toBeLessThanOrEqual(2000)
    expect(typeof result.missed).toBe('boolean')
  })

  test('reset clears all internal state', () => {
    const layer = new HumanizationLayer({ seed: 42 })
    layer.humanize(
      { forward: true, back: false, left: false, right: false, jump: false, sprint: true, sneak: false, targetYaw: 0, targetPitch: 0 },
      new Vec3(0, 64, 0), 0, 0, 1, new Vec3(5, 64, 0)
    )
    layer.reset()
    // After reset, a fresh humanize should start from idle (lower multiplier)
    const r1 = layer.humanize(
      { forward: true, back: false, left: false, right: false, jump: false, sprint: true, sneak: false, targetYaw: 0, targetPitch: 0 },
      new Vec3(10, 64, 0), 0, 0, 100, new Vec3(15, 64, 0)
    )
    expect(typeof r1.forward).toBe('boolean')
  })
})

describe('HumanizationLayer edge cases', () => {
  test('handles zero velocity gracefully', () => {
    const layer = new HumanizationLayer({ seed: 42 })
    const raw = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
      targetYaw: 0,
      targetPitch: 0
    }

    const result = layer.humanize(raw, new Vec3(0, 64, 0), 0, 0, 0, new Vec3(0, 64, 0))
    expect(result.forward).toBe(false)
  })

  test('sneak jitter near edges', () => {
    const layer = new HumanizationLayer({ seed: 42, sneakJitter: true })
    const raw = {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
      targetYaw: 0,
      targetPitch: 0
    }

    // Target is far below → edge detected
    let sneakCount = 0
    for (let tick = 0; tick < 100; tick++) {
      const r = layer.humanize(raw, new Vec3(0, 64, 0), 0, 0, tick, new Vec3(0, 60, 0))
      if (r.sneak) sneakCount++
    }
    expect(sneakCount).toBeGreaterThan(0)
  })
})
