import { Vec3 } from 'vec3'
import type { MovementNode, ControlInputs } from '../core/types'
import { yawToTarget, yawDifference, isAligned, needsJump, stoppingDistance } from './alignment-logic'

const SPRINT_SPEED = 5.6 // blocks/s (rough vanilla sprint speed)
const WALK_SPEED = 4.3 // blocks/s (rough vanilla walk speed)
const TICK_RATE = 20 // ticks per second

/**
 * Compute control inputs to move from `current` toward `target` node.
 *
 * This considers:
 * - Yaw alignment: the bot must face the target before moving forward.
 * - Horizontal offset: if off-path by >0.2 blocks, use strafing (A/D).
 * - Vertical delta: if target is higher, jump; if lower and no ground below, just walk (fall).
 * - Sprint: enabled when the target is far enough and on same Y.
 * - Momentum braking: releases forward/sprint early when close to target
 *   to avoid overshooting due to residual velocity.
 * - Close-target conservatism: when <1 block away, disables strafing and
 *   sprint to reduce circling / oscillation.
 */
export function computeControlInputs (
  current: MovementNode,
  target: MovementNode,
  currentYaw: number
): ControlInputs & { targetYaw: number; targetPitch: number } {
  const pos = current.pos
  const targetPos = target.pos

  const targetYaw = yawToTarget(pos, targetPos)
  const yawDiff = yawDifference(currentYaw, targetYaw)
  const aligned = isAligned(pos, targetPos)

  // Default: no inputs
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  const horizDist = Math.sqrt(
    (targetPos.x - pos.x) ** 2 +
    (targetPos.z - pos.z) ** 2
  )

  const horizVel = Math.sqrt(current.vel.x ** 2 + current.vel.z ** 2)
  const stopDist = stoppingDistance(horizVel)

  // If not yaw-aligned within ~15 degrees, don't walk forward yet
  const yawAligned = Math.abs(yawDiff) < 0.25 // ~14 degrees

  // --- CLOSE-TARGET CONSERVATIVE MODE (<= 1.5 blocks horizontal) ---
  // When very close horizontally, lateral drift from yaw misalignment is
  // the main cause of circling. We disable sprint and strafing, and only
  // walk forward if nearly perfectly aligned. Jumping is still allowed.
  if (horizDist <= 1.5) {
    if (yawAligned && horizDist > 0.15 + stopDist * 0.5) {
      inputs.forward = true
    }
    if (needsJump(pos, targetPos, current.onGround)) {
      inputs.jump = true
    }
    // No sprint, no strafe in close mode
    return { ...inputs, targetYaw, targetPitch: 0 }
  }

  if (!yawAligned) {
    // Don't move forward until we face the target
    return { ...inputs, targetYaw, targetPitch: 0 }
  }

  // Sprint if far away, roughly same Y, on ground, and not about to overshoot
  const sameY = Math.abs(targetPos.y - pos.y) < 0.6
  const sprintSafe = sameY && horizDist > 2.0 + stopDist && current.onGround
  inputs.sprint = sprintSafe

  // Forward if we still need to cover horizontal distance,
  // but release early to let momentum coast the remaining distance.
  const forwardSafe = horizDist > 0.2 + stopDist
  if (forwardSafe) {
    inputs.forward = true
  }

  // Strafe correction if off the direct line to target,
  // but only when we're not extremely close (handled above).
  if (!aligned && horizDist > 0.8) {
    const dx = targetPos.x - pos.x
    const dz = targetPos.z - pos.z
    const dirX = dx / horizDist
    const dirZ = dz / horizDist
    const lateralX = pos.x - targetPos.x
    const lateralZ = pos.z - targetPos.z
    const lateralDot = lateralX * dirZ - lateralZ * dirX // cross product (2D)

    if (lateralDot > 0.15) {
      inputs.left = true
    } else if (lateralDot < -0.15) {
      inputs.right = true
    }
  }

  // Jump if target is higher and we're on ground
  if (needsJump(pos, targetPos, current.onGround)) {
    inputs.jump = true
    inputs.sprint = false // sprint-jump requires special handling; for now just jump
  }

  return { ...inputs, targetYaw, targetPitch: 0 }
}

/**
 * Estimate the number of ticks needed to traverse a straight line segment.
 * Used by the executor for timeout / replanning decisions.
 */
export function estimateTicks (from: Vec3, to: Vec3, sprinting: boolean): number {
  const dist = from.distanceTo(to)
  const speed = sprinting ? SPRINT_SPEED : WALK_SPEED
  return Math.ceil((dist / speed) * TICK_RATE) + 2 // +2 for acceleration / jump overhead
}
