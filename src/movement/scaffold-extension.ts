import { Vec3 } from 'vec3'
import type { CollisionWorld, MovementNode, MovementEdge, ControlInputs } from '../core/types'
import { getPlayerAABB } from '../core/aabb-utils'

/**
 * Set of blocks commonly used for scaffolding / bridging.
 * In a real bot these would be checked against inventory.
 */
export const SCAFFOLD_BLOCKS = new Set([
  'stone', 'cobblestone', 'dirt', 'netherrack', 'end_stone',
  'andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'bamboo_planks', 'crimson_planks', 'warped_planks',
  ' sandstone', 'red_sandstone', 'concrete', 'terracotta'
])

/**
 * Options that configure scaffold behavior.
 */
export interface ScaffoldOptions {
  /** Whether the bot is allowed to place blocks from its inventory. */
  allowPlacement: boolean
  /** Maximum horizontal gap that can be bridged with scaffold. */
  maxBridgeGap: number
  /** Whether to use ninja bridging (faster, jump-assisted). */
  allowNinja: boolean
  /** Maximum vertical drop allowed for a scaffold bridge. */
  maxVerticalDrop: number
  /** Ticks to wait after placing a block before stepping onto it. */
  placeSettleTicks: number
}

export const DEFAULT_SCAFFOLD_OPTIONS: ScaffoldOptions = {
  allowPlacement: true,
  maxBridgeGap: 4,
  allowNinja: true,
  maxVerticalDrop: 1,
  placeSettleTicks: 2
}

/**
 * Determine if a block name is a valid scaffold material.
 */
export function isScaffoldBlock (blockName: string): boolean {
  return SCAFFOLD_BLOCKS.has(blockName)
}

/**
 * Check whether the player can place a block at `placePos`.
 * Requirements:
 * 1. The target position must be empty (no solid block).
 * 2. There must be an adjacent solid block to place against.
 * 3. The player's AABB must not intersect the placement position.
 *
 * @param additionalSolids - Optional array of positions to treat as solid for adjacency checks.
 *   Used when validating multi-block bridges where earlier gap blocks serve as support.
 */
export function canPlaceBlock (
  world: CollisionWorld,
  placePos: Vec3,
  playerPos: Vec3,
  additionalSolids?: Vec3[]
): { valid: boolean; placeAgainst: Vec3 | null } {
  const px = Math.floor(placePos.x)
  const py = Math.floor(placePos.y)
  const pz = Math.floor(placePos.z)

  // Target must be empty
  const target = world.getBlock(new Vec3(px, py, pz))
  if (target && target.boundingBox !== 'empty') {
    return { valid: false, placeAgainst: null }
  }

  // Helper to check if a position is solid (world block or additional solid)
  const isSolid = (pos: Vec3): boolean => {
    const block = world.getBlock(pos)
    if (block && block.boundingBox !== 'empty') return true
    if (additionalSolids) {
      for (const solid of additionalSolids) {
        if (Math.floor(solid.x) === Math.floor(pos.x) &&
            Math.floor(solid.y) === Math.floor(pos.y) &&
            Math.floor(solid.z) === Math.floor(pos.z)) {
          return true
        }
      }
    }
    return false
  }

  // Find an adjacent solid block to place against
  const adjacents = [
    new Vec3(px + 1, py, pz),
    new Vec3(px - 1, py, pz),
    new Vec3(px, py + 1, pz),
    new Vec3(px, py - 1, pz),
    new Vec3(px, py, pz + 1),
    new Vec3(px, py, pz - 1)
  ]

  for (const adj of adjacents) {
    if (isSolid(adj)) {
      // Ensure player doesn't intersect the placement position
      const playerAABB = getPlayerAABB(playerPos)
      const placeAABB = {
        minX: px, minY: py, minZ: pz,
        maxX: px + 1, maxY: py + 1, maxZ: pz + 1
      }
      // Simple intersection check
      if (
        playerAABB.maxX > placeAABB.minX && playerAABB.minX < placeAABB.maxX &&
        playerAABB.maxY > placeAABB.minY && playerAABB.minY < placeAABB.maxY &&
        playerAABB.maxZ > placeAABB.minZ && playerAABB.minZ < placeAABB.maxZ
      ) {
        continue // player intersects this placement spot, try another adjacent
      }
      return { valid: true, placeAgainst: adj }
    }
  }

  return { valid: false, placeAgainst: null }
}

/**
 * Check if a speed bridge (backward placement while walking) is possible
 * across a horizontal gap.
 *
 * The player stands at `from`, looks backwards, and places a block
 * at the gap position. The block appears under their feet as they step back.
 *
 * @param gapBlocks - number of empty blocks between from and destination ground.
 *                    gapBlocks=1 means a 1-block-wide hole (place at from+1).
 *                    gapBlocks=2 means a 2-block-wide hole, etc.
 */
export function canSpeedBridge (
  world: CollisionWorld,
  from: Vec3,
  direction: { dx: number; dz: number },
  gapBlocks: number,
  options?: Partial<ScaffoldOptions>
): { valid: boolean; landingPos: Vec3 | null; placePositions: Vec3[] } {
  const opts = { ...DEFAULT_SCAFFOLD_OPTIONS, ...options }
  if (!opts.allowPlacement || gapBlocks < 1 || gapBlocks > opts.maxBridgeGap) {
    return { valid: false, landingPos: null, placePositions: [] }
  }

  const groundY = Math.floor(from.y - 0.001)
  const placePositions: Vec3[] = []

  // Validate every intermediate gap block can be placed
  for (let i = 1; i <= gapBlocks; i++) {
    const placeX = Math.floor(from.x + direction.dx * i)
    const placeZ = Math.floor(from.z + direction.dz * i)
    const placePos = new Vec3(placeX, groundY, placeZ)

    // Pass already-validated positions as additional solids for adjacency
    const placeCheck = canPlaceBlock(world, placePos, from, placePositions)
    if (!placeCheck.valid) {
      return { valid: false, landingPos: null, placePositions: [] }
    }
    placePositions.push(placePos)
  }

  // Destination ground must exist after the gap
  const destX = Math.floor(from.x + direction.dx * (gapBlocks + 1))
  const destZ = Math.floor(from.z + direction.dz * (gapBlocks + 1))
  const destGround = world.getBlock(new Vec3(destX, groundY, destZ))
  if (!destGround || destGround.boundingBox === 'empty') {
    // The destination is also air — we could continue bridging, but for a single
    // edge we require solid destination or additional scaffold edges will handle it.
    // Allow if it's within maxBridgeGap (we'll bridge all the way).
    if (gapBlocks < opts.maxBridgeGap) {
      // Continue bridging to find solid ground
      let extra = 0
      let foundSolid = false
      for (let e = 1; e <= opts.maxBridgeGap - gapBlocks; e++) {
        const checkX = Math.floor(from.x + direction.dx * (gapBlocks + e))
        const checkZ = Math.floor(from.z + direction.dz * (gapBlocks + e))
        const checkGround = world.getBlock(new Vec3(checkX, groundY, checkZ))
        if (checkGround && checkGround.boundingBox !== 'empty') {
          extra = e - 1
          foundSolid = true
          break
        }
        // Also need to be able to place this intermediate block
        const extraPlace = canPlaceBlock(world, new Vec3(checkX, groundY, checkZ), from, placePositions)
        if (!extraPlace.valid) {
          return { valid: false, landingPos: null, placePositions: [] }
        }
        placePositions.push(new Vec3(checkX, groundY, checkZ))
      }
      if (!foundSolid) {
        return { valid: false, landingPos: null, placePositions: [] }
      }
      const finalX = Math.floor(from.x + direction.dx * (gapBlocks + extra + 1))
      const finalZ = Math.floor(from.z + direction.dz * (gapBlocks + extra + 1))
      const landingPos = new Vec3(finalX + 0.5, groundY + 1, finalZ + 0.5)
      return { valid: true, landingPos, placePositions }
    }
    return { valid: false, landingPos: null, placePositions: [] }
  }

  const landingPos = new Vec3(destX + 0.5, groundY + 1, destZ + 0.5)
  return { valid: true, landingPos, placePositions }
}

/**
 * Check if a ninja bridge is possible.
 * Ninja bridging is speed bridging but faster: the player sprints backward,
 * places blocks rapidly, and sometimes jumps to maintain momentum.
 *
 * It can bridge slightly longer gaps (up to 4-5 blocks) because sprint
 * backward momentum keeps the player on the newly placed blocks.
 */
export function canNinjaBridge (
  world: CollisionWorld,
  from: Vec3,
  direction: { dx: number; dz: number },
  gapBlocks: number,
  options?: Partial<ScaffoldOptions>
): { valid: boolean; landingPos: Vec3 | null; placePositions: Vec3[] } {
  const opts = { ...DEFAULT_SCAFFOLD_OPTIONS, ...options }
  if (!opts.allowNinja) {
    return { valid: false, landingPos: null, placePositions: [] }
  }

  // Ninja bridging can handle up to maxBridgeGap blocks with sprint momentum
  // but is riskier — only allow on straight gaps with no obstacles.
  if (gapBlocks < 1 || gapBlocks > opts.maxBridgeGap + 1) {
    return { valid: false, landingPos: null, placePositions: [] }
  }

  // Check headroom along the entire path (need 2 blocks of air above ground)
  const groundY = Math.floor(from.y - 0.001)
  for (let i = 1; i <= gapBlocks + 1; i++) {
    const checkX = Math.floor(from.x + direction.dx * i)
    const checkZ = Math.floor(from.z + direction.dz * i)
    for (let y = groundY + 1; y <= groundY + 2; y++) {
      const block = world.getBlock(new Vec3(checkX, y, checkZ))
      if (block && block.boundingBox !== 'empty') {
        return { valid: false, landingPos: null, placePositions: [] }
      }
    }
  }

  return canSpeedBridge(world, from, direction, gapBlocks, opts)
}

/**
 * Generate scaffold edges from a node.
 * These edges bridge horizontal gaps by placing blocks.
 */
export function generateScaffoldEdges (
  node: MovementNode,
  world: CollisionWorld,
  options?: Partial<ScaffoldOptions>
): MovementEdge[] {
  const edges: MovementEdge[] = []
  if (!node.onGround) return edges // scaffold requires ground

  const opts = { ...DEFAULT_SCAFFOLD_OPTIONS, ...options }
  if (!opts.allowPlacement) return edges

  const directions = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
  ]

  for (const dir of directions) {
    // Try speed bridge for gaps 1..maxBridgeGap
    for (let gap = 1; gap <= opts.maxBridgeGap; gap++) {
      const bridge = canSpeedBridge(world, node.pos, dir, gap, opts)
      if (bridge.valid && bridge.landingPos) {
        const predictedTicks = 4 + gap * 3 + opts.placeSettleTicks // approach + place per block + settle
        edges.push({
          from: node,
          to: {
            pos: bridge.landingPos,
            vel: new Vec3(0, 0, 0),
            onGround: true,
            sprinting: false
          },
          cost: gap * 2.5 + 1.0,
          predictedTicks,
          controlInputs: {
            forward: false, // backward for speed bridge
            back: true,
            left: false,
            right: false,
            jump: false,
            sprint: false,
            sneak: true // sneak to avoid falling off edge
          },
          type: 'scaffold'
        })
        break // only add the smallest valid gap for this direction
      }
    }

    // Try ninja bridge for longer gaps (2..maxBridgeGap+1)
    if (opts.allowNinja) {
      for (let gap = 2; gap <= opts.maxBridgeGap + 1; gap++) {
        const bridge = canNinjaBridge(world, node.pos, dir, gap, opts)
        if (bridge.valid && bridge.landingPos) {
          const predictedTicks = 3 + gap * 2 // faster per block
          edges.push({
            from: node,
            to: {
              pos: bridge.landingPos,
              vel: new Vec3(0, 0, 0),
              onGround: true,
              sprinting: true
            },
            cost: gap * 2.0 + 0.5,
            predictedTicks,
            controlInputs: {
              forward: false,
              back: true,
              left: false,
              right: false,
              jump: true, // jump-assisted
              sprint: true,
              sneak: false // no sneak in ninja
            },
            type: 'scaffoldNinja'
          })
          break
        }
      }
    }
  }

  return edges
}

/**
 * Compute control inputs for executing a scaffold placement tick-by-tick.
 *
 * Phases:
 * 1. approach    — align to edge, look backward/down, hold sneak
 * 2. place       — place block(s) while walking backward
 * 3. settle      — wait briefly for block to appear, then step forward
 * 4. done        — resume normal movement
 */
export interface ScaffoldPhase {
  tick: number
  phase: 'approach' | 'place' | 'settle' | 'done'
  placePositions: Vec3[]
  currentPlaceIndex: number
  isNinja: boolean
}

export function computeScaffoldControls (
  phase: ScaffoldPhase,
  _current: MovementNode,
  _target: Vec3
): ControlInputs & { phase: ScaffoldPhase['phase']; done: boolean } {
  const inputs: ControlInputs = {
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false
  }

  let nextPhase = phase.phase
  let done = false

  switch (phase.phase) {
    case 'approach': {
      // Walk backward toward the edge while sneaking
      inputs.back = true
      inputs.sneak = true
      // After 2 ticks of approach, start placing
      if (phase.tick >= 2 && phase.placePositions.length > 0) {
        nextPhase = 'place'
      }
      break
    }
    case 'place': {
      // Walk backward (or sprint backward for ninja) and place blocks
      if (phase.isNinja) {
        inputs.back = true
        inputs.sprint = true
        inputs.jump = phase.tick % 3 === 0 // intermittent jumps
      } else {
        inputs.back = true
        inputs.sneak = true
      }

      // Simulate placing one block per tick
      if (phase.currentPlaceIndex < phase.placePositions.length) {
        // In a real bot this would call bot.placeBlock()
        phase.currentPlaceIndex++
      }

      if (phase.currentPlaceIndex >= phase.placePositions.length) {
        nextPhase = 'settle'
      }
      break
    }
    case 'settle': {
      // Brief pause to let block appear and ensure we're standing on it
      inputs.sneak = !phase.isNinja
      if (phase.tick >= 2) {
        nextPhase = 'done'
        done = true
      }
      break
    }
    case 'done': {
      done = true
      break
    }
  }

  return { ...inputs, phase: nextPhase, done }
}

/**
 * Estimate ticks for a scaffold bridge.
 */
export function estimateScaffoldTicks (gapBlocks: number, isNinja: boolean, settleTicks = 2): number {
  if (isNinja) {
    return 2 + gapBlocks * 2 // fast
  }
  return 3 + gapBlocks * 4 + settleTicks // slower, careful
}

/**
 * State machine for executing a scaffold bridge tick-by-tick.
 */
export class ScaffoldExecutor {
  private phase: ScaffoldPhase = {
    tick: 0,
    phase: 'approach',
    placePositions: [],
    currentPlaceIndex: 0,
    isNinja: false
  }

  private active = false

  start (placePositions: Vec3[], isNinja = false): void {
    this.phase = {
      tick: 0,
      phase: 'approach',
      placePositions,
      currentPlaceIndex: 0,
      isNinja
    }
    this.active = true
  }

  tick (current: MovementNode, target: Vec3): ControlInputs & { done: boolean } {
    if (!this.active) {
      return { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, done: true }
    }

    const result = computeScaffoldControls(this.phase, current, target)
    this.phase.tick++
    this.phase.phase = result.phase

    if (result.done) {
      this.active = false
    }

    return result
  }

  isActive (): boolean {
    return this.active
  }

  reset (): void {
    this.active = false
    this.phase = {
      tick: 0,
      phase: 'approach',
      placePositions: [],
      currentPlaceIndex: 0,
      isNinja: false
    }
  }
}
