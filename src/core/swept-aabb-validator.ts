import { Vec3 } from 'vec3'
import AABB from 'prismarine-physics/lib/aabb'
import { WorldCollisionService } from './world-collision-service'
import { getPlayerAABB } from './aabb-utils'
import { PLAYER_HALF_WIDTH } from './types'
import { aabbIntersects } from './aabb-utils'
import type { CollisionWorld, SweptValidationOptions } from './types'

/**
 * Result of a swept-AABB validation.
 */
export interface SweptValidationResult {
  /** True if the final position is within 0.5 blocks of the target. */
  valid: boolean
  /** The position the entity would actually end up at after collision resolution. */
  finalPos: Vec3
  /** True if the movement was completely unimpeded (no axis was truncated). */
  unimpeded: boolean
  /** Axis that caused the primary collision, if any. */
  blockedAxis: 'x' | 'y' | 'z' | null
  /** True if any horizontal collision was detected across any step. */
  collisionDetected: boolean
}

const STEP_HEIGHT = 0.6
const DEFAULT_STEPS = 8
const DEFAULT_MARGIN = 0.001

/**
 * Micro-simulates entity movement between two points using swept-AABB collision
 * against real block shapes, detecting intermediate collisions (fence corners,
 * trapdoor edges, stairs, slabs) that simple raycasts miss.
 *
 * Each movement is broken into micro-steps (default 8) and resolved with the
 * same axis order and step-up logic as vanilla Minecraft.
 */
export class SweptAABBValidator {
  constructor (
    private readonly world: CollisionWorld,
    private readonly collisionService: WorldCollisionService
  ) {}

  /**
   * Validate whether an entity can move from `from` to `to` without intersecting
   * solid blocks, by micro-stepping along the delta.
   *
   * @param from Start position.
   * @param to Target position.
   * @param options Validation options (steps, margin, onGround).
   */
  validate (
    from: Vec3,
    to: Vec3,
    options?: SweptValidationOptions
  ): SweptValidationResult {
    const steps = options?.steps ?? DEFAULT_STEPS
    const margin = options?.margin ?? DEFAULT_MARGIN
    const onGround = options?.onGround ?? true

    // If already inside a solid block, the movement is impossible.
    const initialBB = getPlayerAABB(from)
    if (this.intersectsSolid(initialBB)) {
      return { valid: false, finalPos: from, unimpeded: false, blockedAxis: null, collisionDetected: true }
    }

    let currentPos = from.clone()
    const totalDx = to.x - from.x
    const totalDy = to.y - from.y
    const totalDz = to.z - from.z

    let blockedAxis: 'x' | 'y' | 'z' | null = null
    let unimpeded = true
    let collisionDetected = false

    for (let i = 0; i < steps; i++) {
      // For the last step, use the exact remaining delta to avoid drift.
      let dx = (i === steps - 1) ? (to.x - currentPos.x) : (totalDx / steps)
      let dy = (i === steps - 1) ? (to.y - currentPos.y) : (totalDy / steps)
      let dz = (i === steps - 1) ? (to.z - currentPos.z) : (totalDz / steps)

      const result = this.moveEntityStep(currentPos, dx, dy, dz, onGround)

      currentPos = result.pos
      if (result.collidedHorizontally) {
        collisionDetected = true
      }

      // Detect whether this step was impeded on any axis.
      if (Math.abs(result.actualDx - dx) > margin) {
        blockedAxis = 'x'
        unimpeded = false
      }
      if (Math.abs(result.actualDy - dy) > margin) {
        blockedAxis = 'y'
        unimpeded = false
      }
      if (Math.abs(result.actualDz - dz) > margin) {
        blockedAxis = 'z'
        unimpeded = false
      }
    }

    // Final collision check: ensure the resolved position is not inside a solid block.
    const finalBB = getPlayerAABB(currentPos)
    if (this.intersectsSolid(finalBB)) {
      return { valid: false, finalPos: currentPos, unimpeded: false, blockedAxis: null, collisionDetected: true }
    }

    // Within 0.01 blocks is "close enough" for validation (only exact or near-exact arrivals pass).
    const dist = currentPos.distanceTo(to)
    const valid = dist < 0.01

    return {
      valid,
      finalPos: currentPos,
      unimpeded,
      blockedAxis,
      collisionDetected
    }
  }

  /**
   * Perform a single movement step with vanilla-style collision resolution.
   * Replicates prismarine-physics `moveEntity` logic for geometric validation.
   */
  private moveEntityStep (
    pos: Vec3,
    dx: number,
    dy: number,
    dz: number,
    onGround: boolean
  ): {
    pos: Vec3
    actualDx: number
    actualDy: number
    actualDz: number
    collidedHorizontally: boolean
    collidedVertically: boolean
  } {
    const oldVelX = dx
    const oldVelY = dy
    const oldVelZ = dz

    let playerBB = getPlayerAABB(pos)
    const queryBB = playerBB.clone().extend(dx, dy, dz)
    const surroundingBBs = this.getSurroundingBBs(queryBB)
    const oldBB = playerBB.clone()

    // Resolve Y first (vanilla order)
    for (const blockBB of surroundingBBs) {
      dy = blockBB.computeOffsetY(playerBB, dy)
    }
    playerBB.offset(0, dy, 0)

    // Resolve X
    for (const blockBB of surroundingBBs) {
      dx = blockBB.computeOffsetX(playerBB, dx)
    }
    playerBB.offset(dx, 0, 0)

    // Resolve Z
    for (const blockBB of surroundingBBs) {
      dz = blockBB.computeOffsetZ(playerBB, dz)
    }
    playerBB.offset(0, 0, dz)

    // Step-up logic (vanilla parity: walk up stairs / slabs)
    if (STEP_HEIGHT > 0 &&
      (onGround || (dy !== oldVelY && oldVelY < 0)) &&
      (dx !== oldVelX || dz !== oldVelZ)) {
      const oldVelXCol = dx
      const oldVelYCol = dy
      const oldVelZCol = dz
      const oldBBCol = playerBB.clone()

      dy = STEP_HEIGHT
      const stepQueryBB = oldBB.clone().extend(oldVelX, dy, oldVelZ)
      const stepSurroundingBBs = this.getSurroundingBBs(stepQueryBB)

      const BB1 = oldBB.clone()
      const BB2 = oldBB.clone()
      const BB_XZ = BB1.clone().extend(dx, 0, dz)

      let dy1 = dy
      let dy2 = dy
      for (const blockBB of stepSurroundingBBs) {
        dy1 = blockBB.computeOffsetY(BB_XZ, dy1)
        dy2 = blockBB.computeOffsetY(BB2, dy2)
      }
      BB1.offset(0, dy1, 0)
      BB2.offset(0, dy2, 0)

      let dx1 = oldVelX
      let dx2 = oldVelX
      for (const blockBB of stepSurroundingBBs) {
        dx1 = blockBB.computeOffsetX(BB1, dx1)
        dx2 = blockBB.computeOffsetX(BB2, dx2)
      }
      BB1.offset(dx1, 0, 0)
      BB2.offset(dx2, 0, 0)

      let dz1 = oldVelZ
      let dz2 = oldVelZ
      for (const blockBB of stepSurroundingBBs) {
        dz1 = blockBB.computeOffsetZ(BB1, dz1)
        dz2 = blockBB.computeOffsetZ(BB2, dz2)
      }
      BB1.offset(0, 0, dz1)
      BB2.offset(0, 0, dz2)

      const norm1 = dx1 * dx1 + dz1 * dz1
      const norm2 = dx2 * dx2 + dz2 * dz2

      if (norm1 > norm2) {
        dx = dx1
        dy = -dy1
        dz = dz1
        playerBB = BB1
      } else {
        dx = dx2
        dy = -dy2
        dz = dz2
        playerBB = BB2
      }

      for (const blockBB of stepSurroundingBBs) {
        dy = blockBB.computeOffsetY(playerBB, dy)
      }
      playerBB.offset(0, dy, 0)

      // Revert if the stepped path is no better than the non-stepped path.
      if (oldVelXCol * oldVelXCol + oldVelZCol * oldVelZCol >= dx * dx + dz * dz) {
        dx = oldVelXCol
        dy = oldVelYCol
        dz = oldVelZCol
        playerBB = oldBBCol
      }
    }

    // Convert AABB back to position
    const newPos = new Vec3(
      playerBB.minX + PLAYER_HALF_WIDTH,
      playerBB.minY,
      playerBB.minZ + PLAYER_HALF_WIDTH
    )

    const collidedHorizontally = dx !== oldVelX || dz !== oldVelZ
    const collidedVertically = dy !== oldVelY

    return {
      pos: newPos,
      actualDx: dx,
      actualDy: dy,
      actualDz: dz,
      collidedHorizontally,
      collidedVertically
    }
  }

  /**
   * Query all block AABBs that intersect the given query bounding box.
   * Mirrors vanilla `getSurroundingBBs` by checking one block below minY.
   */
  private getSurroundingBBs (queryBB: AABB): AABB[] {
    const result: AABB[] = []
    const cursor = new Vec3(0, 0, 0)
    for (cursor.y = Math.floor(queryBB.minY) - 1; cursor.y <= Math.floor(queryBB.maxY); cursor.y++) {
      for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); cursor.x++) {
          const block = this.world.getBlock(cursor)
          if (block) {
            const aabbs = this.collisionService.getBlockAABBs(block)
            result.push(...aabbs)
          }
        }
      }
    }
    return result
  }

  /**
   * Check whether the given AABB intersects any solid block in the world.
   */
  private intersectsSolid (aabb: AABB): boolean {
    const cursor = new Vec3(0, 0, 0)
    for (cursor.y = Math.floor(aabb.minY); cursor.y <= Math.floor(aabb.maxY); cursor.y++) {
      for (cursor.z = Math.floor(aabb.minZ); cursor.z <= Math.floor(aabb.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(aabb.minX); cursor.x <= Math.floor(aabb.maxX); cursor.x++) {
          const block = this.world.getBlock(cursor)
          if (!block || block.boundingBox === 'empty') continue
          const aabbs = this.collisionService.getBlockAABBs(block)
          for (const blockBB of aabbs) {
            if (aabbIntersects(aabb, blockBB)) return true
          }
        }
      }
    }
    return false
  }
}
