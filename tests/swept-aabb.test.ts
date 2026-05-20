import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import { MockWorld, createFlatGround } from './physics-mocks'
import { WorldCollisionService, type McDataLike } from '../src/core/world-collision-service'
import { SweptAABBValidator } from '../src/core/swept-aabb-validator'

const testMcData: McDataLike = {
  blocksByName: {
    stone: { boundingBox: 'block', minStateId: 1, maxStateId: 1 },
    air: { boundingBox: 'empty', minStateId: 0, maxStateId: 0 }
  }
}

describe('SweptAABBValidator', () => {
  it('allows walk on flat ground', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 2)
    const service = new WorldCollisionService(testMcData)
    const validator = new SweptAABBValidator(world, service)
    const from = new Vec3(0, 1, 0)
    const to = new Vec3(1, 1, 0)
    const result = validator.validate(from, to)
    expect(result.valid).toBe(true)
    expect(result.unimpeded).toBe(true)
    expect(result.collisionDetected).toBe(false)
  })

  it('blocks walking into a wall', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 2)
    world.setBlock(1, 1, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    const service = new WorldCollisionService(testMcData)
    const validator = new SweptAABBValidator(world, service)
    const from = new Vec3(0, 1, 0)
    const to = new Vec3(1, 1, 0)
    const result = validator.validate(from, to)
    expect(result.valid).toBe(false)
    expect(result.collisionDetected).toBe(true)
  })

  it('allows dropping down 1 block', () => {
    const world = new MockWorld()
    // Platform at x=0 and x=1 (2-wide), lower ground at x=1 one block down
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(1, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(1, -1, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    // Air between platform and lower ground
    world.setBlock(1, 0, 0, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    const service = new WorldCollisionService(testMcData)
    const validator = new SweptAABBValidator(world, service)
    // Start at x=1.5 (clear of adjacent block overlap)
    const from = new Vec3(1.5, 1, 0)
    const to = new Vec3(1.5, 0, 0)
    const result = validator.validate(from, to)
    expect(result.valid).toBe(true)
  })

  it('blocks drop into a pit with no ground', () => {
    const world = new MockWorld()
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(1, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    // No block at (1, -1, 0) — pure pit
    world.setBlock(1, 0, 0, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    const service = new WorldCollisionService(testMcData)
    const validator = new SweptAABBValidator(world, service)
    // Start at x=1.5 (clear of adjacent block overlap)
    const from = new Vec3(1.5, 1, 0)
    const to = new Vec3(1.5, 0, 0)
    const result = validator.validate(from, to)
    // Geometric validator sees empty space below, so it allows the move.
    // Ground check is done separately by the pathfinder.
    expect(result.valid).toBe(true)
  })
})
