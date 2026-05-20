import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import { MockWorld, createFlatGround, createTree } from './physics-mocks'
import { AStarPathfinder } from '../src/pathfinding/astar-basic'
import { GoalBlock, GoalNear } from '../src/pathfinding/goals'
import { WorldCollisionService, type McDataLike } from '../src/core/world-collision-service'

const testMcData: McDataLike = {
  blocksByName: {
    stone: { boundingBox: 'block', minStateId: 1, maxStateId: 1 },
    oak_log: { boundingBox: 'block', minStateId: 100, maxStateId: 100 },
    oak_leaves: { boundingBox: 'block', minStateId: 200, maxStateId: 200 },
    air: { boundingBox: 'empty', minStateId: 0, maxStateId: 0 }
  }
}

function createPathfinder (world: MockWorld) {
  const service = new WorldCollisionService(testMcData)
  return new AStarPathfinder(world, service)
}

describe('A* Pathfinder', () => {
  it('finds straight line on flat ground', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 5)
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(4, 1, 0))
    const result = pf.findPath(new Vec3(0, 1, 0), goal)
    expect(result.status).toBe('success')
    expect(result.path.length).toBeGreaterThanOrEqual(2)
    const last = result.path[result.path.length - 1]
    expect(last.pos.x).toBeCloseTo(4, 0)
    expect(last.pos.z).toBeCloseTo(0, 0)
  })

  it('avoids a tree obstacle', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 10)
    createTree(world, 3, 0)
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(6, 1, 0))
    const result = pf.findPath(new Vec3(0, 1, 0), goal)
    expect(result.status).toBe('success')
    for (const node of result.path) {
      const bx = Math.round(node.pos.x)
      const bz = Math.round(node.pos.z)
      if (bx === 3 && bz === 0) {
        throw new Error(`Path intersects tree trunk at ${node.pos.x},${node.pos.y},${node.pos.z}`)
      }
    }
    const last = result.path[result.path.length - 1]
    expect(last.pos.x).toBeCloseTo(6, 0)
  })

  it('climbs a 1-block hill', () => {
    const world = new MockWorld()
    for (let x = -2; x < 3; x++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(x, 0, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      }
    }
    for (let x = 3; x <= 6; x++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(x, 1, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      }
    }
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(5, 2, 0))
    const result = pf.findPath(new Vec3(0, 1, 0), goal)
    expect(result.status).toBe('success')
    const last = result.path[result.path.length - 1]
    expect(last.pos.x).toBeCloseTo(5, 0)
    expect(last.pos.y).toBeCloseTo(2, 0)
  })

  it('descends a 1-block hill', () => {
    const world = new MockWorld()
    for (let x = -2; x < 3; x++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(x, 1, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      }
    }
    for (let x = 3; x <= 6; x++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(x, 0, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      }
    }
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(5, 1, 0))
    const result = pf.findPath(new Vec3(0, 2, 0), goal)
    expect(result.status).toBe('success')
    const last = result.path[result.path.length - 1]
    expect(last.pos.x).toBeCloseTo(5, 0)
    expect(last.pos.y).toBeCloseTo(1, 0)
  })
  it('returns noPath when completely blocked', () => {
    const world = new MockWorld()
    // Enclosed room with inner wall blocking the corridor
    for (let x = -2; x <= 7; x++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(x, 0, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
        world.setBlock(x, 4, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
      }
    }
    for (let x = -2; x <= 7; x++) {
      for (let y = 1; y <= 3; y++) {
        world.setBlock(x, y, -2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
        world.setBlock(x, y, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
      }
    }
    for (let z = -2; z <= 2; z++) {
      for (let y = 1; y <= 3; y++) {
        world.setBlock(-2, y, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
        world.setBlock(7, y, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
      }
    }
    // Inner wall blocking the corridor at x=2..4
    for (let x = 2; x <= 4; x++) {
      for (let y = 1; y <= 3; y++) {
        for (let z = -2; z <= 2; z++) {
          world.setBlock(x, y, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0,0,0,1,1,1]] })
        }
      }
    }
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(5, 1, 0))
    const result = pf.findPath(new Vec3(0, 1, 0), goal, 2000)
    expect(result.status).toBe('noPath')
  })

  it('crosses a 1-block gap', () => {
    const world = new MockWorld()
    for (let z = -1; z <= 1; z++) {
      world.setBlock(0, 0, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(2, 0, z, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    }
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(2, 1, 0))
    const result = pf.findPath(new Vec3(0, 1, 0), goal)
    expect(result.status).toBe('success')
    const last = result.path[result.path.length - 1]
    expect(last.pos.x).toBeCloseTo(2, 0)
  })

  it('respects maxSearchDistance in open world', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 5)
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(4, 1, 0))
    // With maxSearchDistance = 2, the pathfinder should not find a path to x=4
    const result = pf.findPath(new Vec3(0, 1, 0), goal, 10000, 2)
    expect(result.status).toBe('noPath')

    // Without maxSearchDistance, it should succeed
    const result2 = pf.findPath(new Vec3(0, 1, 0), goal, 10000)
    expect(result2.status).toBe('success')
  })

  it('uses diagonal edges when corner is clear', () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 3)
    const pf = createPathfinder(world)
    const goal = new GoalBlock(new Vec3(3, 1, 3))
    const result = pf.findPath(new Vec3(0, 1, 0), goal)
    expect(result.status).toBe('success')
    // Path should be reasonably short; with diagonals it should be ~3-4 steps instead of 6
    expect(result.path.length).toBeLessThanOrEqual(5)
  })
})

describe('Goals', () => {
  it('GoalBlock accepts positions within radius', () => {
    const goal = new GoalBlock(new Vec3(10, 1, 10), 1)
    expect(goal.isEnd(new Vec3(10, 1, 10))).toBe(true)
    expect(goal.isEnd(new Vec3(11, 1, 10))).toBe(true)
    expect(goal.isEnd(new Vec3(12, 1, 10))).toBe(false)
  })

  it('GoalNear accepts positions within radius', () => {
    const goal = new GoalNear(new Vec3(10, 1, 10), 2)
    expect(goal.isEnd(new Vec3(10, 1, 10))).toBe(true)
    expect(goal.isEnd(new Vec3(11, 1, 10))).toBe(true)
    expect(goal.isEnd(new Vec3(13, 1, 10))).toBe(false)
  })
})
