import { Vec3 } from 'vec3'
import { Physics } from 'prismarine-physics'
import type { BlockInWorld, PhysicsEngine, PlayerStateLike, World } from 'prismarine-physics'
import type { McDataLike, WorldCollisionService } from './world-collision-service'
import type { CollisionWorld, ControlInputs, MovementNode } from './types'

/**
 * Optional effect / equipment state for more accurate physics prediction.
 */
export interface PredictorEffectState {
  speed?: number // Speed potion level (0 = none, 1 = I, 2 = II)
  jumpBoost?: number
  slowness?: number
  depthStrider?: number
  slowFalling?: number
  dolphinsGrace?: number
  levitation?: number
}

interface PredictorOptions {
  /** Max ticks to simulate before giving up on reaching the target. */
  maxSimulationTicks?: number
  /** Distance threshold to consider the target reached. */
  arrivalThreshold?: number
  effects?: PredictorEffectState
}

const DEFAULT_OPTIONS: Required<Omit<PredictorOptions, 'effects'>> & { effects: PredictorEffectState } = {
  maxSimulationTicks: 80,
  arrivalThreshold: 0.3,
  effects: {}
}

/**
 * Adapts our CollisionWorld + WorldCollisionService to the prismarine-physics
 * World interface (getBlock with position, shapes, type, metadata).
 */
class PredictorWorld implements World {
  private readonly blockTypeCache = new Map<string, number>()

  constructor (
    private readonly world: CollisionWorld,
    private readonly collisionService: WorldCollisionService,
    private readonly mcData: McDataLike
  ) {}

  getBlock (pos: Vec3): BlockInWorld | null {
    const block = this.world.getBlock(pos)
    if (!block || block.boundingBox === 'empty') return null

    const type = this.resolveBlockType(block.name)

    // Convert world-space AABBs back to local shapes relative to block origin
    const aabbs = this.collisionService.getBlockAABBs(block)
    const shapes: Array<[number, number, number, number, number, number]> = aabbs.map(aabb => [
      aabb.minX - pos.x,
      aabb.minY - pos.y,
      aabb.minZ - pos.z,
      aabb.maxX - pos.x,
      aabb.maxY - pos.y,
      aabb.maxZ - pos.z
    ])

    return {
      position: pos,
      type,
      name: block.name,
      boundingBox: block.boundingBox,
      shapes,
      metadata: 0
    }
  }

  private resolveBlockType (name: string): number {
    const cached = this.blockTypeCache.get(name)
    if (cached != null) return cached
    const entry = this.mcData.blocksByName[name]
    const id = entry != null && 'id' in entry ? (entry as unknown as { id: number }).id : 0
    this.blockTypeCache.set(name, id)
    return id
  }
}

/**
 * Build a prismarine-physics compatible entity from a MovementNode and control inputs.
 */
function createPredictorEntity (
  node: MovementNode,
  controls: ControlInputs,
  yaw: number,
  effects: PredictorEffectState
): PlayerStateLike {
  return {
    pos: node.pos.clone(),
    vel: node.vel.clone(),
    onGround: node.onGround,
    yaw,
    pitch: 0,
    control: {
      forward: controls.forward,
      back: controls.back,
      left: controls.left,
      right: controls.right,
      jump: controls.jump,
      sprint: controls.sprint,
      sneak: controls.sneak
    },
    isInWater: false,
    isInLava: false,
    isInWeb: false,
    isCollidedHorizontally: false,
    isCollidedVertically: false,
    elytraFlying: false,
    elytraEquipped: false,
    fireworkRocketDuration: 0,
    jumpTicks: 0,
    jumpQueued: false,
    attributes: {},
    speed: effects.speed ?? 0,
    slowness: effects.slowness ?? 0,
    jumpBoost: effects.jumpBoost ?? 0,
    depthStrider: effects.depthStrider ?? 0,
    dolphinsGrace: effects.dolphinsGrace ?? 0,
    slowFalling: effects.slowFalling ?? 0,
    levitation: effects.levitation ?? 0
  }
}

/**
 * Result of simulating a movement edge with prismarine-physics.
 */
export interface SimulationResult {
  /** Number of ticks simulated before reaching target (or timeout). */
  predictedTicks: number
  /** Whether the entity arrived within the arrival threshold. */
  arrived: boolean
  /** Position after simulation. */
  exitPos: Vec3
  /** Velocity after simulation. */
  exitVel: Vec3
  /** Whether the entity is on ground after simulation. */
  onGround: boolean
}

/**
 * PhysicsPredictor uses prismarine-physics tick simulation to estimate the real
 * time cost and exit velocity of a movement edge.
 *
 * This is the core of momentum-aware pathfinding: instead of hardcoded costs,
 * each edge cost = actual predicted ticks, and exit velocity feeds into the next edge.
 */
export class PhysicsPredictor {
  private readonly physics: PhysicsEngine
  private readonly predictorWorld: PredictorWorld

  constructor (
    world: CollisionWorld,
    collisionService: WorldCollisionService,
    mcData: McDataLike
  ) {
    this.predictorWorld = new PredictorWorld(world, collisionService, mcData)
    this.physics = Physics(mcData as unknown as Record<string, unknown>, this.predictorWorld)
  }

  /**
   * Simulate moving from `from` toward `targetPos` with the given control inputs.
   * Runs up to `maxSimulationTicks` ticks of prismarine-physics simulation.
   *
   * @returns SimulationResult with predicted ticks, exit velocity, and arrival status.
   */
  simulateEdge (
    from: MovementNode,
    controls: ControlInputs,
    targetPos: Vec3,
    options?: PredictorOptions
  ): SimulationResult {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const entity = createPredictorEntity(from, controls, this.yawToTarget(from.pos, targetPos), opts.effects ?? {})

    let predictedTicks = 0
    let arrived = false

    for (let tick = 0; tick < opts.maxSimulationTicks; tick++) {
      this.physics.simulatePlayer(entity, this.predictorWorld)
      predictedTicks++

      const dist = entity.pos.distanceTo(targetPos)
      if (dist < opts.arrivalThreshold) {
        arrived = true
        break
      }

      // If the entity is stuck (velocity near zero, not arriving), abort early
      if (tick > 10 && Math.abs(entity.vel.x) < 0.001 && Math.abs(entity.vel.z) < 0.001 && entity.onGround) {
        break
      }
    }

    return {
      predictedTicks,
      arrived,
      exitPos: entity.pos.clone(),
      exitVel: entity.vel.clone(),
      onGround: entity.onGround
    }
  }

  /**
   * Quick heuristic tick estimate when full simulation is too expensive
   * (e.g., during A* open-list flood where we need cheap costs).
   */
  estimateTicksHeuristic (from: Vec3, to: Vec3, sprinting: boolean): number {
    const dist = from.distanceTo(to)
    const speed = sprinting ? 5.6 : 4.3
    return Math.ceil((dist / speed) * 20) + 2
  }

  private yawToTarget (pos: Vec3, target: Vec3): number {
    const dx = target.x - pos.x
    const dz = target.z - pos.z
    return Math.atan2(-dx, -dz)
  }
}
