import { Vec3 } from 'vec3'
import type { CollisionWorld, MovementNode, MovementEdge, ControlInputs, MovementEdgeType } from '../core/types'

/**
 * Classification of parkour moves and their difficulty parameters.
 */
export interface ParkourMove {
  type: MovementEdgeType
  gap: number
  deltaY: number
  /** Required horizontal speed at takeoff (blocks/tick). */
  minTakeoffSpeed: number
  /** Ideal takeoff offset from edge (blocks). Negative = before edge. */
  idealTakeoffOffset: number
  /** Whether sprint is required. */
  requiresSprint: boolean
  /** Whether jump must be held. */
  requiresJump: boolean
  /** Predicted tick duration from takeoff to landing. */
  predictedTicks: number
}

/**
 * Vanilla Minecraft sprint-jump physics approximations.
 * Sprint speed: ~5.6 blocks/s = 0.28 blocks/tick.
 * Jump gives ~1.25 blocks of extra horizontal distance.
 * - 1-block gap: walkable without sprint.
 * - 2-block gap: requires sprint-jump from edge.
 * - 3-block gap: requires sprint-jump + slight momentum (or speed potion/ice).
 * - 4-block gap: only with Speed II + ice + perfect timing.
 */
export const PARKOUR_MOVES: Record<string, ParkourMove> = {
  gap1: { type: 'gap', gap: 1, deltaY: 0, minTakeoffSpeed: 0.1, idealTakeoffOffset: -0.1, requiresSprint: false, requiresJump: false, predictedTicks: 4 },
  gap2: { type: 'gap2', gap: 2, deltaY: 0, minTakeoffSpeed: 0.22, idealTakeoffOffset: -0.2, requiresSprint: true, requiresJump: true, predictedTicks: 8 },
  gap3: { type: 'gap3', gap: 3, deltaY: 0, minTakeoffSpeed: 0.28, idealTakeoffOffset: -0.25, requiresSprint: true, requiresJump: true, predictedTicks: 12 },
  gap2Up1: { type: 'gap2', gap: 2, deltaY: 1, minTakeoffSpeed: 0.24, idealTakeoffOffset: -0.2, requiresSprint: true, requiresJump: true, predictedTicks: 10 },
  ladderUp: { type: 'ladderUp', gap: 1, deltaY: 1, minTakeoffSpeed: 0.15, idealTakeoffOffset: -0.15, requiresSprint: false, requiresJump: true, predictedTicks: 6 },
  ladderDown: { type: 'ladderDown', gap: 1, deltaY: -1, minTakeoffSpeed: 0.05, idealTakeoffOffset: -0.1, requiresSprint: false, requiresJump: false, predictedTicks: 4 },
  fenceVault: { type: 'fenceVault', gap: 1, deltaY: 0, minTakeoffSpeed: 0.2, idealTakeoffOffset: -0.2, requiresSprint: true, requiresJump: true, predictedTicks: 6 }
}

const LADDER_BLOCKS = new Set(['ladder', 'vine', 'weeping_vines', 'twisting_vines'])
const FENCE_BLOCKS = new Set([
  'oak_fence', 'spruce_fence', 'birch_fence', 'jungle_fence', 'acacia_fence', 'dark_oak_fence',
  'mangrove_fence', 'cherry_fence', 'bamboo_fence', 'nether_brick_fence',
  'crimson_fence', 'warped_fence', 'cobblestone_wall', 'mossy_cobblestone_wall',
  'brick_wall', 'prismarine_wall', 'red_sandstone_wall', 'sandstone_wall',
  'stone_brick_wall', 'nether_brick_wall', 'andesite_wall', 'diorite_wall',
  'granite_wall', 'blackstone_wall', 'polished_blackstone_wall',
  'polished_blackstone_brick_wall', 'cobbled_deepslate_wall',
  'polished_deepslate_wall', 'deepslate_brick_wall', 'deepslate_tile_wall',
  'mud_brick_wall', 'tuff_wall', 'polished_tuff_wall', 'tuff_brick_wall',
  'resin_brick_wall'
])

/**
 * Check if a block is a climbable (ladder/vine).
 */
export function isClimbable (blockName: string): boolean {
  return LADDER_BLOCKS.has(blockName)
}

/**
 * Check if a block is a fence or wall (1.5 blocks high, must jump over).
 */
export function isFenceOrWall (blockName: string): boolean {
  return FENCE_BLOCKS.has(blockName)
}

/**
 * Determine if a sprint-jump can clear a horizontal gap of `gapBlocks` at the same Y level.
 *
 * Vanilla mechanics:
 * - Player AABB width = 0.6, so a 1-block gap is actually 0.4 blocks of air (trivial).
 * - A 2-block gap is 1.4 blocks of air (needs sprint-jump).
 * - A 3-block gap is 2.4 blocks of air (needs sprint-jump + perfect edge timing).
 *
 * We validate by checking:
 * 1. Takeoff block exists and is solid.
 * 2. Landing block exists and is solid.
 * 3. All intermediate blocks are air / non-solid.
 * 4. 2 blocks of headroom above landing (for player height 1.8).
 */
export function canSprintJumpGap (
  world: CollisionWorld,
  from: Vec3,
  direction: { dx: number; dz: number },
  gapBlocks: number,
  deltaY = 0
): { valid: boolean; landingPos: Vec3 | null; move: ParkourMove | null } {
  if (gapBlocks < 1 || gapBlocks > 3) return { valid: false, landingPos: null, move: null }

  const moveKey = deltaY === 0 ? `gap${gapBlocks}` : `gap${gapBlocks}Up${deltaY}`
  const move = PARKOUR_MOVES[moveKey] ?? PARKOUR_MOVES[`gap${gapBlocks}`]
  if (!move) return { valid: false, landingPos: null, move: null }

  // Takeoff is at from position (must be on solid ground)
  const takeoffGroundY = Math.floor(from.y - 0.001)
  const takeoffGroundBlock = world.getBlock(new Vec3(Math.floor(from.x), takeoffGroundY, Math.floor(from.z)))
  if (!takeoffGroundBlock || takeoffGroundBlock.boundingBox === 'empty') {
    return { valid: false, landingPos: null, move: null }
  }

  // Landing position: gapBlocks away in direction, at Y = from.y + deltaY
  const landingX = Math.floor(from.x + direction.dx * (gapBlocks + 1))
  const landingZ = Math.floor(from.z + direction.dz * (gapBlocks + 1))
  const landingY = takeoffGroundY + deltaY

  // Landing ground must be solid
  const landingGroundBlock = world.getBlock(new Vec3(landingX, landingY, landingZ))
  if (!landingGroundBlock || landingGroundBlock.boundingBox === 'empty') {
    return { valid: false, landingPos: null, move: null }
  }

  // Check all intermediate blocks (the gap itself) are empty
  for (let i = 1; i <= gapBlocks; i++) {
    const checkX = Math.floor(from.x + direction.dx * i)
    const checkZ = Math.floor(from.z + direction.dz * i)
    // Check ground level and headroom at this intermediate position
    for (let y = landingY; y <= landingY + 2; y++) {
      const block = world.getBlock(new Vec3(checkX, y, checkZ))
      if (block && block.boundingBox !== 'empty') {
        return { valid: false, landingPos: null, move: null }
      }
    }
  }

  // Headroom above landing: need 2 blocks of air above landing ground
  const landingAir1 = world.getBlock(new Vec3(landingX, landingY + 1, landingZ))
  const landingAir2 = world.getBlock(new Vec3(landingX, landingY + 2, landingZ))
  if ((landingAir1 && landingAir1.boundingBox !== 'empty') || (landingAir2 && landingAir2.boundingBox !== 'empty')) {
    return { valid: false, landingPos: null, move: null }
  }

  const landingPos = new Vec3(landingX + 0.5, landingY + 1, landingZ + 0.5)
  return { valid: true, landingPos, move }
}

/**
 * Check whether there is a ladder block at the target position that the player
 * can jump onto/climb from the current position.
 */
export function canLadderJump (
  world: CollisionWorld,
  from: Vec3,
  direction: { dx: number; dz: number },
  deltaY: number
): { valid: boolean; ladderPos: Vec3 | null; move: ParkourMove | null } {
  const targetX = Math.floor(from.x + direction.dx)
  const targetZ = Math.floor(from.z + direction.dz)
  const targetY = Math.floor(from.y) + deltaY

  const block = world.getBlock(new Vec3(targetX, targetY, targetZ))
  if (!block || !isClimbable(block.name)) {
    return { valid: false, ladderPos: null, move: null }
  }

  // Must have solid ground or another ladder below the target ladder
  const below = world.getBlock(new Vec3(targetX, targetY - 1, targetZ))
  const hasSupport = (below && below.boundingBox !== 'empty') || (below && isClimbable(below.name))
  if (!hasSupport) return { valid: false, ladderPos: null, move: null }

  const move = deltaY > 0 ? PARKOUR_MOVES.ladderUp : PARKOUR_MOVES.ladderDown
  const ladderPos = new Vec3(targetX + 0.5, targetY, targetZ + 0.5)
  return { valid: true, ladderPos, move }
}

/**
 * Check whether the player can vault over a fence/wall that is one block ahead.
 *
 * Fence/walls are 1.5 blocks high. To vault over:
 * 1. The block ahead must be a fence/wall.
 * 2. The block on top of the fence must be empty.
 * 3. The block after the fence must have solid ground (or be empty for a drop).
 */
export function canFenceVault (
  world: CollisionWorld,
  from: Vec3,
  direction: { dx: number; dz: number }
): { valid: boolean; landingPos: Vec3 | null; move: ParkourMove | null } {
  const fenceX = Math.floor(from.x + direction.dx)
  const fenceZ = Math.floor(from.z + direction.dz)
  const groundY = Math.floor(from.y - 0.001)

  // The fence/wall itself
  const fenceBlock = world.getBlock(new Vec3(fenceX, groundY, fenceZ))
  if (!fenceBlock || !isFenceOrWall(fenceBlock.name)) {
    return { valid: false, landingPos: null, move: null }
  }

  // Top of fence must be empty (player head passes through)
  const topBlock = world.getBlock(new Vec3(fenceX, groundY + 1, fenceZ))
  if (topBlock && topBlock.boundingBox !== 'empty') {
    return { valid: false, landingPos: null, move: null }
  }

  // Need headroom above the fence (player is 1.8 tall, fence is 1.5, so 0.3 clearance at y+1)
  // But we also check y+2 for safety
  const aboveTop = world.getBlock(new Vec3(fenceX, groundY + 2, fenceZ))
  if (aboveTop && aboveTop.boundingBox !== 'empty') {
    return { valid: false, landingPos: null, move: null }
  }

  // Landing block: one block past the fence
  const landingX = Math.floor(from.x + direction.dx * 2)
  const landingZ = Math.floor(from.z + direction.dz * 2)
  const landingGround = world.getBlock(new Vec3(landingX, groundY, landingZ))

  // For a vault, we either land on solid ground on the other side, or it's a gap-jump-vault
  if (!landingGround || landingGround.boundingBox === 'empty') {
    // Allow if it's a drop (the player lands on ground below)
    const landingGroundBelow = world.getBlock(new Vec3(landingX, groundY - 1, landingZ))
    if (!landingGroundBelow || landingGroundBelow.boundingBox === 'empty') {
      return { valid: false, landingPos: null, move: null }
    }
  }

  const landingPos = new Vec3(landingX + 0.5, groundY + 1, landingZ + 0.5)
  return { valid: true, landingPos, move: PARKOUR_MOVES.fenceVault }
}

/**
 * Generate parkour edges from a node.
 * Checks for sprint-jump gaps (1-3), ladder jumps, and fence vaults.
 */
export function generateParkourEdges (
  node: MovementNode,
  world: CollisionWorld
): MovementEdge[] {
  const edges: MovementEdge[] = []
  if (!node.onGround) return edges // most parkour requires ground

  const directions = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
  ]

  for (const dir of directions) {
    // Gap jumps (1-3 blocks same Y)
    for (let gap = 1; gap <= 3; gap++) {
      const gapResult = canSprintJumpGap(world, node.pos, dir, gap, 0)
      if (gapResult.valid && gapResult.landingPos && gapResult.move) {
        edges.push({
          from: node,
          to: {
            pos: gapResult.landingPos,
            vel: new Vec3(0, 0, 0),
            onGround: true,
            sprinting: gapResult.move.requiresSprint
          },
          cost: gapResult.move.predictedTicks * 0.25,
          predictedTicks: gapResult.move.predictedTicks,
          controlInputs: {
            forward: true,
            sprint: gapResult.move.requiresSprint,
            jump: gapResult.move.requiresJump,
            back: false, left: false, right: false, sneak: false
          },
          type: gapResult.move.type
        })
      }
    }

    // Gap 2 up 1 (jump across a gap and up 1 block)
    const upGapResult = canSprintJumpGap(world, node.pos, dir, 2, 1)
    if (upGapResult.valid && upGapResult.landingPos && upGapResult.move) {
      edges.push({
        from: node,
        to: {
          pos: upGapResult.landingPos,
          vel: new Vec3(0, 0, 0),
          onGround: true,
          sprinting: true
        },
        cost: upGapResult.move.predictedTicks * 0.25,
        predictedTicks: upGapResult.move.predictedTicks,
        controlInputs: {
          forward: true,
          sprint: true,
          jump: true,
          back: false, left: false, right: false, sneak: false
        },
        type: upGapResult.move.type
      })
    }

    // Ladder jumps (up and down)
    for (const deltaY of [1, -1]) {
      const ladderResult = canLadderJump(world, node.pos, dir, deltaY)
      if (ladderResult.valid && ladderResult.ladderPos && ladderResult.move) {
        edges.push({
          from: node,
          to: {
            pos: ladderResult.ladderPos,
            vel: new Vec3(0, 0, 0),
            onGround: false,
            sprinting: false
          },
          cost: ladderResult.move.predictedTicks * 0.2,
          predictedTicks: ladderResult.move.predictedTicks,
          controlInputs: {
            forward: true,
            sprint: false,
            jump: ladderResult.move.requiresJump,
            back: false, left: false, right: false, sneak: false
          },
          type: ladderResult.move.type
        })
      }
    }

    // Fence vaults
    const fenceResult = canFenceVault(world, node.pos, dir)
    if (fenceResult.valid && fenceResult.landingPos && fenceResult.move) {
      edges.push({
        from: node,
        to: {
          pos: fenceResult.landingPos,
          vel: new Vec3(0, 0, 0),
          onGround: true,
          sprinting: true
        },
        cost: fenceResult.move.predictedTicks * 0.3,
        predictedTicks: fenceResult.move.predictedTicks,
        controlInputs: {
          forward: true,
          sprint: true,
          jump: true,
          back: false, left: false, right: false, sneak: false
        },
        type: fenceResult.move.type
      })
    }
  }

  return edges
}

/**
 * Compute control inputs for executing a parkour move.
 *
 * Parkour moves require precise timing:
 * - Sprint must be held BEFORE the jump (2-3 ticks of sprint to build speed).
 * - Jump must be pressed at the edge (not before, not after).
 * - Forward should be held continuously.
 *
 * The executor calls this each tick and uses `phase` to manage timing.
 */
export interface ParkourPhase {
  /** Number of ticks into the parkour move. */
  tick: number
  /** Current phase of the move. */
  phase: 'approach' | 'takeoff' | 'airborne' | 'landing'
  /** The parkour move being executed. */
  move: ParkourMove
}

/**
 * Advance the parkour phase machine by one tick and return updated controls.
 */
export function computeParkourControls (
  phase: ParkourPhase,
  current: MovementNode,
  target: Vec3
): ControlInputs & { phase: ParkourPhase['phase']; done: boolean } {
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  let nextPhase = phase.phase
  let done = false

  switch (phase.phase) {
    case 'approach': {
      // Sprint toward the edge to build speed
      if (phase.tick >= 2) {
        // Transition to takeoff: apply jump immediately on this tick
        nextPhase = 'takeoff'
        inputs.forward = true
        inputs.sprint = phase.move.requiresSprint
        inputs.jump = phase.move.requiresJump
      } else {
        inputs.forward = true
        inputs.sprint = phase.move.requiresSprint
      }
      break
    }
    case 'takeoff': {
      // At the edge: jump NOW while holding sprint and forward
      inputs.forward = true
      inputs.sprint = phase.move.requiresSprint
      inputs.jump = phase.move.requiresJump
      nextPhase = 'airborne'
      break
    }
    case 'airborne': {
      // While in the air, hold forward and sprint (sprint affects air speed slightly)
      inputs.forward = true
      inputs.sprint = phase.move.requiresSprint
      // If we're close to landing and the target is below, release jump
      const dy = target.y - current.pos.y
      const dist = current.pos.distanceTo(target)
      if (dy < -0.5 && dist < 1.5) {
        // Preparing to land on lower ground — no special action needed
      }
      // Transition to landing when on ground, and mark done immediately
      if (current.onGround) {
        nextPhase = 'landing'
        done = true
      }
      break
    }
    case 'landing': {
      // Just landed — hold forward briefly to ensure we don't fall off
      inputs.forward = true
      done = true
      break
    }
  }

  return { ...inputs, phase: nextPhase, done }
}

/**
 * Estimate the number of ticks for a parkour move.
 */
export function estimateParkourTicks (move: ParkourMove): number {
  return move.predictedTicks + 3 // +3 for approach / landing margin
}

/**
 * State machine for executing a single parkour move tick-by-tick.
 * Used by the PathExecutor when it encounters a parkour edge.
 */
export class ParkourExecutor {
  private phase: ParkourPhase = { tick: 0, phase: 'approach', move: PARKOUR_MOVES.gap2 }
  private active = false

  start (move: ParkourMove): void {
    this.phase = { tick: 0, phase: 'approach', move }
    this.active = true
  }

  tick (current: MovementNode, target: Vec3): ControlInputs & { done: boolean } {
    if (!this.active) {
      return { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, done: true }
    }

    const result = computeParkourControls(this.phase, current, target)
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
    this.phase = { tick: 0, phase: 'approach', move: PARKOUR_MOVES.gap2 }
  }
}
