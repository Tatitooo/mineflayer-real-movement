import { Vec3 } from 'vec3'
import type { MovementNode, ControlInputs } from '../core/types'
import { yawToTarget } from '../execution/alignment-logic'

/**
 * PvP strafing pattern types.
 */
export type StrafePattern =
  | 'orbit'           // Circle around target
  | 'hitAndRun'       // Approach, hit, retreat
  | 'strafeAD'        // Simple A/D jiggle
  | 'circleStrafe'    // Tighter orbit with direction changes
  | 'retreat'         // Move away from target

/**
 * Options for PvP strafing behavior.
 */
export interface StrafeOptions {
  /** Preferred combat range (blocks). */
  preferredRange: number
  /** Range at which to start retreating. */
  retreatRange: number
  /** Range at which to close distance. */
  closeRange: number
  /** Orbital speed: yaw change per tick (radians). */
  orbitSpeed: number
  /** Direction change interval for A/D jiggle (ticks). */
  adJiggleInterval: number
  /** Sprint probability when approaching (0-1). */
  sprintProbability: number
  /** Whether to jump while strafing for crits. */
  jumpForCrits: boolean
}

export const DEFAULT_STRAFE_OPTIONS: StrafeOptions = {
  preferredRange: 3.0,
  retreatRange: 1.5,
  closeRange: 4.5,
  orbitSpeed: 0.12, // ~7 degrees/tick
  adJiggleInterval: 6,
  sprintProbability: 0.7,
  jumpForCrits: true
}

/**
 * Compute the orbital yaw around a target.
 * `direction` = 1 for clockwise, -1 for counter-clockwise.
 */
export function computeOrbitYaw (
  currentYaw: number,
  currentPos: Vec3,
  targetPos: Vec3,
  orbitSpeed: number,
  direction: number = 1
): number {
  const baseYaw = yawToTarget(currentPos, targetPos)
  // Orbiting means facing target + 90 degrees offset
  const orbitOffset = (Math.PI / 2) * direction
  let desiredYaw = baseYaw + orbitOffset

  // Normalize
  while (desiredYaw > Math.PI) desiredYaw -= 2 * Math.PI
  while (desiredYaw < -Math.PI) desiredYaw += 2 * Math.PI

  // Smooth turn toward desired yaw
  let diff = desiredYaw - currentYaw
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI

  const maxTurn = orbitSpeed * 1.5
  const clampedDiff = Math.max(-maxTurn, Math.min(maxTurn, diff))
  return currentYaw + clampedDiff
}

/**
 * Determine if the bot should attack based on distance and cooldown.
 */
export function shouldAttack (
  distance: number,
  attackCooldown: number, // 0 = ready, >0 = ticks remaining
  attackReach: number = 3.0
): boolean {
  return distance <= attackReach && attackCooldown <= 0
}

/**
 * Compute strafing controls based on the selected pattern.
 */
export function computeStrafeControls (
  currentNode: MovementNode,
  targetPos: Vec3,
  pattern: StrafePattern,
  attackCooldown: number,
  tickCounter: number,
  options: StrafeOptions = DEFAULT_STRAFE_OPTIONS
): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
  const pos = currentNode.pos
  const dx = targetPos.x - pos.x
  const dz = targetPos.z - pos.z
  const distance = Math.sqrt(dx * dx + dz * dz)

  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  let targetYaw = yawToTarget(pos, targetPos)
  let targetPitch = 0
  const canAttack = shouldAttack(distance, attackCooldown)

  switch (pattern) {
    case 'orbit': {
      // Circle around target while facing it
      const direction = (tickCounter % 120 < 60) ? 1 : -1 // switch direction periodically
      targetYaw = computeOrbitYaw(currentNode.vel.x === 0 && currentNode.vel.z === 0 ? targetYaw : Math.atan2(-currentNode.vel.x, -currentNode.vel.z), pos, targetPos, options.orbitSpeed, direction)
      inputs.forward = true
      inputs.sprint = Math.random() < options.sprintProbability && distance > options.closeRange
      break
    }

    case 'hitAndRun': {
      // Approach if far, retreat if too close
      if (distance > options.preferredRange) {
        inputs.forward = true
        inputs.sprint = true
      } else if (distance < options.retreatRange) {
        inputs.back = true
        targetYaw = yawToTarget(pos, targetPos) + Math.PI // face away
        while (targetYaw > Math.PI) targetYaw -= 2 * Math.PI
      } else {
        // In range: strafe side-to-side
        if ((Math.floor(tickCounter / options.adJiggleInterval) % 2) === 0) {
          inputs.left = true
        } else {
          inputs.right = true
        }
      }
      break
    }

    case 'strafeAD': {
      // Classic A/D jiggle while facing target
      targetYaw = yawToTarget(pos, targetPos)
      if ((Math.floor(tickCounter / options.adJiggleInterval) % 2) === 0) {
        inputs.left = true
      } else {
        inputs.right = true
      }
      if (distance > options.preferredRange) {
        inputs.forward = true
      }
      break
    }

    case 'circleStrafe': {
      // Tighter circle, more aggressive
      const direction = (tickCounter % 80 < 40) ? 1 : -1
      targetYaw = computeOrbitYaw(targetYaw, pos, targetPos, options.orbitSpeed * 1.3, direction)
      inputs.forward = true
      inputs.sprint = distance > options.closeRange
      break
    }

    case 'retreat': {
      targetYaw = yawToTarget(pos, targetPos) + Math.PI
      while (targetYaw > Math.PI) targetYaw -= 2 * Math.PI
      inputs.back = true
      inputs.sprint = true
      break
    }
  }

  // Crit jumps: jump if in range, on ground, and cooldown ready
  if (options.jumpForCrits && canAttack && currentNode.onGround && distance <= 3.5 && distance >= 2.5) {
    inputs.jump = true
  }

  return { ...inputs, targetYaw, targetPitch, shouldAttack: canAttack }
}

/**
 * Select the best strafe pattern given the tactical situation.
 */
export function selectStrafePattern (
  distance: number,
  botHealth: number,
  targetHealth: number,
  targetAttacking: boolean,
  options: StrafeOptions = DEFAULT_STRAFE_OPTIONS
): StrafePattern {
  // Low health: retreat
  if (botHealth < 6) return 'retreat'

  // Target is attacking and very close: strafeAD to dodge
  if (targetAttacking && distance < 2.5) return 'strafeAD'

  // Target low health: aggressive orbit
  if (targetHealth < 4) return 'circleStrafe'

  // Normal combat: hit and run
  if (distance > options.closeRange) return 'hitAndRun'

  // Default
  return 'orbit'
}

/**
 * Compute the pitch to look at a target (for bow or melee aim).
 */
export function computeAimPitch (
  from: Vec3,
  to: Vec3,
  projectileSpeed?: number, // blocks/s for bow prediction
  gravity?: number           // blocks/tick²
): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)

  if (projectileSpeed && gravity) {
    // Predictive aim for projectiles (simplified)
    const speed = projectileSpeed / 20 // blocks/tick
    const g = gravity
    const root = speed * speed * speed * speed - g * (g * horizontalDist * horizontalDist + 2 * dy * speed * speed)
    if (root < 0) {
      // Can't reach, aim high
      return -0.5
    }
    const pitch1 = Math.atan((speed * speed + Math.sqrt(root)) / (g * horizontalDist))
    const pitch2 = Math.atan((speed * speed - Math.sqrt(root)) / (g * horizontalDist))
    return -Math.min(pitch1, pitch2) // negative pitch = look up in Minecraft
  }

  // Direct aim for melee
  return -Math.atan2(dy, horizontalDist)
}

/**
 * Stateful PvP strafe controller that manages pattern switching.
 */
export class PvPStrafeController {
  private pattern: StrafePattern = 'orbit'
  private tickCounter = 0
  private options: StrafeOptions

  constructor (options?: Partial<StrafeOptions>) {
    this.options = { ...DEFAULT_STRAFE_OPTIONS, ...options }
  }

  /**
   * Tick the strafe controller.
   */
  tick (
    currentNode: MovementNode,
    targetPos: Vec3,
    attackCooldown: number,
    botHealth: number,
    targetHealth: number,
    targetAttacking: boolean
  ): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
    this.tickCounter++

    const distance = Math.sqrt(
      (targetPos.x - currentNode.pos.x) ** 2 +
      (targetPos.z - currentNode.pos.z) ** 2
    )

    // Re-evaluate pattern every 20 ticks
    if (this.tickCounter % 20 === 0) {
      this.pattern = selectStrafePattern(distance, botHealth, targetHealth, targetAttacking, this.options)
    }

    return computeStrafeControls(
      currentNode,
      targetPos,
      this.pattern,
      attackCooldown,
      this.tickCounter,
      this.options
    )
  }

  /** Force a specific pattern. */
  setPattern (pattern: StrafePattern): void {
    this.pattern = pattern
  }

  /** Current active pattern. */
  getPattern (): StrafePattern {
    return this.pattern
  }

  /** Reset state. */
  reset (): void {
    this.pattern = 'orbit'
    this.tickCounter = 0
  }
}
