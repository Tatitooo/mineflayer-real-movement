/**
 * Humanization Layer — main orchestrator.
 *
 * Wraps raw control inputs from the pathfinder/executor and applies:
 * - Perlin/Gaussian noise to yaw/pitch
 * - WASD micro-jitter and overshoot
 * - Acceleration curves (ease-in/ease-out)
 * - Ping-aware timing and TPS sync
 * - Reaction delays with Gaussian distribution
 *
 * This is the integration point: the executor calls `humanize()` each tick,
 * and the layer returns modified control states + look angles.
 */

import { Vec3 } from 'vec3'
import { JitterInjector, type JitterConfig } from './jitter-injector'
import { AccelerationController, type AccelerationProfile } from './acceleration-curves'
import { PingTracker, computeTickTiming, type PingSyncOptions } from './ping-sync'
import { DelayTracker, DelayPresets, type DelayOptions } from './delay-injector'
import { clamp } from './noise-generators'

export interface HumanizationOptions {
  /** Seed for deterministic humanization (per-session). */
  seed: number
  /** Jitter configuration. */
  jitter?: Partial<JitterConfig>
  /** Acceleration profile. */
  accelProfile?: Partial<AccelerationProfile>
  /** Ping sync configuration. */
  pingSync?: Partial<PingSyncOptions>
  /** Whether humanization is enabled at all. @default true */
  enabled?: boolean
  /** Whether to apply sprint fatigue (reduce sprint usage over time). @default true */
  sprintFatigue?: boolean
  /** Whether to apply sneak-toggle jitter near edges. @default true */
  sneakJitter?: boolean
}

export interface HumanizedControls {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean
  sneak: boolean
  targetYaw: number
  targetPitch: number
}

const DEFAULT_JITTER: JitterConfig = {
  seed: 42,
  yawJitterDeg: 1.0,
  pitchJitterDeg: 0.6,
  wasdReleaseProbability: 0.03,
  wasdReleaseDurationTicks: 2,
  strafeToggleProbability: 0.02,
  overshootBlocks: 0.15
}

const DEFAULT_PING_SYNC: PingSyncOptions = {
  pingMs: 50,
  targetTps: 20,
  estimatedTps: 20,
  maxJitterMs: 12,
  burstIntervalTicks: 30,
  burstDurationTicks: 6
}

/**
 * Main humanization orchestrator.
 */
export class HumanizationLayer {
  readonly jitter: JitterInjector
  readonly accel: AccelerationController
  readonly ping: PingTracker
  readonly delays: DelayTracker
  private readonly options: HumanizationOptions
  private sprintTicksUsed = 0
  private readonly maxSprintTicks = 200 // ~10 seconds of sprint before "fatigue"
  private lastPos = new Vec3(0, 0, 0)
  private approachSpeed = 0

  constructor (options: HumanizationOptions) {
    this.options = {
      enabled: true,
      sprintFatigue: true,
      sneakJitter: true,
      ...options
    }

    const jitterConfig: JitterConfig = {
      ...DEFAULT_JITTER,
      seed: options.seed,
      ...options.jitter
    }

    this.jitter = new JitterInjector(jitterConfig)
    this.accel = new AccelerationController({
      rampUpTicks: 4,
      rampDownTicks: 3,
      pivotTicks: 6,
      rampVariationTicks: 1,
      ...options.accelProfile
    })
    this.ping = new PingTracker()
    this.delays = new DelayTracker()
  }

  /**
   * Humanize raw controls for the current tick.
   *
   * @param raw Raw controls from the executor/pathfinder
   * @param currentPos Current bot position
   * @param currentYaw Current bot yaw (radians)
   * @param currentPitch Current bot pitch (radians)
   * @param tick Current tick count
   * @param targetPos Next path node position (for overshoot)
   * @returns Humanized controls and look angles
   */
  humanize (
    raw: HumanizedControls,
    currentPos: Vec3,
    currentYaw: number,
    _currentPitch: number,
    tick: number,
    targetPos: Vec3
  ): HumanizedControls {
    if (this.options.enabled === false) {
      return raw
    }

    const isMoving = raw.forward || raw.left || raw.right

    // Update approach speed
    const dx = currentPos.x - this.lastPos.x
    const dz = currentPos.z - this.lastPos.z
    this.approachSpeed = Math.sqrt(dx * dx + dz * dz)
    this.lastPos = currentPos.clone()

    // ---- 1. Jitter (yaw/pitch + WASD) ----
    const jitterResult = this.jitter.compute(
      raw.targetYaw,
      raw.targetPitch,
      tick,
      isMoving
    )

    let yaw = jitterResult.yaw
    let pitch = jitterResult.pitch

    // Apply overshoot to target position
    const overshootTarget = this.jitter.applyOvershoot(
      currentPos,
      targetPos,
      this.approachSpeed
    )

    // Adjust yaw to aim at overshoot target
    const dxO = overshootTarget.x - currentPos.x
    const dzO = overshootTarget.z - currentPos.z
    if (Math.abs(dxO) > 0.001 || Math.abs(dzO) > 0.001) {
      yaw = Math.atan2(-dxO, -dzO) + (jitterResult.yaw - raw.targetYaw)
    }

    // ---- 2. Acceleration curves ----
    const accelResult = this.accel.process(
      { forward: raw.forward, left: raw.left, right: raw.right, sprint: raw.sprint },
      currentYaw,
      tick
    )

    let forward = accelResult.forward
    let left = raw.left
    let right = raw.right
    let sprint = accelResult.sprint

    // ---- 3. WASD micro-jitter overrides ----
    if (jitterResult.releaseForward && forward) {
      forward = false
    }
    if (jitterResult.strafeLeft && forward) {
      left = true
    }
    if (jitterResult.strafeRight && forward) {
      right = true
    }

    // ---- 4. Sprint fatigue ----
    if (this.options.sprintFatigue && sprint) {
      this.sprintTicksUsed++
      if (this.sprintTicksUsed > this.maxSprintTicks) {
        // "Tired" — reduce sprint probability
        const fatigueRoll = Math.random()
        if (fatigueRoll < (this.sprintTicksUsed - this.maxSprintTicks) / 400) {
          sprint = false
        }
      }
    } else if (!sprint) {
      // Recover fatigue when not sprinting
      this.sprintTicksUsed = Math.max(0, this.sprintTicksUsed - 2)
    }

    // ---- 5. Sneak jitter near edges ----
    let sneak = raw.sneak
    if (this.options.sneakJitter && !sneak && isMoving) {
      // Small chance to briefly toggle sneak while moving near edges
      // (detected by vertical drop in front — approximate with target Y)
      const dropAhead = currentPos.y - targetPos.y
      if (dropAhead > 1.5 && Math.random() < 0.05) {
        sneak = true
      }
    }

    // ---- 6. Ping sync timing (record tick, compute timing) ----
    // In a real bot, we'd call ping.recordTick(performance.now()) each physicsTick
    const timing = computeTickTiming(tick, {
      ...DEFAULT_PING_SYNC,
      ...this.options.pingSync,
      estimatedTps: this.ping.estimatedTps,
      pingMs: this.ping.smoothedPingMs
    })

    // We don't directly apply timing.delayMs here because the executor
    // runs on physicsTick events (20 Hz). Instead, we can modulate the
    // control states based on burst/rest cycles.
    if (!timing.isBurst && isMoving) {
      // During rest cycles, slightly reduce input intensity
      if (Math.random() < 0.08) {
        forward = false
      }
    }

    // Clamp pitch to valid range
    pitch = clamp(pitch, -Math.PI / 2, Math.PI / 2)

    return {
      forward,
      back: raw.back,
      left,
      right,
      jump: raw.jump,
      sprint,
      sneak,
      targetYaw: yaw,
      targetPitch: pitch
    }
  }

  /**
   * Compute a reaction delay for an external stimulus (e.g., block update,
   * entity moved). The executor can use this to decide when to replan.
   *
   * @param tick Current tick
   * @param context 'movement' | 'combat' | 'inventory' | 'blockInteraction'
   * @returns Delay in milliseconds and whether to ignore the stimulus
   */
  computeReaction (
    tick: number,
    context: 'movement' | 'combat' | 'inventory' | 'blockInteraction' = 'movement'
  ): { delayMs: number; missed: boolean } {
    const preset = DelayPresets[context]
    const options: DelayOptions = preset(this.ping.smoothedPingMs)
    return this.delays.compute(tick, options)
  }

  /** Reset all internal state. */
  reset (): void {
    this.jitter.reset()
    this.accel.reset()
    this.ping.reset()
    this.delays.reset()
    this.sprintTicksUsed = 0
    this.lastPos = new Vec3(0, 0, 0)
    this.approachSpeed = 0
  }
}
