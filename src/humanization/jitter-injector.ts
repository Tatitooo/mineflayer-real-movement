/**
 * Jitter injector for yaw, pitch, and WASD inputs.
 *
 * Human players exhibit micro-variations in:
 * - Yaw/pitch: ±0.3° to ±1.5° jitter while aiming or walking
 * - WASD: brief 1-3 tick releases while moving in a straight line
 * - Overshoot: passing slightly past a target then correcting
 *
 * The injector adds bounded noise without letting the bot lose
 * alignment with its path or target.
 */

import { PerlinNoise, gaussian, clamp, boundedBrownianStep } from './noise-generators'

export interface JitterConfig {
  /** Seed for deterministic jitter patterns. */
  seed: number
  /** Max yaw jitter in degrees. @default 1.0 */
  yawJitterDeg: number
  /** Max pitch jitter in degrees. @default 0.6 */
  pitchJitterDeg: number
  /** Probability per tick of a WASD micro-release (0..1). @default 0.03 */
  wasdReleaseProbability: number
  /** Duration of WASD micro-release in ticks. @default 2 */
  wasdReleaseDurationTicks: number
  /** Probability of a strafe toggle per tick (course correction). @default 0.02 */
  strafeToggleProbability: number
  /** Amplitude of overshoot when approaching a target (blocks). @default 0.15 */
  overshootBlocks: number
}

export interface JitterResult {
  /** Adjusted yaw in radians. */
  yaw: number
  /** Adjusted pitch in radians. */
  pitch: number
  /** Whether to release forward this tick (micro-stutter). */
  releaseForward: boolean
  /** Whether to inject a brief strafe this tick. */
  strafeLeft: boolean
  strafeRight: boolean
}

const DEG_TO_RAD = Math.PI / 180

/**
 * Stateful jitter generator that evolves noise over time.
 */
export class JitterInjector {
  private readonly noise: PerlinNoise
  private wasdReleaseTicksRemaining = 0
  private strafeTicksRemaining = 0
  private strafeDirection: 'left' | 'right' = 'left'
  private readonly brownianYaw: { value: number; bounds: [number, number]; center: number }
  private readonly brownianPitch: { value: number; bounds: [number, number]; center: number }

  constructor (private readonly config: JitterConfig) {
    this.noise = new PerlinNoise(config.seed)
    this.brownianYaw = {
      value: 0,
      bounds: [-config.yawJitterDeg * DEG_TO_RAD, config.yawJitterDeg * DEG_TO_RAD],
      center: 0
    }
    this.brownianPitch = {
      value: 0,
      bounds: [-config.pitchJitterDeg * DEG_TO_RAD, config.pitchJitterDeg * DEG_TO_RAD],
      center: 0
    }
  }

  /**
   * Compute jittered yaw and pitch for the current tick.
   *
   * @param baseYaw Target yaw (radians) the bot wants to face
   * @param basePitch Target pitch (radians)
   * @param tick Current tick count (for temporal noise evolution)
   * @param isMoving Whether the bot is actively moving (more jitter while moving)
   * @returns Jittered angles and WASD flags
   */
  compute (
    baseYaw: number,
    basePitch: number,
    tick: number,
    isMoving: boolean,
    rng: () => number = Math.random
  ): JitterResult {
    // ---- Yaw / Pitch Jitter ----
    // Use Perlin noise for smooth temporal variation + Brownian for micro-drift
    const time = tick * 0.05
    const yawNoise = this.noise.sample2D(time, this.config.seed) * this.config.yawJitterDeg * DEG_TO_RAD
    const pitchNoise = this.noise.sample2D(time + 100, this.config.seed + 1) * this.config.pitchJitterDeg * DEG_TO_RAD

    // Brownian step for aim drift (only if moving or aiming)
    if (isMoving) {
      this.brownianYaw.value = boundedBrownianStep(
        this.brownianYaw.value,
        this.config.yawJitterDeg * DEG_TO_RAD * 0.3,
        this.brownianYaw.bounds,
        0.05,
        this.brownianYaw.center,
        rng
      )
      this.brownianPitch.value = boundedBrownianStep(
        this.brownianPitch.value,
        this.config.pitchJitterDeg * DEG_TO_RAD * 0.3,
        this.brownianPitch.bounds,
        0.05,
        this.brownianPitch.center,
        rng
      )
    }

    const jitteredYaw = baseYaw + yawNoise + this.brownianYaw.value
    const jitteredPitch = clamp(
      basePitch + pitchNoise + this.brownianPitch.value,
      -Math.PI / 2,
      Math.PI / 2
    )

    // ---- WASD Micro-Release ----
    // Occasionally release forward for 1-2 ticks while walking straight
    let releaseForward = false
    if (isMoving && this.wasdReleaseTicksRemaining <= 0) {
      if (rng() < this.config.wasdReleaseProbability) {
        this.wasdReleaseTicksRemaining = this.config.wasdReleaseDurationTicks
      }
    }
    if (this.wasdReleaseTicksRemaining > 0) {
      this.wasdReleaseTicksRemaining--
      releaseForward = true
    }

    // ---- Strafe Toggle (course correction simulation) ----
    let strafeLeft = false
    let strafeRight = false
    if (isMoving && this.strafeTicksRemaining <= 0) {
      if (rng() < this.config.strafeToggleProbability) {
        this.strafeDirection = rng() < 0.5 ? 'left' : 'right'
        this.strafeTicksRemaining = 2 + Math.floor(rng() * 3) // 2-4 ticks
      }
    }
    if (this.strafeTicksRemaining > 0) {
      this.strafeTicksRemaining--
      if (this.strafeDirection === 'left') strafeLeft = true
      else strafeRight = true
    }

    return {
      yaw: jitteredYaw,
      pitch: jitteredPitch,
      releaseForward,
      strafeLeft,
      strafeRight
    }
  }

  /**
   * Compute an overshoot amount when approaching a target position.
   * Humans often step slightly past the target then correct back.
   *
   * @param currentPos Current position
   * @param targetPos Target position
   * @param approachSpeed Current horizontal speed
   * @param rng Random source
   * @returns Adjusted target position with overshoot applied
   */
  applyOvershoot (
    currentPos: { x: number; z: number },
    targetPos: { x: number; z: number },
    approachSpeed: number,
    rng: () => number = Math.random
  ): { x: number; z: number } {
    // Only overshoot if moving reasonably fast
    if (approachSpeed < 0.05) return targetPos

    const maxOvershoot = this.config.overshootBlocks
    const dx = targetPos.x - currentPos.x
    const dz = targetPos.z - currentPos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.01) return targetPos

    // Overshoot increases with speed (faster = harder to stop exactly)
    const overshootAmount = clamp(
      gaussian(0, maxOvershoot * 0.4, rng),
      -maxOvershoot,
      maxOvershoot
    )

    const dirX = dx / dist
    const dirZ = dz / dist
    return {
      x: targetPos.x + dirX * overshootAmount,
      z: targetPos.z + dirZ * overshootAmount
    }
  }

  /** Reset all internal state. */
  reset (): void {
    this.wasdReleaseTicksRemaining = 0
    this.strafeTicksRemaining = 0
    this.brownianYaw.value = 0
    this.brownianPitch.value = 0
  }
}
