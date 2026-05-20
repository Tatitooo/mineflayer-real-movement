import { Vec3 } from 'vec3'
import type { CollisionWorld, MovementNode, ControlInputs } from '../core/types'
import { getPlayerAABB } from '../core/aabb-utils'
import { aabbIntersects } from '../core/aabb-utils'
import AABB from 'prismarine-physics/lib/aabb'

/**
 * Detect whether a position is submerged in water or lava.
 * In vanilla, the player is "in water" when their AABB intersects a water block.
 */
export function isSubmerged (world: CollisionWorld, pos: Vec3, fluid: 'water' | 'lava' = 'water'): boolean {
  const playerBB = getPlayerAABB(pos)
  const minX = Math.floor(playerBB.minX)
  const maxX = Math.floor(playerBB.maxX)
  const minY = Math.floor(playerBB.minY)
  const maxY = Math.floor(playerBB.maxY)
  const minZ = Math.floor(playerBB.minZ)
  const maxZ = Math.floor(playerBB.maxZ)

  const cursor = new Vec3(0, 0, 0)
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        cursor.set(x, y, z)
        const block = world.getBlock(cursor)
        if (block && block.name === fluid) {
          const fluidBB = new AABB(x, y, z, x + 1, y + 1, z + 1)
          if (aabbIntersects(playerBB, fluidBB)) return true
        }
      }
    }
  }
  return false
}

/**
 * Detect whether the player is in a 1-block-high water tunnel.
 * This is important because vanilla swim mechanics change: the player swims
 * horizontally and cannot stand; they must use sprint-swim to move fast.
 */
export function is1BlockTunnel (world: CollisionWorld, pos: Vec3): boolean {
  const floorY = Math.floor(pos.y)
  const ceilY = Math.floor(pos.y + 1.8)
  // Tunnel = ceiling is solid and floor is solid, with water in between
  const floorBlock = world.getBlock(new Vec3(Math.floor(pos.x), floorY - 1, Math.floor(pos.z)))
  const ceilBlock = world.getBlock(new Vec3(Math.floor(pos.x), ceilY, Math.floor(pos.z)))
  const isSolid = (b: ReturnType<CollisionWorld['getBlock']>) => b != null && b.boundingBox !== 'empty'
  if (!isSolid(floorBlock) || !isSolid(ceilBlock)) return false
  return isSubmerged(world, pos, 'water')
}

/**
 * Detect a bubble column at the given position.
 * Returns 'up', 'down', or 'none' depending on the block type below.
 */
export function getBubbleColumnDirection (world: CollisionWorld, pos: Vec3): 'up' | 'down' | 'none' {
  const floorY = Math.floor(pos.y - 0.001)
  const block = world.getBlock(new Vec3(Math.floor(pos.x), floorY, Math.floor(pos.z)))
  if (!block) return 'none'
  if (block.name === 'bubble_column') {
    // In vanilla, bubble columns have a property 'drag' true = down, false = up
    // Mock worlds don't carry this, so we default to 'up' for upward magma,
    // but in real integration the bot can read block.metadata or block.properties.
    // Here we use a simple heuristic: look one block below for magma/soul_sand.
    const below = world.getBlock(new Vec3(Math.floor(pos.x), floorY - 1, Math.floor(pos.z)))
    if (below && below.name === 'magma_block') return 'down'
    if (below && below.name === 'soul_sand') return 'up'
    return 'up'
  }
  return 'none'
}

/**
 * Compute control inputs for swimming toward a target.
 * In water:
 * - Forward swim is slower than walking; sprint-swim (ctrl) is much faster.
 * - To ascend, hold jump (space). To descend, hold sneak.
 * - Depth Strider enchantment increases speed (handled at higher layer).
 */
export function computeSwimControls (
  current: MovementNode,
  target: Vec3,
  inWater: boolean,
  is1BlockTunnelFlag: boolean
): ControlInputs & { targetYaw: number; targetPitch: number } {
  const pos = current.pos
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const dz = target.z - pos.z

  const horizDist = Math.sqrt(dx * dx + dz * dz)
  const targetYaw = horizDist > 0.001 ? Math.atan2(-dx, -dz) : current.pos.y
  const targetPitch = horizDist > 0.001 ? Math.atan2(dy, horizDist) : 0

  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  if (!inWater) {
    return { ...inputs, targetYaw, targetPitch }
  }

  // Horizontal movement
  if (horizDist > 0.05) {
    inputs.forward = true
    // Sprint-swim when far away (vanilla "sprint" underwater = faster swim)
    inputs.sprint = true
  }

  // Vertical movement
  if (dy > 0.2) {
    inputs.jump = true // swim up
  } else if (dy < -0.2) {
    inputs.sneak = true // swim down
  }

  // In 1-block tunnel, we should not jump (would hit ceiling) and should stay crouched
  if (is1BlockTunnelFlag) {
    inputs.jump = false
    // If we need to go up in a tunnel, we must find an opening; here we just stop jumping.
  }

  return { ...inputs, targetYaw, targetPitch }
}

/**
 * Estimate ticks to swim a straight-line distance in water.
 * Vanilla swim speed: ~2.2 blocks/s. Sprint-swim: ~3.6 blocks/s.
 * With Depth Strider III: ~5.4 blocks/s sprint-swim.
 */
export function estimateSwimTicks (from: Vec3, to: Vec3, depthStriderLevel: number): number {
  const dist = from.distanceTo(to)
  const baseSpeed = 3.6 // sprint-swim base
  const speed = baseSpeed + (depthStriderLevel * 0.6)
  return Math.ceil((dist / speed) * 20) + 4 // +4 for acceleration / turn overhead
}

/**
 * Generate a swim edge if the target block is water or the path goes through water.
 * This is used by the edge generator to add underwater movement edges.
 */
export function canSwimTo (
  world: CollisionWorld,
  from: Vec3,
  to: Vec3
): { valid: boolean; is1BlockTunnel: boolean } {
  // The destination must be water or have water in between
  if (!isSubmerged(world, to, 'water')) {
    return { valid: false, is1BlockTunnel: false }
  }

  // Check if the swept path is fully submerged (or at least the midpoint)
  const mid = new Vec3((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  if (!isSubmerged(world, mid, 'water')) {
    return { valid: false, is1BlockTunnel: false }
  }

  const tunnel = is1BlockTunnel(world, to)
  return { valid: true, is1BlockTunnel: tunnel }
}
