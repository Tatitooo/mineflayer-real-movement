import { Vec3 } from 'vec3'
import AABB from 'prismarine-physics/lib/aabb'
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './types'

/**
 * Build a player AABB centered at the given position.
 * Player dimensions: 0.6 × 1.8 × 0.6.
 */
export function getPlayerAABB (pos: Vec3): AABB {
  const w = PLAYER_HALF_WIDTH
  return new AABB(
    pos.x - w,
    pos.y,
    pos.z - w,
    pos.x + w,
    pos.y + PLAYER_HEIGHT,
    pos.z + w
  )
}

/**
 * Build an AABB from raw min/max coordinates.
 */
export function makeAABB (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): AABB {
  return new AABB(minX, minY, minZ, maxX, maxY, maxZ)
}

/**
 * Build an AABB from a prismarine-physics shape tuple in world-space.
 */
export function shapeToWorldAABB (
  blockPos: Vec3,
  shape: [number, number, number, number, number, number]
): AABB {
  return new AABB(
    blockPos.x + shape[0],
    blockPos.y + shape[1],
    blockPos.z + shape[2],
    blockPos.x + shape[3],
    blockPos.y + shape[4],
    blockPos.z + shape[5]
  )
}

/**
 * Static AABB intersection test (no mutation).
 */
export function aabbIntersects (a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  )
}

/**
 * Check if a point is inside an AABB.
 */
export function aabbContainsPoint (box: AABB, p: Vec3): boolean {
  return (
    p.x >= box.minX && p.x <= box.maxX &&
    p.y >= box.minY && p.y <= box.maxY &&
    p.z >= box.minZ && p.z <= box.maxZ
  )
}

/**
 * Swept-AABB collision test along a single axis.
 * Returns the allowed offset after considering the obstacle.
 */
export function sweptAABBOffset (
  moving: AABB,
  obstacle: AABB,
  offsetX: number,
  offsetY: number,
  offsetZ: number
): { dx: number; dy: number; dz: number } {
  let dx = offsetX
  let dy = offsetY
  let dz = offsetZ

  // Resolve Y first, then X, then Z (matches vanilla order)
  if (obstacle.maxX > moving.minX && obstacle.minX < moving.maxX && obstacle.maxZ > moving.minZ && obstacle.minZ < moving.maxZ) {
    if (dy > 0.0 && obstacle.maxY <= moving.minY) {
      dy = Math.min(moving.minY - obstacle.maxY, dy)
    } else if (dy < 0.0 && obstacle.minY >= moving.maxY) {
      dy = Math.max(moving.maxY - obstacle.minY, dy)
    }
  }

  const movedY = moving.clone()
  movedY.offset(0, dy, 0)

  if (obstacle.maxY > movedY.minY && obstacle.minY < movedY.maxY && obstacle.maxZ > movedY.minZ && obstacle.minZ < movedY.maxZ) {
    if (dx > 0.0 && obstacle.maxX <= movedY.minX) {
      dx = Math.min(movedY.minX - obstacle.maxX, dx)
    } else if (dx < 0.0 && obstacle.minX >= movedY.maxX) {
      dx = Math.max(movedY.maxX - obstacle.minX, dx)
    }
  }

  const movedXY = movedY.clone()
  movedXY.offset(dx, 0, 0)

  if (obstacle.maxX > movedXY.minX && obstacle.minX < movedXY.maxX && obstacle.maxY > movedXY.minY && obstacle.minY < movedXY.maxY) {
    if (dz > 0.0 && obstacle.maxZ <= movedXY.minZ) {
      dz = Math.min(movedXY.minZ - obstacle.maxZ, dz)
    } else if (dz < 0.0 && obstacle.minZ >= movedXY.maxZ) {
      dz = Math.max(movedXY.maxZ - obstacle.minZ, dz)
    }
  }

  return { dx, dy, dz }
}

/**
 * Compute the bounding box that covers the space between two player positions.
 * Useful for swept collision queries.
 */
export function sweptQueryAABB (from: Vec3, to: Vec3): AABB {
  const minX = Math.min(from.x, to.x) - PLAYER_HALF_WIDTH
  const minY = Math.min(from.y, to.y)
  const minZ = Math.min(from.z, to.z) - PLAYER_HALF_WIDTH
  const maxX = Math.max(from.x, to.x) + PLAYER_HALF_WIDTH
  const maxY = Math.max(from.y, to.y) + PLAYER_HEIGHT
  const maxZ = Math.max(from.z, to.z) + PLAYER_HALF_WIDTH
  return new AABB(minX, minY, minZ, maxX, maxY, maxZ)
}
