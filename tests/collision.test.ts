import { describe, it, expect, beforeEach } from 'bun:test'
import { Vec3 } from 'vec3'
import AABB from 'prismarine-physics/lib/aabb'
import { getPlayerAABB, aabbIntersects, aabbContainsPoint, sweptQueryAABB } from '../src/core/aabb-utils'
import { WorldCollisionService, type McDataLike } from '../src/core/world-collision-service'
import { MockWorld, createFlatGround, createTree } from './physics-mocks'

describe('AABB Utils', () => {
  it('getPlayerAABB centers at position with correct dimensions', () => {
    const pos = new Vec3(10, 64, -20)
    const box = getPlayerAABB(pos)
    expect(box.minX).toBe(9.7) // 10 - 0.3
    expect(box.maxX).toBe(10.3) // 10 + 0.3
    expect(box.minY).toBe(64)
    expect(box.maxY).toBe(65.8) // 64 + 1.8
    expect(box.minZ).toBe(-20.3)
    expect(box.maxZ).toBe(-19.7)
  })

  it('aabbIntersects detects overlapping boxes', () => {
    const a = new AABB(0, 0, 0, 2, 2, 2)
    const b = new AABB(1, 1, 1, 3, 3, 3)
    expect(aabbIntersects(a, b)).toBe(true)
  })

  it('aabbIntersects rejects separated boxes', () => {
    const a = new AABB(0, 0, 0, 1, 1, 1)
    const b = new AABB(2, 2, 2, 3, 3, 3)
    expect(aabbIntersects(a, b)).toBe(false)
  })

  it('aabbContainsPoint works for inside and outside', () => {
    const box = new AABB(0, 0, 0, 1, 1, 1)
    expect(aabbContainsPoint(box, new Vec3(0.5, 0.5, 0.5))).toBe(true)
    expect(aabbContainsPoint(box, new Vec3(1.5, 0.5, 0.5))).toBe(false)
  })

  it('sweptQueryAABB covers movement span', () => {
    const from = new Vec3(0, 0, 0)
    const to = new Vec3(5, 2, -3)
    const box = sweptQueryAABB(from, to)
    expect(box.minX).toBe(-0.3)
    expect(box.maxX).toBe(5.3)
    expect(box.minY).toBe(0)
    expect(box.maxY).toBe(3.8) // 2 + 1.8
    expect(box.minZ).toBe(-3.3)
    expect(box.maxZ).toBe(0.3)
  })
})

describe('WorldCollisionService', () => {
  let service: WorldCollisionService

  it('resolves stone to full block AABB', () => {
    const mcData: McDataLike = {
      blocksByName: {
        stone: { boundingBox: 'block', minStateId: 1, maxStateId: 1 }
      }
    }
    service = new WorldCollisionService(mcData)
    const resolved = service.resolveBlockCollision('stone', 1)
    expect(resolved.blockName).toBe('stone')
    expect(resolved.aabbs.length).toBe(1)
    expect(resolved.aabbs[0].minX).toBe(0)
    expect(resolved.aabbs[0].maxX).toBe(1)
    expect(resolved.boundingBox).toBe('block')
  })

  it('resolves empty boundingBox to no AABBs', () => {
    const mcData: McDataLike = {
      blocksByName: {
        air: { boundingBox: 'empty', minStateId: 0, maxStateId: 0 }
      }
    }
    service = new WorldCollisionService(mcData)
    const resolved = service.resolveBlockCollision('air', 0)
    expect(resolved.aabbs.length).toBe(0)
    expect(resolved.boundingBox).toBe('empty')
  })

  it('uses blockCollisionShapes when available', () => {
    const mcData: McDataLike = {
      blockCollisionShapes: {
        blocks: {
          stone_slab: 5
        },
        shapes: {
          '5': [[0, 0, 0, 1, 0.5, 1]]
        }
      },
      blocksByName: {
        stone_slab: { boundingBox: 'block', minStateId: 10, maxStateId: 11 }
      }
    }
    service = new WorldCollisionService(mcData)
    const resolved = service.resolveBlockCollision('stone_slab', 10)
    expect(resolved.aabbs.length).toBe(1)
    expect(resolved.aabbs[0].maxY).toBe(0.5)
  })

  it('selects correct shape for stateId variants', () => {
    const mcData: McDataLike = {
      blockCollisionShapes: {
        blocks: {
          stair: [10, 11]
        },
        shapes: {
          '10': [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]],
          '11': [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]]
        }
      },
      blocksByName: {
        stair: { boundingBox: 'block', minStateId: 100, maxStateId: 101 }
      }
    }
    service = new WorldCollisionService(mcData)
    const resolved0 = service.resolveBlockCollision('stair', 100)
    expect(resolved0.aabbs.length).toBe(2)
    expect(resolved0.aabbs[1].maxZ).toBe(0.5)

    const resolved1 = service.resolveBlockCollision('stair', 101)
    expect(resolved1.aabbs[1].minZ).toBe(0.5)
  })

  it('caches resolved shapes', () => {
    const mcData: McDataLike = {
      blocksByName: {
        stone: { boundingBox: 'block', minStateId: 1, maxStateId: 1 }
      }
    }
    service = new WorldCollisionService(mcData)
    const r1 = service.resolveBlockCollision('stone', 1)
    const r2 = service.resolveBlockCollision('stone', 1)
    expect(r1).toBe(r2) // same object reference
  })

  it('returns world-space AABBs for positioned blocks', () => {
    const mcData: McDataLike = {
      blocksByName: {
        stone: { boundingBox: 'block', minStateId: 1, maxStateId: 1 }
      }
    }
    service = new WorldCollisionService(mcData)
    const aabbs = service.getBlockAABBs({
      position: new Vec3(5, 10, 7),
      name: 'stone',
      stateId: 1,
      boundingBox: 'block',
      shapes: [[0, 0, 0, 1, 1, 1]]
    })
    expect(aabbs.length).toBe(1)
    expect(aabbs[0].minX).toBe(5)
    expect(aabbs[0].maxY).toBe(11)
    expect(aabbs[0].minZ).toBe(7)
  })
})

describe('MockWorld', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
  })

  it('stores and retrieves blocks', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    const block = world.getBlock(new Vec3(0, 0, 0))
    expect(block).not.toBeNull()
    expect(block!.name).toBe('stone')
  })

  it('returns null for empty positions', () => {
    expect(world.getBlock(new Vec3(0, 0, 0))).toBeNull()
  })

  it('creates flat ground', () => {
    createFlatGround(world, 0, 2)
    expect(world.getBlock(new Vec3(0, 0, 0))?.name).toBe('stone')
    expect(world.getBlock(new Vec3(2, 0, 2))?.name).toBe('stone')
    expect(world.getBlock(new Vec3(0, 1, 0))).toBeNull()
  })

  it('creates a tree obstacle', () => {
    createTree(world, 0, 0)
    expect(world.getBlock(new Vec3(0, 1, 0))?.name).toBe('oak_log')
    expect(world.getBlock(new Vec3(1, 3, 1))?.name).toBe('oak_leaves')
  })
})
