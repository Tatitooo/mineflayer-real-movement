import { describe, it, expect, beforeEach } from 'bun:test'
import { Vec3 } from 'vec3'
import { MockWorld, createFlatGround } from './physics-mocks'
import type { MovementNode } from '../src/core/types'
import {
  isScaffoldBlock,
  canPlaceBlock,
  canSpeedBridge,
  canNinjaBridge,
  generateScaffoldEdges,
  computeScaffoldControls,
  estimateScaffoldTicks,
  ScaffoldExecutor,
  DEFAULT_SCAFFOLD_OPTIONS,
  type ScaffoldOptions
} from '../src/movement/scaffold-extension'

describe('Scaffold Extension', () => {
  let world: MockWorld

  beforeEach(() => {
    world = new MockWorld()
    createFlatGround(world, 0, 5)
  })

  describe('isScaffoldBlock', () => {
    it('accepts common scaffold materials', () => {
      expect(isScaffoldBlock('stone')).toBe(true)
      expect(isScaffoldBlock('cobblestone')).toBe(true)
      expect(isScaffoldBlock('dirt')).toBe(true)
      expect(isScaffoldBlock('oak_planks')).toBe(true)
      expect(isScaffoldBlock('deepslate')).toBe(true)
    })

    it('rejects non-scaffold blocks', () => {
      expect(isScaffoldBlock('diamond_block')).toBe(false)
      expect(isScaffoldBlock('glass')).toBe(false)
      expect(isScaffoldBlock('tnt')).toBe(false)
      expect(isScaffoldBlock('')).toBe(false)
    })
  })

  describe('canPlaceBlock', () => {
    it('allows placement when target is empty and adjacent is solid', () => {
      // Clear area to ensure (2,0,0) is empty and (1,0,0) is the only solid adjacent
      world.clear()
      world.setBlock(1, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      // (2,0,0) is empty
      const result = canPlaceBlock(world, new Vec3(2, 0, 0), new Vec3(0.5, 1, 0.5))
      expect(result.valid).toBe(true)
      expect(result.placeAgainst).not.toBeNull()
    })

    it('rejects placement when target is solid', () => {
      world.setBlock(1, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const result = canPlaceBlock(world, new Vec3(1, 0, 0), new Vec3(0.5, 1, 0.5))
      expect(result.valid).toBe(false)
      expect(result.placeAgainst).toBeNull()
    })

    it('rejects placement when no adjacent solid block', () => {
      // All around (5,5,5) is empty
      const result = canPlaceBlock(world, new Vec3(5, 5, 5), new Vec3(0.5, 1, 0.5))
      expect(result.valid).toBe(false)
      expect(result.placeAgainst).toBeNull()
    })

    it('rejects placement when player intersects target', () => {
      world.setBlock(0, -1, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      // Player at (0.5,1,0.5) intersects (0,0,0)
      const result = canPlaceBlock(world, new Vec3(0, 0, 0), new Vec3(0.5, 1, 0.5))
      expect(result.valid).toBe(false)
    })
  })

  describe('canSpeedBridge', () => {
    it('allows 1-block gap bridge', () => {
      // Ground at x=0 and x=2, gap at x=1 must be empty
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(2, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const result = canSpeedBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 1)
      expect(result.valid).toBe(true)
      expect(result.placePositions.length).toBe(1)
      expect(result.landingPos).not.toBeNull()
    })

    it('allows 2-block gap bridge', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(3, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const result = canSpeedBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 2)
      expect(result.valid).toBe(true)
      expect(result.placePositions.length).toBe(2)
    })

    it('rejects bridge when destination is missing and no continuation possible', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      // No destination at x=2 or beyond
      const result = canSpeedBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 1)
      expect(result.valid).toBe(false)
    })

    it('respects maxBridgeGap option', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(5, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const opts: Partial<ScaffoldOptions> = { maxBridgeGap: 2 }
      const result = canSpeedBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 4, opts)
      expect(result.valid).toBe(false) // 4 > maxBridgeGap 2
    })

    it('rejects when allowPlacement is false', () => {
      const opts: Partial<ScaffoldOptions> = { allowPlacement: false }
      const result = canSpeedBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 1, opts)
      expect(result.valid).toBe(false)
    })
  })

  describe('canNinjaBridge', () => {
    it('allows longer gaps with ninja bridging', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(4, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const result = canNinjaBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 3)
      expect(result.valid).toBe(true)
      expect(result.placePositions.length).toBeGreaterThan(0)
    })

    it('rejects when allowNinja is false', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(3, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const opts: Partial<ScaffoldOptions> = { allowNinja: false }
      const result = canNinjaBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 2, opts)
      expect(result.valid).toBe(false)
    })

    it('rejects when headroom is blocked', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(3, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(2, 2, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }) // blocks headroom
      const result = canNinjaBridge(world, new Vec3(0.5, 1, 0.5), { dx: 1, dz: 0 }, 2)
      expect(result.valid).toBe(false)
    })
  })

  describe('generateScaffoldEdges', () => {
    it('generates speed bridge edges for gaps', () => {
      // Need a 1-block gap (node distance = 2) — but executor detects scaffold at >= 3.
      // Edge generator still generates scaffold for any gap. Use gap that gives horizDist >= 3.
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(3, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const node: MovementNode = {
        pos: new Vec3(0.5, 1, 0.5),
        vel: new Vec3(0, 0, 0),
        onGround: true,
        sprinting: false
      }
      const edges = generateScaffoldEdges(node, world)
      expect(edges.length).toBeGreaterThan(0)
      const scaffoldEdge = edges.find(e => e.type === 'scaffold')
      expect(scaffoldEdge).toBeDefined()
      expect(scaffoldEdge!.controlInputs.back).toBe(true)
      expect(scaffoldEdge!.controlInputs.sneak).toBe(true)
      expect(scaffoldEdge!.controlInputs.forward).toBe(false)
    })

    it('generates ninja bridge edges for longer gaps', () => {
      world.clear()
      world.setBlock(0, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      world.setBlock(4, 0, 0, { name: 'stone', stateId: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
      const node: MovementNode = {
        pos: new Vec3(0.5, 1, 0.5),
        vel: new Vec3(0, 0, 0),
        onGround: true,
        sprinting: false
      }
      const edges = generateScaffoldEdges(node, world)
      const ninjaEdge = edges.find(e => e.type === 'scaffoldNinja')
      expect(ninjaEdge).toBeDefined()
      expect(ninjaEdge!.controlInputs.sprint).toBe(true)
      expect(ninjaEdge!.controlInputs.jump).toBe(true)
    })

    it('returns empty when not on ground', () => {
      const node: MovementNode = {
        pos: new Vec3(0.5, 5, 0.5),
        vel: new Vec3(0, 0, 0),
        onGround: false,
        sprinting: false
      }
      const edges = generateScaffoldEdges(node, world)
      expect(edges.length).toBe(0)
    })

    it('returns empty when allowPlacement is false', () => {
      const node: MovementNode = {
        pos: new Vec3(0.5, 1, 0.5),
        vel: new Vec3(0, 0, 0),
        onGround: true,
        sprinting: false
      }
      const edges = generateScaffoldEdges(node, world, { allowPlacement: false })
      expect(edges.length).toBe(0)
    })
  })

  describe('computeScaffoldControls', () => {
    it('approach phase walks backward and sneaks', () => {
      const phase = { tick: 0, phase: 'approach' as const, placePositions: [new Vec3(1, 0, 0)], currentPlaceIndex: 0, isNinja: false }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(2.5, 1, 0.5))
      expect(result.back).toBe(true)
      expect(result.sneak).toBe(true)
      expect(result.forward).toBe(false)
      expect(result.done).toBe(false)
    })

    it('place phase places blocks', () => {
      const phase = { tick: 3, phase: 'place' as const, placePositions: [new Vec3(1, 0, 0)], currentPlaceIndex: 0, isNinja: false }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(2.5, 1, 0.5))
      expect(result.back).toBe(true)
      expect(result.sneak).toBe(true)
      expect(result.done).toBe(false)
      expect(phase.currentPlaceIndex).toBe(1) // block placed
    })

    it('ninja place phase sprints and jumps', () => {
      const phase = { tick: 3, phase: 'place' as const, placePositions: [new Vec3(1, 0, 0), new Vec3(2, 0, 0)], currentPlaceIndex: 0, isNinja: true }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(3.5, 1, 0.5))
      expect(result.back).toBe(true)
      expect(result.sprint).toBe(true)
      expect(result.sneak).toBe(false)
    })

    it('settle phase pauses briefly', () => {
      const phase = { tick: 0, phase: 'settle' as const, placePositions: [], currentPlaceIndex: 0, isNinja: false }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(2.5, 1, 0.5))
      expect(result.done).toBe(false)
      expect(result.sneak).toBe(true)
    })

    it('settle phase completes after ticks', () => {
      const phase = { tick: 3, phase: 'settle' as const, placePositions: [], currentPlaceIndex: 0, isNinja: false }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(2.5, 1, 0.5))
      expect(result.done).toBe(true)
      expect(result.phase).toBe('done')
    })

    it('done phase returns done immediately', () => {
      const phase = { tick: 0, phase: 'done' as const, placePositions: [], currentPlaceIndex: 0, isNinja: false }
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = computeScaffoldControls(phase, current, new Vec3(2.5, 1, 0.5))
      expect(result.done).toBe(true)
    })
  })

  describe('estimateScaffoldTicks', () => {
    it('estimates speed bridge ticks', () => {
      expect(estimateScaffoldTicks(1, false, 2)).toBe(3 + 4 + 2) // 3 base + 1*4 + 2 settle
      expect(estimateScaffoldTicks(2, false, 2)).toBe(3 + 8 + 2)
    })

    it('estimates ninja bridge ticks', () => {
      expect(estimateScaffoldTicks(2, true)).toBe(2 + 4) // 2 base + 2*2
      expect(estimateScaffoldTicks(3, true)).toBe(2 + 6)
    })
  })

  describe('ScaffoldExecutor', () => {
    it('executes a full speed bridge cycle', () => {
      const executor = new ScaffoldExecutor()
      executor.start([new Vec3(1, 0, 0)], false)
      expect(executor.isActive()).toBe(true)

      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const target = new Vec3(2.5, 1, 0.5)

      // Tick 0-1: approach
      let result = executor.tick(current, target)
      expect(result.back).toBe(true)
      expect(result.done).toBe(false)

      result = executor.tick(current, target)
      expect(result.done).toBe(false)

      // Tick 2: approach -> place
      result = executor.tick(current, target)
      expect(result.back).toBe(true)
      expect(result.done).toBe(false)

      // Tick 3: place -> settle
      result = executor.tick(current, target)
      expect(result.done).toBe(false)

      // Tick 4: settle -> done
      result = executor.tick(current, target)
      expect(result.done).toBe(true)
      expect(executor.isActive()).toBe(false)
    })

    it('executes a ninja bridge cycle', () => {
      const executor = new ScaffoldExecutor()
      executor.start([new Vec3(1, 0, 0), new Vec3(2, 0, 0)], true)

      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const target = new Vec3(3.5, 1, 0.5)

      let done = false
      let ticks = 0
      const maxTicks = 20
      while (!done && ticks < maxTicks) {
        const result = executor.tick(current, target)
        done = result.done
        ticks++
      }
      expect(done).toBe(true)
      expect(ticks).toBeLessThan(maxTicks)
    })

    it('returns done when inactive', () => {
      const executor = new ScaffoldExecutor()
      const current: MovementNode = { pos: new Vec3(0.5, 1, 0.5), vel: new Vec3(0, 0, 0), onGround: true, sprinting: false }
      const result = executor.tick(current, new Vec3(2.5, 1, 0.5))
      expect(result.done).toBe(true)
      expect(executor.isActive()).toBe(false)
    })

    it('resets to inactive', () => {
      const executor = new ScaffoldExecutor()
      executor.start([new Vec3(1, 0, 0)], false)
      expect(executor.isActive()).toBe(true)
      executor.reset()
      expect(executor.isActive()).toBe(false)
    })
  })
})
