import { Vec3 } from 'vec3'
import type { CollisionWorld, BlockCollisionInfo } from '../core/types'

/**
 * Categories of blocks that modify player movement in vanilla Minecraft.
 * These affect speed, jump height, friction, and control-state behavior.
 */
export type SpecialBlockType =
  | 'soul_sand'
  | 'honey_block'
  | 'slime_block'
  | 'cobweb'
  | 'ice'
  | 'packed_ice'
  | 'blue_ice'
  | 'bubble_column'
  | 'water'
  | 'lava'
  | 'none'

/**
 * Movement modifiers applied when standing on or inside a special block.
 * Multipliers are relative to normal ground movement (1.0 = baseline).
 */
export interface MovementModifier {
  speedMultiplier: number
  jumpMultiplier: number
  frictionMultiplier: number
  canSprint: boolean
  canJump: boolean
  /** Extra vertical velocity applied per tick (for bubble columns / slime). */
  verticalPush: number
  /** Whether the player is considered "on ground" for pathfinding purposes. */
  treatsAsGround: boolean
}

const DEFAULT_MODIFIER: MovementModifier = {
  speedMultiplier: 1.0,
  jumpMultiplier: 1.0,
  frictionMultiplier: 1.0,
  canSprint: true,
  canJump: true,
  verticalPush: 0,
  treatsAsGround: true
}

const MODIFIERS: Record<SpecialBlockType, MovementModifier> = {
  soul_sand: {
    speedMultiplier: 0.4,
    jumpMultiplier: 1.0,
    frictionMultiplier: 0.4,
    canSprint: false,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  honey_block: {
    speedMultiplier: 0.3,
    jumpMultiplier: 0.2,
    frictionMultiplier: 0.3,
    canSprint: false,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  slime_block: {
    speedMultiplier: 1.0,
    jumpMultiplier: 4.0,
    frictionMultiplier: 0.8,
    canSprint: true,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  cobweb: {
    speedMultiplier: 0.05,
    jumpMultiplier: 0.0,
    frictionMultiplier: 0.05,
    canSprint: false,
    canJump: false,
    verticalPush: 0,
    treatsAsGround: false
  },
  ice: {
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    frictionMultiplier: 0.02,
    canSprint: true,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  packed_ice: {
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    frictionMultiplier: 0.02,
    canSprint: true,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  blue_ice: {
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    frictionMultiplier: 0.01,
    canSprint: true,
    canJump: true,
    verticalPush: 0,
    treatsAsGround: true
  },
  bubble_column: {
    speedMultiplier: 0.8,
    jumpMultiplier: 0.5,
    frictionMultiplier: 0.9,
    canSprint: false,
    canJump: false,
    verticalPush: 0.9, // upward drag per tick
    treatsAsGround: false
  },
  water: {
    speedMultiplier: 0.3,
    jumpMultiplier: 0.5,
    frictionMultiplier: 0.8,
    canSprint: false,
    canJump: false,
    verticalPush: 0,
    treatsAsGround: false
  },
  lava: {
    speedMultiplier: 0.2,
    jumpMultiplier: 0.0,
    frictionMultiplier: 0.5,
    canSprint: false,
    canJump: false,
    verticalPush: 0,
    treatsAsGround: false
  },
  none: { ...DEFAULT_MODIFIER }
}

/**
 * Map a block name to its special movement category.
 */
export function classifySpecialBlock (blockName: string): SpecialBlockType {
  const name = blockName.toLowerCase()
  if (name.includes('soul_sand') || name.includes('soul_soil')) return 'soul_sand'
  if (name === 'honey_block') return 'honey_block'
  if (name === 'slime_block') return 'slime_block'
  if (name === 'cobweb') return 'cobweb'
  if (name === 'ice') return 'ice'
  if (name === 'packed_ice') return 'packed_ice'
  if (name === 'blue_ice') return 'blue_ice'
  if (name.includes('bubble_column')) return 'bubble_column'
  if (name === 'water') return 'water'
  if (name === 'lava') return 'lava'
  return 'none'
}

/**
 * Get the movement modifier for a given special block type.
 */
export function getModifier (type: SpecialBlockType): MovementModifier {
  return MODIFIERS[type] ?? DEFAULT_MODIFIER
}

/**
 * Get the block directly beneath the player's feet (the block at floor(pos.y) - 1).
 */
export function getGroundBlock (world: CollisionWorld, pos: Vec3): BlockCollisionInfo | null {
  const groundY = Math.floor(pos.y - 0.001)
  return world.getBlock(new Vec3(Math.floor(pos.x), groundY, Math.floor(pos.z)))
}

/**
 * Get the movement modifier for the block the player is currently standing on.
 */
export function getGroundModifier (world: CollisionWorld, pos: Vec3): MovementModifier {
  const block = getGroundBlock(world, pos)
  if (!block) return DEFAULT_MODIFIER
  const type = classifySpecialBlock(block.name)
  return getModifier(type)
}

/**
 * Check whether any block inside the player's AABB is a special fluid or hazard.
 * Returns the *most restrictive* modifier found (lowest speed multiplier).
 */
export function getBodyModifier (world: CollisionWorld, pos: Vec3): MovementModifier {
  const minX = Math.floor(pos.x - 0.3)
  const maxX = Math.floor(pos.x + 0.3)
  const minY = Math.floor(pos.y)
  const maxY = Math.floor(pos.y + 1.8)
  const minZ = Math.floor(pos.z - 0.3)
  const maxZ = Math.floor(pos.z + 0.3)

  let worst: MovementModifier = DEFAULT_MODIFIER
  const cursor = new Vec3(0, 0, 0)

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        cursor.set(x, y, z)
        const block = world.getBlock(cursor)
        if (!block) continue
        const type = classifySpecialBlock(block.name)
        if (type === 'none') continue
        const mod = getModifier(type)
        if (mod.speedMultiplier < worst.speedMultiplier) {
          worst = mod
        }
      }
    }
  }

  return worst
}

/**
 * Determine whether the player is currently on ice (any variant).
 */
export function isOnIce (world: CollisionWorld, pos: Vec3): boolean {
  const block = getGroundBlock(world, pos)
  if (!block) return false
  const type = classifySpecialBlock(block.name)
  return type === 'ice' || type === 'packed_ice' || type === 'blue_ice'
}

/**
 * Determine whether the player is currently in a cobweb.
 */
export function isInCobweb (world: CollisionWorld, pos: Vec3): boolean {
  const block = getGroundBlock(world, pos)
  if (!block) return false
  return classifySpecialBlock(block.name) === 'cobweb'
}

/**
 * Determine whether the player is currently on soul sand.
 */
export function isOnSoulSand (world: CollisionWorld, pos: Vec3): boolean {
  const block = getGroundBlock(world, pos)
  if (!block) return false
  return classifySpecialBlock(block.name) === 'soul_sand'
}
