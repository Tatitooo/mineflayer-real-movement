import { Vec3 } from 'vec3'
import type { BotLike } from '../execution/executor'
import type { ControlInputs } from '../core/types'

/**
 * Result of analyzing a knockback event.
 */
export interface KnockbackAnalysis {
  /** The impulse vector applied by the knockback (damage + velocity change). */
  impulse: Vec3
  /** Estimated number of ticks before the bot regains control. */
  recoveryTicks: number
  /** Direction the bot should strafe to counter the knockback. */
  counterStrafe: Vec3
  /** Whether the bot is still airborne from the knockback. */
  airborne: boolean
}

/**
 * Configuration for knockback recovery behavior.
 */
export interface KnockbackRecoveryOptions {
  /** Velocity threshold below which knockback is ignored. */
  velocityThreshold: number
  /** Maximum ticks to wait for natural friction to stop sliding. */
  maxRecoveryTicks: number
  /** How strongly to apply counter-strafe (0.0 - 1.0). */
  counterStrafeStrength: number
}

const DEFAULT_RECOVERY_OPTIONS: KnockbackRecoveryOptions = {
  velocityThreshold: 0.15,
  maxRecoveryTicks: 40,
  counterStrafeStrength: 0.6
}

/**
 * Analyze knockback from a velocity delta and current state.
 *
 * In vanilla, knockback applies a sudden velocity impulse. The entity slides
 * until friction (ground) or gravity (air) brings velocity back to near-zero.
 * This function computes the optimal counter-strafe direction.
 */
export function analyzeKnockback (
  currentVelocity: Vec3,
  previousVelocity: Vec3,
  onGround: boolean,
  options?: Partial<KnockbackRecoveryOptions>
): KnockbackAnalysis | null {
  const opts = { ...DEFAULT_RECOVERY_OPTIONS, ...options }

  const impulse = currentVelocity.minus(previousVelocity)
  const impulseMag = Math.sqrt(impulse.x * impulse.x + impulse.y * impulse.y + impulse.z * impulse.z)

  if (impulseMag < opts.velocityThreshold) {
    return null
  }

  // Counter-strafe = opposite of horizontal impulse, normalized
  const horizontalImpulse = new Vec3(impulse.x, 0, impulse.z)
  const hMag = Math.sqrt(horizontalImpulse.x * horizontalImpulse.x + horizontalImpulse.z * horizontalImpulse.z)
  const counterStrafe = hMag > 0.001
    ? new Vec3(-horizontalImpulse.x / hMag, 0, -horizontalImpulse.z / hMag)
    : new Vec3(0, 0, 0)

  // Recovery time estimate: on ground friction is fast (~3-8 ticks), in air slower (~15-30 ticks)
  const recoveryTicks = onGround ? 6 : 20

  return {
    impulse,
    recoveryTicks: Math.min(recoveryTicks, opts.maxRecoveryTicks),
    counterStrafe,
    airborne: !onGround
  }
}

/**
 * Compute control inputs to recover from knockback.
 *
 * Strategy:
 * - If on ground: briefly hold the counter-strafe direction, then stop.
 * - If in air: do NOT press forward/back; let gravity work, only adjust yaw.
 * - Once horizontal velocity is near zero, report recovered.
 */
export function computeRecoveryControls (
  analysis: KnockbackAnalysis,
  currentVel: Vec3,
  currentYaw: number
): ControlInputs & { targetYaw: number; recovered: boolean } {
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  const hVel = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z)
  const recovered = hVel < 0.08

  if (recovered) {
    return { ...inputs, targetYaw: currentYaw, recovered: true }
  }

  if (analysis.airborne) {
    // In air: no WASD, just align yaw for landing
    return { ...inputs, targetYaw: currentYaw, recovered: false }
  }

  // On ground: apply counter-strafe by mapping the vector to left/right/forward/back
  const cs = analysis.counterStrafe
  const forwardDot = Math.cos(currentYaw) * cs.x + Math.sin(currentYaw) * cs.z
  const rightDot = Math.cos(currentYaw + Math.PI / 2) * cs.x + Math.sin(currentYaw + Math.PI / 2) * cs.z

  if (forwardDot > 0.3) inputs.forward = true
  if (forwardDot < -0.3) inputs.back = true
  if (rightDot > 0.3) inputs.right = true
  if (rightDot < -0.3) inputs.left = true

  return { ...inputs, targetYaw: currentYaw, recovered: false }
}

/**
 * Stateful knockback recovery tracker that hooks into a BotLike instance.
 *
 * Usage:
 *   const recovery = new KnockbackRecovery(bot)
 *   recovery.start()
 *   // On each tick:
 *   const state = recovery.tick()
 *   if (state.recovered) { resumePathfinder() }
 */
export class KnockbackRecoveryTracker {
  private previousVelocity = new Vec3(0, 0, 0)
  private activeAnalysis: KnockbackAnalysis | null = null
  private recoveryTicksRemaining = 0
  private readonly options: KnockbackRecoveryOptions

  constructor (
    private readonly bot: BotLike,
    options?: Partial<KnockbackRecoveryOptions>
  ) {
    this.options = { ...DEFAULT_RECOVERY_OPTIONS, ...options }
  }

  /**
   * Call this every physics tick. Detects knockback, manages recovery state,
   * and returns the current recovery status plus recommended control inputs.
   */
  tick (): {
    recovering: boolean
    recovered: boolean
    controls: ControlInputs & { targetYaw: number }
  } {
    const vel = this.bot.entity.velocity
    const onGround = this.bot.entity.onGround
    const yaw = this.bot.entity.yaw

    // Detect new knockback if not already recovering
    if (!this.activeAnalysis) {
      const analysis = analyzeKnockback(vel, this.previousVelocity, onGround, this.options)
      if (analysis) {
        this.activeAnalysis = analysis
        this.recoveryTicksRemaining = analysis.recoveryTicks
      }
    }

    this.previousVelocity = vel.clone()

    if (!this.activeAnalysis) {
      return {
        recovering: false,
        recovered: false,
        controls: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, targetYaw: yaw }
      }
    }

    this.recoveryTicksRemaining--

    const result = computeRecoveryControls(this.activeAnalysis, vel, yaw)

    // If recovered or timeout, clear analysis
    if (result.recovered || this.recoveryTicksRemaining <= 0) {
      this.activeAnalysis = null
      return {
        recovering: false,
        recovered: true,
        controls: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, targetYaw: yaw }
      }
    }

    return {
      recovering: true,
      recovered: false,
      controls: result
    }
  }

  /**
   * Reset the tracker (e.g. after manually teleporting or re-planning).
   */
  reset (): void {
    this.activeAnalysis = null
    this.recoveryTicksRemaining = 0
    this.previousVelocity = new Vec3(0, 0, 0)
  }
}
