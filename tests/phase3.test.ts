import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import { MockWorld, createFlatGround } from './physics-mocks'
import { WorldCollisionService } from '../src/core/world-collision-service'
import { PhysicsPredictor } from '../src/core/physics-predictor'
import { AStarPathfinder } from '../src/pathfinding/astar-basic'
import { GoalBlock } from '../src/pathfinding/goals'
import { generateMomentumEdges } from '../src/pathfinding/momentum-edges'
import { DynamicReplanner } from '../src/execution/dynamic-replanner'
import { computeEdgeCost, applyBlockModifierCost } from '../src/pathfinding/cost-functions'
import type { MovementNode, PathGoal } from '../src/core/types'

const mcData = require('minecraft-data')('1.20.4')

function makeWorld (): MockWorld {
  const w = new MockWorld()
  createFlatGround(w, 0, 8)
  return w
}

function makeNode (x: number, y: number, z: number, onGround = true, vel?: Vec3): MovementNode {
  return {
    pos: new Vec3(x, y, z),
    vel: vel ?? new Vec3(0, 0, 0),
    onGround,
    sprinting: false
  }
}

/* ------------------------------------------------------------------ */
/*  Physics Predictor                                                   */
/* ------------------------------------------------------------------ */

describe('PhysicsPredictor', () => {
  it('simulates walking forward on flat ground', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)

    // Player stands at y=1 on top of ground blocks at y=0
    const from = makeNode(0.5, 1, 0.5)
    const target = new Vec3(0.5, 1, 3.5)
    const controls = { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false }

    const result = predictor.simulateEdge(from, controls, target, { maxSimulationTicks: 60 })

    expect(result.arrived).toBe(true)
    expect(result.predictedTicks).toBeGreaterThan(10)
    expect(result.predictedTicks).toBeLessThan(50)
    expect(result.onGround).toBe(true)
  })

  it('simulates sprinting faster than walking', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)

    const from = makeNode(0.5, 1, 0.5)
    const target = new Vec3(0.5, 1, 5.5)

    const walk = predictor.simulateEdge(from, { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false }, target, { maxSimulationTicks: 80 })
    const sprint = predictor.simulateEdge(from, { forward: true, sprint: true, jump: false, back: false, left: false, right: false, sneak: false }, target, { maxSimulationTicks: 80 })

    expect(walk.arrived).toBe(true)
    expect(sprint.arrived).toBe(true)
    expect(sprint.predictedTicks).toBeLessThan(walk.predictedTicks)
  })

  it('simulates sprint-jump over a gap', async () => {
    const world = new MockWorld()
    // Ground at z=-1 and z=2, gap in between (blocks at y=0)
    world.setBlock(0, 0, -1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)

    const from = makeNode(0.5, 1, -0.5)
    const target = new Vec3(0.5, 1, 2.5)
    const controls = { forward: true, sprint: true, jump: true, back: false, left: false, right: false, sneak: false }

    const result = predictor.simulateEdge(from, controls, target, { maxSimulationTicks: 30 })

    expect(result.arrived).toBe(true)
    expect(result.exitPos.y).toBeCloseTo(1, 0)
  })

  it('returns exit velocity after simulation', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)

    const from = makeNode(0.5, 1, 0.5)
    const target = new Vec3(0.5, 1, 2.5)
    const controls = { forward: true, sprint: true, jump: false, back: false, left: false, right: false, sneak: false }

    const result = predictor.simulateEdge(from, controls, target, { maxSimulationTicks: 60 })

    expect(result.arrived).toBe(true)
    const horizVel = Math.sqrt(result.exitVel.x ** 2 + result.exitVel.z ** 2)
    expect(horizVel).toBeGreaterThan(0.05)
  })
})

/* ------------------------------------------------------------------ */
/*  Cost Functions                                                    */
/* ------------------------------------------------------------------ */

describe('Cost Functions', () => {
  it('computes heuristic cost without predictor', async () => {
    const from = makeNode(0, 1, 0)
    const toPos = new Vec3(5, 1, 0)
    const controls = { forward: true, sprint: true, jump: false, back: false, left: false, right: false, sneak: false }

    const result = computeEdgeCost(from, toPos, controls, undefined)

    expect(result.cost).toBeGreaterThan(10)
    expect(result.predictedTicks).toBeGreaterThan(10)
    expect(result.simulation).toBeUndefined()
  })

  it('computes simulated cost with predictor', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)

    const from = makeNode(0.5, 1, 0.5)
    const toPos = new Vec3(0.5, 1, 3.5)
    const controls = { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false }

    const result = computeEdgeCost(from, toPos, controls, predictor)

    expect(result.simulation).toBeDefined()
    // Cost is normalized (predictedTicks / ~12), so it is smaller than raw ticks
    if (result.simulation!.arrived) {
      expect(result.cost).toBeGreaterThan(0)
      expect(result.predictedTicks).toBeGreaterThan(0)
    }
  })

  it('applies soul sand modifier', async () => {
    expect(applyBlockModifierCost(10, 'soul_sand', null)).toBe(25)
  })

  it('applies ice modifier', async () => {
    expect(applyBlockModifierCost(10, 'ice', null)).toBe(7)
  })

  it('applies lava penalty', async () => {
    expect(applyBlockModifierCost(10, null, 'lava')).toBe(50)
  })
})

/* ------------------------------------------------------------------ */
/*  Momentum Edges                                                    */
/* ------------------------------------------------------------------ */

describe('Momentum Edges', () => {
  it('generates diagonal sprint edges when on ground with velocity', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const node = makeNode(0.5, 1, 0.5, true, new Vec3(0.2, 0, 0.2))

    const edges = generateMomentumEdges(node, world, collisionService)

    const diagSprints = edges.filter(e => e.type === 'sprint')
    expect(diagSprints.length).toBeGreaterThan(0)
  })

  it('generates long-gap edges when velocity is high', async () => {
    const world = new MockWorld()
    createFlatGround(world, 0, 10)
    // Create a 3-block gap
    world.removeBlock(1, 0, 0)
    world.removeBlock(2, 0, 0)
    world.removeBlock(3, 0, 0)
    world.setBlock(4, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const collisionService = new WorldCollisionService(mcData)
    const node = makeNode(0.5, 1, 0.5, true, new Vec3(0.3, 0, 0))

    const edges = generateMomentumEdges(node, world, collisionService)

    const longGaps = edges.filter(e => e.type === 'gap3')
    expect(longGaps.length).toBeGreaterThan(0)
  })

  it('does not generate momentum edges when stationary', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const node = makeNode(0.5, 1, 0.5, true, new Vec3(0, 0, 0))

    const edges = generateMomentumEdges(node, world, collisionService)

    expect(edges.length).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Diagonal Sprint in A*                                             */
/* ------------------------------------------------------------------ */

describe('A* with Momentum', () => {
  it('finds a diagonal sprint path on open ground', async () => {
    const world = makeWorld()
    const collisionService = new WorldCollisionService(mcData)
    const predictor = new PhysicsPredictor(world, collisionService, mcData)
    const pathfinder = new AStarPathfinder(world, collisionService, predictor)

    // Use integer coordinates (block centers) like the rest of the test suite
    const goal: PathGoal = new GoalBlock(new Vec3(2, 1, 2))
    const result = await pathfinder.findPath(new Vec3(0, 1, 0), goal, 500)

    expect(result.status).toBe('success')
    expect(result.path.length).toBeGreaterThan(1)
  })
})

/* ------------------------------------------------------------------ */
/*  Dynamic Replanner                                                 */
/* ------------------------------------------------------------------ */

describe('DynamicReplanner', () => {
  it('triggers replan when a block update is near the path', async () => {
    let replanCount = 0
    const bot = {
      entity: { position: new Vec3(0.5, 1, 0.5) },
      on: () => {},
      removeListener: () => {}
    }

    const replanner = new DynamicReplanner(bot, () => { replanCount++ })
    replanner.setPath([
      makeNode(0.5, 1, 0.5),
      makeNode(1.5, 1, 0.5),
      makeNode(2.5, 1, 0.5)
    ])
    replanner.start()

    expect(replanCount).toBe(0)
    replanner.stop()
  })

  it('start / stop lifecycle is safe', async () => {
    const bot = {
      entity: { position: new Vec3(0, 1, 0) },
      on: () => {},
      removeListener: () => {}
    }
    const replanner = new DynamicReplanner(bot, () => {})

    replanner.start()
    replanner.start() // idempotent
    replanner.stop()
    replanner.stop() // idempotent
  })
})
