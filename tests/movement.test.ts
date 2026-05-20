import { describe, it, expect, beforeEach } from 'bun:test'
import { Vec3 } from 'vec3'
import { MockWorld, createFlatGround } from './physics-mocks'
import {
  classifySpecialBlock,
  getModifier,
  getGroundModifier,
  getBodyModifier,
  isOnIce,
  isInCobweb,
  isOnSoulSand
} from '../src/movement/special-blocks'

import {
  isSubmerged,
  is1BlockTunnel,
  getBubbleColumnDirection,
  computeSwimControls,
  estimateSwimTicks,
  canSwimTo
} from '../src/movement/swim-navigator'

import {
  analyzeKnockback,
  computeRecoveryControls,
  KnockbackRecoveryTracker
} from '../src/movement/knockback-recovery'

describe('Special Blocks', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  it('classifies known special blocks', () => {
    expect(classifySpecialBlock('soul_sand')).toBe('soul_sand')
    expect(classifySpecialBlock('honey_block')).toBe('honey_block')
    expect(classifySpecialBlock('slime_block')).toBe('slime_block')
    expect(classifySpecialBlock('cobweb')).toBe('cobweb')
    expect(classifySpecialBlock('ice')).toBe('ice')
    expect(classifySpecialBlock('packed_ice')).toBe('packed_ice')
    expect(classifySpecialBlock('blue_ice')).toBe('blue_ice')
    expect(classifySpecialBlock('water')).toBe('water')
    expect(classifySpecialBlock('stone')).toBe('none')
  })

  it('returns correct modifiers', () => {
    const soul = getModifier('soul_sand')
    expect(soul.speedMultiplier).toBe(0.4)
    expect(soul.canSprint).toBe(false)

    const honey = getModifier('honey_block')
    expect(honey.jumpMultiplier).toBe(0.2)

    const cobweb = getModifier('cobweb')
    expect(cobweb.speedMultiplier).toBe(0.05)
    expect(cobweb.canJump).toBe(false)

    const ice = getModifier('ice')
    expect(ice.frictionMultiplier).toBe(0.02)
    expect(ice.canSprint).toBe(true)
  })

  it('detects ground block modifier', () => {
    world.setBlock(0, 0, 0, { name: 'soul_sand', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    const mod = getGroundModifier(world, new Vec3(0.5, 1, 0.5))
    expect(mod.speedMultiplier).toBe(0.4)
    expect(mod.canSprint).toBe(false)
  })

  it('isOnIce detects ice variants', () => {
    world.setBlock(0, 0, 0, { name: 'ice', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(isOnIce(world, new Vec3(0.5, 1, 0.5))).toBe(true)

    world.setBlock(0, 0, 0, { name: 'packed_ice', stateId: 2, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(isOnIce(world, new Vec3(0.5, 1, 0.5))).toBe(true)

    world.setBlock(0, 0, 0, { name: 'stone', stateId: 3, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(isOnIce(world, new Vec3(0.5, 1, 0.5))).toBe(false)
  })

  it('isInCobweb detects cobweb', () => {
    world.setBlock(0, 0, 0, { name: 'cobweb', stateId: 1, boundingBox: 'empty', shapes: [] })
    expect(isInCobweb(world, new Vec3(0.5, 1, 0.5))).toBe(true)
  })

  it('isOnSoulSand detects soul sand', () => {
    world.setBlock(0, 0, 0, { name: 'soul_sand', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(isOnSoulSand(world, new Vec3(0.5, 1, 0.5))).toBe(true)
  })

  it('getBodyModifier picks most restrictive block in body', () => {
    // Create a column: cobweb at y=1, water at y=2, stone ground at y=0
    world.setBlock(0, 1, 0, { name: 'cobweb', stateId: 1, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 2, 0, { name: 'water', stateId: 2, boundingBox: 'empty', shapes: [] })
    const mod = getBodyModifier(world, new Vec3(0.5, 1.5, 0.5))
    // cobweb is more restrictive than water (0.05 < 0.3)
    expect(mod.speedMultiplier).toBe(0.05)
  })
})

describe('Swim Navigator', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
  })

  it('detects submerged in water', () => {
    world.setBlock(0, 0, 0, { name: 'water', stateId: 1, boundingBox: 'empty', shapes: [] })
    expect(isSubmerged(world, new Vec3(0.5, 0.5, 0.5), 'water')).toBe(true)
  })

  it('does not detect submerged when above water', () => {
    world.setBlock(0, -1, 0, { name: 'water', stateId: 1, boundingBox: 'empty', shapes: [] })
    expect(isSubmerged(world, new Vec3(0.5, 1.5, 0.5), 'water')).toBe(false)
  })

  it('detects 1-block tunnel', () => {
    // Floor at y=-1, ceiling at y=2, water at y=0,1
    world.setBlock(0, -1, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 2, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 0, { name: 'water', stateId: 2, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, 1, 0, { name: 'water', stateId: 2, boundingBox: 'empty', shapes: [] })
    expect(is1BlockTunnel(world, new Vec3(0.5, 0.5, 0.5))).toBe(true)
  })

  it('does not detect tunnel when ceiling is missing', () => {
    world.setBlock(0, -1, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    world.setBlock(0, 0, 0, { name: 'water', stateId: 2, boundingBox: 'empty', shapes: [] })
    expect(is1BlockTunnel(world, new Vec3(0.5, 0.5, 0.5))).toBe(false)
  })

  it('detects bubble column direction', () => {
    world.setBlock(0, 0, 0, { name: 'bubble_column', stateId: 1, boundingBox: 'empty', shapes: [] })
    world.setBlock(0, -1, 0, { name: 'soul_sand', stateId: 2, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(getBubbleColumnDirection(world, new Vec3(0.5, 1, 0.5))).toBe('up')

    world.setBlock(0, -1, 0, { name: 'magma_block', stateId: 3, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
    expect(getBubbleColumnDirection(world, new Vec3(0.5, 1, 0.5))).toBe('down')
  })

  it('computes swim controls forward', () => {
    const current = { pos: new Vec3(0, 0, 0), vel: new Vec3(0, 0, 0), onGround: false, sprinting: false }
    const target = new Vec3(5, 0, 0)
    const controls = computeSwimControls(current, target, true, false)
    expect(controls.forward).toBe(true)
    expect(controls.sprint).toBe(true)
    expect(controls.jump).toBe(false)
  })

  it('computes swim controls up and forward', () => {
    const current = { pos: new Vec3(0, 0, 0), vel: new Vec3(0, 0, 0), onGround: false, sprinting: false }
    const target = new Vec3(3, 2, 0)
    const controls = computeSwimControls(current, target, true, false)
    expect(controls.forward).toBe(true)
    expect(controls.jump).toBe(true)
    expect(controls.sneak).toBe(false)
  })

  it('computes swim controls down and forward', () => {
    const current = { pos: new Vec3(0, 5, 0), vel: new Vec3(0, 0, 0), onGround: false, sprinting: false }
    const target = new Vec3(3, 2, 0)
    const controls = computeSwimControls(current, target, true, false)
    expect(controls.forward).toBe(true)
    expect(controls.sneak).toBe(true)
    expect(controls.jump).toBe(false)
  })

  it('disables jump in 1-block tunnel', () => {
    const current = { pos: new Vec3(0, 0, 0), vel: new Vec3(0, 0, 0), onGround: false, sprinting: false }
    const target = new Vec3(3, 2, 0)
    const controls = computeSwimControls(current, target, true, true)
    expect(controls.jump).toBe(false)
  })

  it('estimates swim ticks with depth strider', () => {
    const from = new Vec3(0, 0, 0)
    const to = new Vec3(10, 0, 0)
    const noStrider = estimateSwimTicks(from, to, 0)
    const strider3 = estimateSwimTicks(from, to, 3)
    expect(strider3).toBeLessThan(noStrider)
  })

  it('canSwimTo validates water path', () => {
    world.setBlock(0, 0, 0, { name: 'water', stateId: 1, boundingBox: 'empty', shapes: [] })
    world.setBlock(1, 0, 0, { name: 'water', stateId: 1, boundingBox: 'empty', shapes: [] })
    const result = canSwimTo(world, new Vec3(0.5, 0.5, 0.5), new Vec3(1.5, 0.5, 0.5))
    expect(result.valid).toBe(true)
  })

  it('canSwimTo rejects dry path', () => {
    const result = canSwimTo(world, new Vec3(0.5, 0.5, 0.5), new Vec3(1.5, 0.5, 0.5))
    expect(result.valid).toBe(false)
  })
})

describe('Knockback Recovery', () => {
  it('detects knockback from velocity spike', () => {
    const prev = new Vec3(0.1, 0, 0.1)
    const curr = new Vec3(2.5, 0.4, -1.2)
    const analysis = analyzeKnockback(curr, prev, true)
    expect(analysis).not.toBeNull()
    expect(analysis!.impulse.x).toBeCloseTo(2.4, 1)
    expect(analysis!.recoveryTicks).toBeGreaterThan(0)
  })

  it('ignores small velocity changes', () => {
    const prev = new Vec3(0.1, 0, 0.1)
    const curr = new Vec3(0.15, 0, 0.12)
    const analysis = analyzeKnockback(curr, prev, true)
    expect(analysis).toBeNull()
  })

  it('computes counter-strafe on ground', () => {
    const prev = new Vec3(0, 0, 0)
    const curr = new Vec3(1.0, 0, 0)
    const analysis = analyzeKnockback(curr, prev, true)!
    const controls = computeRecoveryControls(analysis, curr, 0)
    // Counter-strafe should hold back (opposite of +X impulse)
    expect(controls.back || controls.left || controls.right || controls.forward).toBe(true)
    expect(controls.recovered).toBe(false)
  })

  it('reports recovered when velocity is low', () => {
    const prev = new Vec3(0, 0, 0)
    const curr = new Vec3(0.5, 0, 0)
    const analysis = analyzeKnockback(curr, prev, true)!
    const lowVel = new Vec3(0.02, 0, 0.02)
    const controls = computeRecoveryControls(analysis, lowVel, 0)
    expect(controls.recovered).toBe(true)
  })

  it('does not apply WASD when airborne', () => {
    const prev = new Vec3(0, 0, 0)
    const curr = new Vec3(1.0, 0.5, 0)
    const analysis = analyzeKnockback(curr, prev, false)!
    const controls = computeRecoveryControls(analysis, curr, 0)
    expect(controls.forward).toBe(false)
    expect(controls.back).toBe(false)
    expect(controls.left).toBe(false)
    expect(controls.right).toBe(false)
  })

  it('KnockbackRecoveryTracker state machine', () => {
    let tickVel = new Vec3(0, 0, 0)
    const mockBot = {
      entity: {
        position: new Vec3(0, 64, 0),
        yaw: 0,
        velocity: tickVel,
        onGround: true
      },
      controlState: {
        forward: false, back: false, left: false, right: false,
        jump: false, sprint: false, sneak: false
      },
      lookAt: async () => {},
      clearControlStates: () => {},
      on: () => {},
      removeListener: () => {}
    }

    const tracker = new KnockbackRecoveryTracker(mockBot as any)

    // No knockback
    let state = tracker.tick()
    expect(state.recovering).toBe(false)

    // Simulate knockback spike
    tickVel = new Vec3(2.0, 0.3, 0)
    mockBot.entity.velocity = tickVel
    state = tracker.tick()
    expect(state.recovering).toBe(true)
    expect(state.recovered).toBe(false)

    // Simulate friction slowing down
    tickVel = new Vec3(0.5, 0, 0)
    mockBot.entity.velocity = tickVel
    state = tracker.tick()
    // Still recovering but not recovered yet

    tickVel = new Vec3(0.01, 0, 0)
    mockBot.entity.velocity = tickVel
    state = tracker.tick()
    expect(state.recovered).toBe(true)
    expect(state.recovering).toBe(false)
  })
})
