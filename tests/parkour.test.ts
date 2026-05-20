import { describe, it, expect, beforeEach } from 'bun:test'
import { Vec3 } from 'vec3'
import type { MovementNode } from '../src/core/types'
import { MockWorld, createFlatGround } from './physics-mocks'
import {
  isClimbable,
  isFenceOrWall,
  canSprintJumpGap,
  canLadderJump,
  canFenceVault,
  generateParkourEdges,
  computeParkourControls,
  estimateParkourTicks,
  ParkourExecutor,
  PARKOUR_MOVES,
  type ParkourPhase
} from '../src/movement/parkour-executor'

describe('Parkour Basics', () => {
  it('classifies climbable blocks', () => {
    expect(isClimbable('ladder')).toBe(true)
    expect(isClimbable('vine')).toBe(true)
    expect(isClimbable('weeping_vines')).toBe(true)
    expect(isClimbable('twisting_vines')).toBe(true)
    expect(isClimbable('stone')).toBe(false)
  })

  it('classifies fence and wall blocks', () => {
    expect(isFenceOrWall('oak_fence')).toBe(true)
    expect(isFenceOrWall('nether_brick_fence')).toBe(true)
    expect(isFenceOrWall('cobblestone_wall')).toBe(true)
    expect(isFenceOrWall('stone')).toBe(false)
  })

  it('has defined parkour moves', () => {
    expect(PARKOUR_MOVES.gap1.gap).toBe(1)
    expect(PARKOUR_MOVES.gap2.gap).toBe(2)
    expect(PARKOUR_MOVES.gap3.gap).toBe(3)
    expect(PARKOUR_MOVES.gap2Up1.deltaY).toBe(1)
    expect(PARKOUR_MOVES.ladderUp.type).toBe('ladderUp')
    expect(PARKOUR_MOVES.fenceVault.type).toBe('fenceVault')
  })
})

describe('Sprint-Jump Gap Validation', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  it('validates a 1-block gap', () => {
    // Ground: 0,0,0 and 0,0,2 with air at 0,0,1
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    // Headroom
    world.setBlock(0, 1, 2, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 2, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })

    const result = canSprintJumpGap(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 1, 0)
    expect(result.valid).toBe(true)
    expect(result.landingPos).not.toBeNull()
    expect(result.move).not.toBeNull()
  })

  it('validates a 2-block gap', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 2, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 3, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 1, 3, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 3, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })

    const result = canSprintJumpGap(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 2, 0)
    expect(result.valid).toBe(true)
    expect(result.move!.type).toBe('gap2')
    expect(result.move!.requiresSprint).toBe(true)
    expect(result.move!.requiresJump).toBe(true)
  })

  it('rejects a 3-block gap without proper landing', () => {
    // Use a world without automatic ground fill to control exactly
    const smallWorld = new MockWorld()
    smallWorld.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    smallWorld.setBlock(0, 0, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    smallWorld.setBlock(0, 0, 2, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    smallWorld.setBlock(0, 0, 3, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    // No landing block at z=4

    const result = canSprintJumpGap(smallWorld, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 3, 0)
    expect(result.valid).toBe(false)
  })

  it('rejects gap when intermediate block is solid', () => {
    const smallWorld = new MockWorld()
    smallWorld.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    smallWorld.setBlock(0, 0, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    smallWorld.setBlock(0, 0, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canSprintJumpGap(smallWorld, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 1, 0)
    expect(result.valid).toBe(false)
  })
})

describe('Ladder Jump Validation', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  it('validates ladder jump up', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    // Player is at y=1.0, deltaY=1 means ladder at y=2
    world.setBlock(0, 2, 1, { name: 'ladder', stateId: 100, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 1, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canLadderJump(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 1)
    expect(result.valid).toBe(true)
    expect(result.ladderPos).not.toBeNull()
    expect(result.move!.type).toBe('ladderUp')
  })

  it('rejects ladder without support below', () => {
    world.setBlock(0, 1, 1, { name: 'ladder', stateId: 100, boundingBox: 'empty', shapes: [] })
    // No block below ladder

    const result = canLadderJump(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 1)
    expect(result.valid).toBe(false)
  })

  it('rejects non-ladder block', () => {
    world.setBlock(0, 1, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canLadderJump(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 }, 1)
    expect(result.valid).toBe(false)
  })
})

describe('Fence Vault Validation', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  it('validates fence vault with landing ground', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'oak_fence', stateId: 200, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1.5, 1]] })
    world.setBlock(0, 1, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canFenceVault(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 })
    expect(result.valid).toBe(true)
    expect(result.landingPos).not.toBeNull()
    expect(result.move!.type).toBe('fenceVault')
  })

  it('rejects fence vault when top is blocked', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'oak_fence', stateId: 200, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1.5, 1]] })
    world.setBlock(0, 1, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canFenceVault(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 })
    expect(result.valid).toBe(false)
  })

  it('rejects non-fence block', () => {
    world.setBlock(0, 0, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const result = canFenceVault(world, new Vec3(0.5, 1, 0.5), { dx: 0, dz: 1 })
    expect(result.valid).toBe(false)
  })
})

describe('Parkour Edge Generation', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  it('generates gap2 edges', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 2, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 3, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 1, 3, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 3, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })

    const node: MovementNode = {
      pos: new Vec3(0.5, 1, 0.5),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }

    const edges = generateParkourEdges(node, world)
    const gap2Edges = edges.filter(e => e.type === 'gap2')
    expect(gap2Edges.length).toBeGreaterThan(0)
    expect(gap2Edges[0].controlInputs.sprint).toBe(true)
    expect(gap2Edges[0].controlInputs.jump).toBe(true)
  })

  it('generates ladder jump edges', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    // Ladder at y=2 for deltaY=1 (player at y=1.0)
    world.setBlock(0, 2, 1, { name: 'ladder', stateId: 100, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 1, 1, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const node: MovementNode = {
      pos: new Vec3(0.5, 1, 0.5),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }

    const edges = generateParkourEdges(node, world)
    const ladderEdges = edges.filter(e => e.type === 'ladderUp')
    expect(ladderEdges.length).toBeGreaterThan(0)
    expect(ladderEdges[0].controlInputs.jump).toBe(true)
  })

  it('generates fence vault edges', () => {
    world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 1, { name: 'oak_fence', stateId: 200, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1.5, 1]] })
    world.setBlock(0, 1, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 1, { name: 'air', stateId: 0, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 0, 2, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })

    const node: MovementNode = {
      pos: new Vec3(0.5, 1, 0.5),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }

    const edges = generateParkourEdges(node, world)
    const vaultEdges = edges.filter(e => e.type === 'fenceVault')
    expect(vaultEdges.length).toBeGreaterThan(0)
    expect(vaultEdges[0].controlInputs.sprint).toBe(true)
    expect(vaultEdges[0].controlInputs.jump).toBe(true)
  })

  it('does not generate edges when not on ground', () => {
    const node: MovementNode = {
      pos: new Vec3(0.5, 2, 0.5),
      vel: new Vec3(0, 0, 0),
      onGround: false,
      sprinting: false
    }

    const edges = generateParkourEdges(node, world)
    expect(edges.length).toBe(0)
  })
})

describe('Parkour Control Computation', () => {
  it('approach phase holds sprint and forward but not jump', () => {
    const phase: ParkourPhase = { tick: 0, phase: 'approach', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.jump).toBe(false)
    // On tick 0, we stay in approach; transition to takeoff happens at tick >= 2
    expect(result.phase).toBe('approach')
  })

  it('approach transitions to takeoff after 2 ticks', () => {
    const phase: ParkourPhase = { tick: 2, phase: 'approach', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.phase).toBe('takeoff')
  })

  it('takeoff phase presses jump', () => {
    const phase: ParkourPhase = { tick: 0, phase: 'takeoff', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.jump).toBe(true)
    expect(result.phase).toBe('airborne')
  })

  it('airborne phase holds forward while in air', () => {
    const phase: ParkourPhase = { tick: 0, phase: 'airborne', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1.5, 1),
      vel: new Vec3(0, 0.3, 0),
      onGround: false,
      sprinting: true
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.jump).toBe(false)
    expect(result.phase).toBe('airborne')
  })

  it('airborne transitions to landing when on ground', () => {
    const phase: ParkourPhase = { tick: 0, phase: 'airborne', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1, 2.9),
      vel: new Vec3(0, -0.1, 0),
      onGround: true,
      sprinting: true
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.phase).toBe('landing')
    expect(result.done).toBe(true) // landing tick is the completion tick
  })

  it('landing phase marks done', () => {
    const phase: ParkourPhase = { tick: 0, phase: 'landing', move: PARKOUR_MOVES.gap2 }
    const current: MovementNode = {
      pos: new Vec3(0, 1, 3),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = new Vec3(0, 1, 3)

    const result = computeParkourControls(phase, current, target)
    expect(result.forward).toBe(true)
    expect(result.done).toBe(true)
  })
})

describe('ParkourExecutor State Machine', () => {
  it('executes a full gap2 move cycle', () => {
    const executor = new ParkourExecutor()
    executor.start(PARKOUR_MOVES.gap2)

    const current: MovementNode = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = new Vec3(0, 1, 3)

    // Tick 0-2: approach (3 ticks to build sprint speed)
    let result = executor.tick(current, target)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.jump).toBe(false)
    expect(result.done).toBe(false)

    result = executor.tick(current, target)
    expect(result.jump).toBe(false)
    expect(result.done).toBe(false)

    // Tick 3: takeoff
    result = executor.tick(current, target)
    expect(result.jump).toBe(true)
    expect(result.done).toBe(false)

    // Tick 4: airborne (still in air)
    const airborne: MovementNode = { ...current, pos: new Vec3(0, 1.5, 1), onGround: false, sprinting: true }
    result = executor.tick(airborne, target)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.done).toBe(false)

    // Tick 5: landing (on ground)
    const landed: MovementNode = { ...current, pos: new Vec3(0, 1, 2.9), onGround: true, sprinting: true }
    result = executor.tick(landed, target)
    expect(result.forward).toBe(true)
    expect(result.done).toBe(true)

    // After done, subsequent ticks return all-false with done=true
    result = executor.tick(current, target)
    expect(result.forward).toBe(false)
    expect(result.done).toBe(true)
  })

  it('estimates parkour ticks correctly', () => {
    const gap2 = estimateParkourTicks(PARKOUR_MOVES.gap2)
    expect(gap2).toBe(PARKOUR_MOVES.gap2.predictedTicks + 3)

    const gap3 = estimateParkourTicks(PARKOUR_MOVES.gap3)
    expect(gap3).toBe(PARKOUR_MOVES.gap3.predictedTicks + 3)
  })
})
