import { Vec3 } from 'vec3'
import type { AABB, PlayerStateLike } from 'prismarine-physics'

/**
 * Standard player AABB dimensions.
 */
export const PLAYER_WIDTH = 0.6
export const PLAYER_HEIGHT = 1.8
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2

/**
 * Movement node used by the pathfinder. Includes position, velocity, and ground state.
 */
export interface MovementNode {
  pos: Vec3
  vel: Vec3
  onGround: boolean
  sprinting: boolean
}

/**
 * Classification of movement edges for execution timing and animation.
 */
export type MovementEdgeType =
  | 'walk'
  | 'sprint'
  | 'jumpUp'
  | 'dropDown'
  | 'gap'
  | 'gap2'
  | 'gap3'
  | 'ladderUp'
  | 'ladderDown'
  | 'fenceVault'
  | 'swim'
  | 'parkour'
  | 'scaffold'
  | 'scaffoldNinja'
  | 'elytra'
  | 'pvpStrafe'

/**
 * A movement edge connecting two nodes with a predicted cost.
 */
export interface MovementEdge {
  from: MovementNode
  to: MovementNode
  cost: number
  predictedTicks: number
  controlInputs: ControlInputs
  type?: MovementEdgeType
}

/**
 * Control inputs that can be applied to a PlayerState during simulation.
 */
export interface ControlInputs {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean
  sneak: boolean
}

/**
 * A goal for the pathfinder to reach.
 */
export interface PathGoal {
  /**
   * Returns true if the given position satisfies this goal.
   */
  isEnd (pos: Vec3): boolean

  /**
   * Heuristic estimate from pos to the goal (must be admissible).
   */
  heuristic (pos: Vec3): number
}

/**
 * Result of a pathfinding query.
 */
export interface PathResult {
  path: MovementNode[]
  cost: number
  status: 'success' | 'noPath' | 'timeout'
}

/**
 * Block collision data resolved for a specific block state.
 */
export interface ResolvedBlockCollision {
  blockName: string
  stateId: number
  aabbs: AABB[]
  boundingBox: 'block' | 'empty'
}

/**
 * A block as seen by the collision service.
 */
export interface BlockCollisionInfo {
  position: Vec3
  name: string
  stateId: number
  boundingBox: 'block' | 'empty'
  shapes: Array<[number, number, number, number, number, number]>
}

/**
 * Interface for a world that can provide block collision information.
 */
export interface CollisionWorld {
  getBlock (pos: Vec3): BlockCollisionInfo | null
}

/**
 * Player state snapshot for simulation and validation.
 */
export interface SimPlayerState extends PlayerStateLike {
  /**
   * Clone this state so simulations do not mutate the original.
   */
  clone (): SimPlayerState
}

/**
 * Options for the swept-AABB validator.
 */
export interface SweptValidationOptions {
  /**
   * Number of micro-steps between origin and destination.
   * @default 8
   */
  steps?: number
  /**
   * Expand the player AABB by this margin for collision queries.
   * @default 0.001
   */
  margin?: number
  /**
   * Whether the entity is on ground. Affects step-up logic.
   * @default true
   */
  onGround?: boolean
}
