/**
 * Acceleration curves for human-like movement ramp-up and ramp-down.
 *
 * Humans don't accelerate instantly. When starting to walk, there is a
 * 3-6 tick ease-in. When stopping, a 2-4 tick coast (ease-out).
 * Direction changes also take ticks because momentum must be reversed.
 *
 * The curve modulates control inputs (forward/sprint) over time.
 */

import { Easing, clamp } from './noise-generators'

export interface AccelerationProfile {
  /** Ticks for full ramp-up when starting movement. @default 4 */
  rampUpTicks: number
  /** Ticks for coasting before stopping. @default 3 */
  rampDownTicks: number
  /** Ticks to pivot 180° (reverse direction). @default 6 */
  pivotTicks: number
  /** Small random variation applied to ramp durations. @default 1 */
  rampVariationTicks: number
}

export const DEFAULT_ACCEL_PROFILE: AccelerationProfile = {
  rampUpTicks: 4,
  rampDownTicks: 3,
  pivotTicks: 6,
  rampVariationTicks: 1
}

/**
 * Tracks movement state transitions and applies ease-in/ease-out.
 */
export class AccelerationController {
  private rampUpTicks = 0
  private rampDownTicks = 0
  private pivotTicks = 0
  private currentRampTick = 0
  private state: 'idle' | 'rampingUp' | 'moving' | 'rampingDown' | 'pivoting' = 'idle'
  private lastForward = false
  private lastLeft = false
  private lastRight = false
  private lastYaw = 0

  constructor (private readonly profile: AccelerationProfile = DEFAULT_ACCEL_PROFILE) {}

  /**
   * Process a tick of control inputs and return modified inputs that respect
   * acceleration curves.
   *
   * @param inputs Raw control inputs from the pathfinder/executor
   * @param currentYaw Current bot yaw in radians
   * @param tick Current tick number
   * @param rng Random source for variation
   * @returns Modified inputs with ramp-up/ramp-down applied
   */
  process (
    inputs: { forward: boolean; left: boolean; right: boolean; sprint: boolean },
    currentYaw: number,
    _tick: number,
    rng: () => number = Math.random
  ): { forward: boolean; left: boolean; right: boolean; sprint: boolean; multiplier: number } {
    const isMoving = inputs.forward || inputs.left || inputs.right
    const wasMoving = this.lastForward || this.lastLeft || this.lastRight

    // Detect direction reversal (yaw delta > 120° while moving)
    const yawDelta = Math.abs(normalizeYawDelta(currentYaw - this.lastYaw))
    const reversing = wasMoving && isMoving && yawDelta > (2.0 * Math.PI / 3)

    // ---- State Machine ----
    if (reversing && this.state !== 'pivoting') {
      this.state = 'pivoting'
      this.currentRampTick = 0
      this.pivotTicks = this.profile.pivotTicks + Math.floor(rng() * (this.profile.rampVariationTicks + 1))
    } else if (!wasMoving && isMoving && this.state !== 'rampingUp' && this.state !== 'moving') {
      this.state = 'rampingUp'
      this.currentRampTick = 0
      this.rampUpTicks = this.profile.rampUpTicks + Math.floor(rng() * (this.profile.rampVariationTicks + 1))
    } else if (wasMoving && !isMoving && this.state !== 'rampingDown' && this.state !== 'idle') {
      this.state = 'rampingDown'
      this.currentRampTick = 0
      this.rampDownTicks = this.profile.rampDownTicks + Math.floor(rng() * (this.profile.rampVariationTicks + 1))
    }

    // ---- Multiplier computation ----
    let multiplier = 1.0

    if (this.state === 'rampingUp') {
      this.currentRampTick++
      const t = clamp(this.currentRampTick / this.rampUpTicks, 0, 1)
      multiplier = Easing.easeOutQuad(t)
      if (this.currentRampTick >= this.rampUpTicks) {
        this.state = 'moving'
      }
    } else if (this.state === 'rampingDown') {
      this.currentRampTick++
      const t = clamp(this.currentRampTick / this.rampDownTicks, 0, 1)
      multiplier = 1.0 - Easing.easeInCubic(t)
      if (this.currentRampTick >= this.rampDownTicks) {
        this.state = 'idle'
        multiplier = 0
      }
    } else if (this.state === 'pivoting') {
      this.currentRampTick++
      const t = clamp(this.currentRampTick / this.pivotTicks, 0, 1)
      // Brief pause during pivot, then ease back in
      multiplier = t < 0.3 ? 0 : Easing.easeOutQuad((t - 0.3) / 0.7)
      if (this.currentRampTick >= this.pivotTicks) {
        this.state = 'moving'
      }
    }

    // Sprint only allowed once we're mostly ramped up
    const allowSprint = this.state === 'moving' || (this.state === 'rampingUp' && this.currentRampTick >= this.rampUpTicks - 1)

    this.lastForward = inputs.forward
    this.lastLeft = inputs.left
    this.lastRight = inputs.right
    this.lastYaw = currentYaw

    return {
      forward: inputs.forward && multiplier > 0.05,
      left: inputs.left,
      right: inputs.right,
      sprint: inputs.sprint && allowSprint,
      multiplier
    }
  }

  /** Reset to idle state. */
  reset (): void {
    this.state = 'idle'
    this.currentRampTick = 0
    this.lastForward = false
    this.lastLeft = false
    this.lastRight = false
    this.lastYaw = 0
  }
}

/**
 * Normalize a yaw delta to the range [-PI, PI].
 */
function normalizeYawDelta (delta: number): number {
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return delta
}
