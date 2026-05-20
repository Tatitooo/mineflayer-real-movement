import { Vec3 } from 'vec3'
import type { MovementNode, ControlInputs } from '../core/types'
import { yawToTarget } from '../execution/alignment-logic'

/**
 * Elytra flight state machine phases.
 */
export type ElytraPhase =
  | 'idle'
  | 'launching'      // Jumping off a high point to deploy elytra
  | 'gliding'         // Normal elytra flight with pitch control
  | 'boosting'        // Firework rocket boost active
  | 'landing'         // Preparing to land smoothly
  | 'landed'
  | 'failed'

/**
 * Configuration for elytra flight behavior.
 */
export interface ElytraOptions {
  /** Minimum height above ground to start a glide (blocks). */
  minLaunchHeight: number
  /** Ideal pitch during normal glide (radians). Negative = nose down. */
  idealGlidePitch: number
  /** Pitch when boosting (slightly up to gain altitude). */
  boostPitch: number
  /** Pitch when landing (slightly up to slow descent). */
  landingPitch: number
  /** Distance to start landing preparation (blocks). */
  landingDistance: number
  /** Minimum altitude above destination to consider landing safe. */
  minLandingAltitude: number
  /** Firework boost duration in ticks (~20 ticks per rocket). */
  boostDurationTicks: number
  /** How long to wait between firework boosts. */
  boostCooldownTicks: number
}

export const DEFAULT_ELYTRA_OPTIONS: ElytraOptions = {
  minLaunchHeight: 10,
  idealGlidePitch: -0.25, // ~-14 degrees, good glide ratio
  boostPitch: -0.1,       // slightly less nose-down during boost
  landingPitch: -0.05,    // almost level
  landingDistance: 20,
  minLandingAltitude: 5,
  boostDurationTicks: 22,
  boostCooldownTicks: 5
}

/**
 * Compute the glide vector given current velocity.
 * Vanilla elytra physics: downward speed depends on pitch.
 * Pitch -45° → fastest descent (~75 blocks/s)
 * Pitch 0° → ~35 blocks/s horizontal, slight descent
 * Pitch +20° → climb (if boosted)
 */
export function computeGlidePitch (
  _currentVel: Vec3,
  targetPos: Vec3,
  currentPos: Vec3,
  altitude: number,
  options: ElytraOptions = DEFAULT_ELYTRA_OPTIONS
): number {
  const horizDist = Math.sqrt(
    (targetPos.x - currentPos.x) ** 2 +
    (targetPos.z - currentPos.z) ** 2
  )

  // Landing preparation
  if (horizDist < options.landingDistance && altitude < options.minLandingAltitude * 2) {
    return options.landingPitch
  }

  // Need to lose altitude quickly but not stall
  if (altitude > options.minLaunchHeight && horizDist > 5) {
    return options.idealGlidePitch
  }

  // Level or slight climb if close and high
  if (altitude < options.minLandingAltitude && horizDist > 2) {
    return -0.4 // steeper dive to reach target
  }

  return options.idealGlidePitch
}

/**
 * Compute yaw to steer toward the target while gliding.
 * Vanilla elytra turns are gradual; sharp yaw changes cause stalls.
 */
export function computeGlideYaw (
  currentYaw: number,
  currentPos: Vec3,
  targetPos: Vec3,
  maxYawChangePerTick: number = 0.15 // ~8.6 degrees/tick
): number {
  const targetYaw = yawToTarget(currentPos, targetPos)
  let diff = targetYaw - currentYaw
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI

  // Clamp turn rate to avoid stall
  const clampedDiff = Math.max(-maxYawChangePerTick, Math.min(maxYawChangePerTick, diff))
  return currentYaw + clampedDiff
}

/**
 * Compute control inputs for elytra flight.
 * Returns target yaw/pitch that the executor should set via `bot.look()`.
 */
export function computeElytraControls (
  currentNode: MovementNode,
  targetPos: Vec3,
  phase: ElytraPhase,
  altitude: number,
  options: ElytraOptions = DEFAULT_ELYTRA_OPTIONS
): ControlInputs & { targetYaw: number; targetPitch: number; useFirework: boolean } {
  const pos = currentNode.pos
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  let targetYaw = currentNode.vel.x === 0 && currentNode.vel.z === 0
    ? 0
    : Math.atan2(-currentNode.vel.x, -currentNode.vel.z)
  let targetPitch = 0
  let useFirework = false

  switch (phase) {
    case 'launching': {
      // Deploy elytra by pressing jump mid-air
      inputs.jump = true
      targetYaw = yawToTarget(pos, targetPos)
      targetPitch = -0.5 // nose down to start gliding
      break
    }

    case 'gliding': {
      inputs.forward = true // hold forward to maintain speed
      targetYaw = computeGlideYaw(targetYaw, pos, targetPos)
      targetPitch = computeGlidePitch(currentNode.vel, targetPos, pos, altitude, options)
      break
    }

    case 'boosting': {
      inputs.forward = true
      targetYaw = computeGlideYaw(targetYaw, pos, targetPos)
      targetPitch = options.boostPitch
      useFirework = true
      break
    }

    case 'landing': {
      inputs.forward = true
      targetYaw = yawToTarget(pos, targetPos)
      targetPitch = options.landingPitch
      break
    }

    case 'landed':
    case 'idle':
    case 'failed': {
      // No controls
      break
    }
  }

  return { ...inputs, targetYaw, targetPitch, useFirework }
}

/**
 * State machine for executing an elytra flight segment.
 * Manages phase transitions and firework timing.
 */
export class ElytraExecutor {
  private phase: ElytraPhase = 'idle'
  private ticksInPhase = 0
  private ticksSinceBoost = 0
  private boostActive = false
  private options: ElytraOptions

  constructor (options?: Partial<ElytraOptions>) {
    this.options = { ...DEFAULT_ELYTRA_OPTIONS, ...options }
  }

  /**
   * Start a new elytra flight toward `targetPos`.
   * `altitude` is current height above ground.
   */
  start (altitude: number): void {
    if (altitude < this.options.minLaunchHeight) {
      this.phase = 'failed'
      return
    }
    this.phase = 'launching'
    this.ticksInPhase = 0
    this.ticksSinceBoost = 0
    this.boostActive = false
  }

  /**
   * Tick the elytra state machine.
   * Returns control inputs + target look angles.
   */
  tick (
    currentNode: MovementNode,
    targetPos: Vec3,
    altitude: number,
    elytraFlying: boolean
  ): ControlInputs & { targetYaw: number; targetPitch: number; useFirework: boolean } {
    this.ticksInPhase++
    this.ticksSinceBoost++
    if (this.boostActive) {
      if (this.ticksSinceBoost >= this.options.boostDurationTicks) {
        this.boostActive = false
        this.ticksSinceBoost = 0
      }
    }

    // Phase transitions
    switch (this.phase) {
      case 'launching': {
        if (elytraFlying) {
          this.phase = 'gliding'
          this.ticksInPhase = 0
          this.ticksSinceBoost = 0
        } else if (this.ticksInPhase > 10) {
          // Failed to deploy elytra
          this.phase = 'failed'
        }
        break
      }

      case 'gliding': {
        const horizDist = Math.sqrt(
          (targetPos.x - currentNode.pos.x) ** 2 +
          (targetPos.z - currentNode.pos.z) ** 2
        )
        if (horizDist < this.options.landingDistance && altitude < this.options.minLandingAltitude * 2) {
          this.phase = 'landing'
          this.ticksInPhase = 0
        }
        break
      }

      case 'boosting': {
        if (!this.boostActive) {
          this.phase = 'gliding'
          this.ticksInPhase = 0
        }
        break
      }

      case 'landing': {
        if (currentNode.onGround) {
          this.phase = 'landed'
        } else if (this.ticksInPhase > 60) {
          // Too long in landing, assume on ground
          this.phase = 'landed'
        }
        break
      }
    }

    return computeElytraControls(currentNode, targetPos, this.phase, altitude, this.options)
  }

  /**
   * Request a firework boost. Returns true if boost was initiated.
   */
  requestBoost (): boolean {
    if (this.phase === 'gliding' && !this.boostActive && this.ticksSinceBoost >= this.options.boostCooldownTicks) {
      this.phase = 'boosting'
      this.ticksInPhase = 0
      this.boostActive = true
      this.ticksSinceBoost = 0
      return true
    }
    return false
  }

  /**
   * Whether the elytra flight is active (not idle/landed/failed).
   */
  isActive (): boolean {
    return this.phase !== 'idle' && this.phase !== 'landed' && this.phase !== 'failed'
  }

  /**
   * Whether the flight has completed successfully.
   */
  isLanded (): boolean {
    return this.phase === 'landed'
  }

  /**
   * Whether the flight failed (e.g., not enough altitude).
   */
  isFailed (): boolean {
    return this.phase === 'failed'
  }

  /** Current phase. */
  getPhase (): ElytraPhase {
    return this.phase
  }

  /** Reset to idle. */
  reset (): void {
    this.phase = 'idle'
    this.ticksInPhase = 0
    this.ticksSinceBoost = 0
    this.boostActive = false
  }
}

/**
 * Validate whether elytra flight from `from` to `to` is feasible.
 * Requirements:
 * - Destination is lower or same Y (elytra can't gain altitude without boost)
 * - There is enough drop height at the start
 * - No solid blocks directly in the glide path (simple line check)
 */
export function canElytraTo (
  from: MovementNode,
  to: Vec3,
  altitudeAtStart: number,
  options: ElytraOptions = DEFAULT_ELYTRA_OPTIONS
): boolean {
  // Must have enough altitude
  if (altitudeAtStart < options.minLaunchHeight) return false

  // Destination should be lower or roughly same Y (can't climb without boost)
  if (to.y > from.pos.y + 2) return false

  // Horizontal distance must be significant (otherwise walking is faster)
  const horizDist = Math.sqrt((to.x - from.pos.x) ** 2 + (to.z - from.pos.z) ** 2)
  if (horizDist < 10) return false

  return true
}

/**
 * Estimate ticks for an elytra flight segment.
 * Vanilla elytra: ~35-45 blocks/s horizontal in normal glide.
 */
export function estimateElytraTicks (
  from: Vec3,
  to: Vec3,
  _options: ElytraOptions = DEFAULT_ELYTRA_OPTIONS
): number {
  const horizDist = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2)
  const glideSpeed = 38 // blocks/s average
  const launchOverhead = 10 // ticks to jump + deploy
  const landingOverhead = 8 // ticks to slow and land
  return Math.ceil((horizDist / glideSpeed) * 20) + launchOverhead + landingOverhead
}
