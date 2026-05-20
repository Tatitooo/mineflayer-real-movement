import { Vec3 } from 'vec3'

const ALIGN_THRESHOLD = 0.2
const ARRIVAL_THRESHOLD = 0.3

/**
 * Compute the yaw angle (in radians) required to face `target` from `pos`.
 * Matches Minecraft's yaw convention: 0 = +Z, PI/2 = -X, PI = -Z, -PI/2 = +X.
 */
export function yawToTarget (pos: Vec3, target: Vec3): number {
  const dx = target.x - pos.x
  const dz = target.z - pos.z
  return Math.atan2(-dx, dz)
}

/**
 * Compute the pitch angle (in radians) to look at `target` from `pos`.
 */
export function pitchToTarget (pos: Vec3, target: Vec3): number {
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const dz = target.z - pos.z
  const dist = Math.sqrt(dx * dx + dz * dz)
  return Math.atan2(dy, dist)
}

/**
 * Return the smallest signed angle difference between two yaws.
 * Result is in range [-PI, PI].
 */
export function yawDifference (currentYaw: number, targetYaw: number): number {
  let diff = targetYaw - currentYaw
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return diff
}

/**
 * Check whether the bot is horizontally aligned with the target position
 * within the default threshold (0.2 blocks).
 */
export function isAligned (pos: Vec3, target: Vec3, threshold = ALIGN_THRESHOLD): boolean {
  const dx = pos.x - target.x
  const dz = pos.z - target.z
  return Math.sqrt(dx * dx + dz * dz) <= threshold
}

/**
 * Check whether the bot has arrived at the target node (within 0.3 blocks in all axes).
 */
export function hasArrived (pos: Vec3, target: Vec3, threshold = ARRIVAL_THRESHOLD): boolean {
  return pos.distanceTo(target) <= threshold
}

/**
 * Determine whether the bot needs to jump to reach the target.
 * True if the target is at least 0.5 blocks higher than current position
 * and the bot is on ground.
 */
export function needsJump (pos: Vec3, target: Vec3, onGround: boolean): boolean {
  return onGround && (target.y - pos.y) >= 0.5
}

/**
 * Estimate the number of blocks the bot will coast before stopping,
 * given current horizontal velocity magnitude and ground friction.
 *
 * Vanilla ground friction decelerates at roughly 0.91× per tick on ground,
 * so stopping distance ≈ vel × (1 / (1 - 0.91)) ≈ vel × 11.1.
 * We use a conservative multiplier that works for both walk and sprint.
 */
export function stoppingDistance (horizontalVel: number): number {
  if (horizontalVel <= 0.01) return 0
  // Conservative: assume 8 ticks of coasting (slightly less than theoretical 11)
  return horizontalVel * 8
}
