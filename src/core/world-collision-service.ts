import { Vec3 } from 'vec3'
import AABB from 'prismarine-physics/lib/aabb'
import type { BlockCollisionInfo, CollisionWorld, ResolvedBlockCollision } from './types'

/**
 * Minimal interface for the minecraft-data collision shape registry.
 */
export interface McDataCollisionShapes {
  blocks: { [blockName: string]: number | number[] }
  shapes: { [shapeId: string]: Array<[number, number, number, number, number, number]> }
}

/**
 * Minimal interface for the minecraft-data block registry entry.
 */
export interface McDataBlockEntry {
  boundingBox?: 'block' | 'empty'
  minStateId?: number
  maxStateId?: number
}

/**
 * Minimal interface for the minecraft-data object we need.
 */
export interface McDataLike {
  blockCollisionShapes?: McDataCollisionShapes
  blocksByName: { [name: string]: McDataBlockEntry | undefined }
}

/**
 * Resolves precise AABB collision shapes for blocks using minecraft-data's
 * blockCollisionShapes registry. Falls back to full-block AABB when shapes
 * are unavailable.
 */
export class WorldCollisionService {
  private readonly mcData: McDataLike
  private readonly shapeCache: Map<string, ResolvedBlockCollision> = new Map()
  private readonly hasCollisionShapes: boolean

  constructor (mcData: McDataLike) {
    this.mcData = mcData
    this.hasCollisionShapes =
      mcData.blockCollisionShapes != null &&
      mcData.blockCollisionShapes.blocks != null &&
      mcData.blockCollisionShapes.shapes != null
  }

  /**
   * Resolve collision AABBs for a block by its name and optional stateId.
   * Results are cached by stateId when available.
   */
  resolveBlockCollision (blockName: string, stateId?: number): ResolvedBlockCollision {
    const cacheKey = stateId != null ? `${blockName}:${stateId}` : blockName
    const cached = this.shapeCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const result = this.computeBlockCollision(blockName, stateId)
    this.shapeCache.set(cacheKey, result)
    return result
  }

  /**
   * Get world-space AABBs for a block at a specific position.
   */
  getBlockAABBs (block: BlockCollisionInfo): AABB[] {
    const resolved = this.resolveBlockCollision(block.name, block.stateId)
    if (resolved.boundingBox === 'empty') {
      return []
    }
    return resolved.aabbs.map(shape => {
      // Clone and offset to world position
      const cloned = shape.clone()
      cloned.offset(block.position.x, block.position.y, block.position.z)
      return cloned
    })
  }

  /**
   * Get all collision AABBs in a world region (inclusive bounds).
   */
  getAABBsInRegion (world: CollisionWorld, min: Vec3, max: Vec3): AABB[] {
    const result: AABB[] = []
    const cursor = new Vec3(0, 0, 0)
    for (let y = Math.floor(min.y); y <= Math.floor(max.y); y++) {
      for (let z = Math.floor(min.z); z <= Math.floor(max.z); z++) {
        for (let x = Math.floor(min.x); x <= Math.floor(max.x); x++) {
          cursor.set(x, y, z)
          const block = world.getBlock(cursor)
          if (block) {
            const aabbs = this.getBlockAABBs(block)
            result.push(...aabbs)
          }
        }
      }
    }
    return result
  }

  private computeBlockCollision (blockName: string, stateId?: number): ResolvedBlockCollision {
    // Fallback when no collision shapes are available for this version
    if (!this.hasCollisionShapes) {
      const block = this.mcData.blocksByName[blockName]
      const boundingBox = block?.boundingBox ?? 'block'
      if (boundingBox === 'empty') {
        return {
          blockName,
          stateId: stateId ?? -1,
          aabbs: [],
          boundingBox: 'empty'
        }
      }
      return {
        blockName,
        stateId: stateId ?? -1,
        aabbs: [new AABB(0, 0, 0, 1, 1, 1)],
        boundingBox: 'block'
      }
    }

    const shapesRegistry = this.mcData.blockCollisionShapes!
    const shapeIds = shapesRegistry.blocks[blockName]

    if (shapeIds === undefined) {
      // Unknown block: assume full block
      return {
        blockName,
        stateId: stateId ?? -1,
        aabbs: [new AABB(0, 0, 0, 1, 1, 1)],
        boundingBox: 'block'
      }
    }

    // shapeIds can be a single number or an array of numbers (one per state variant)
    let shapeId: number
    if (typeof shapeIds === 'number') {
      shapeId = shapeIds
    } else if (Array.isArray(shapeIds)) {
      // Map stateId to the correct shape index
      const block = this.mcData.blocksByName[blockName]
      if (stateId != null && block?.minStateId != null) {
        const index = stateId - block.minStateId
        shapeId = shapeIds[Math.max(0, Math.min(index, shapeIds.length - 1))]
      } else {
        shapeId = shapeIds[0]
      }
    } else {
      shapeId = 0
    }

    const rawShapes = shapesRegistry.shapes[String(shapeId)]
    if (!rawShapes || rawShapes.length === 0) {
      return {
        blockName,
        stateId: stateId ?? -1,
        aabbs: [],
        boundingBox: 'empty'
      }
    }

    const aabbs = rawShapes.map(s => new AABB(s[0], s[1], s[2], s[3], s[4], s[5]))
    return {
      blockName,
      stateId: stateId ?? -1,
      aabbs,
      boundingBox: aabbs.length > 0 ? 'block' : 'empty'
    }
  }
}
