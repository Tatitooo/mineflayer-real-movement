import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { WorldCollisionService, type McDataLike } from './core/world-collision-service'
import { PhysicsPredictor } from './core/physics-predictor'
import { AStarPathfinder } from './pathfinding/astar-basic'
import { GoalBlock, GoalNear } from './pathfinding/goals'
import { PathExecutor } from './execution/executor'
import { DynamicReplanner } from './execution/dynamic-replanner'
import type { PathGoal, PathResult, CollisionWorld } from './core/types'
import type { HumanizationOptions } from './humanization/humanization-layer'

export interface RealMovementPlugin {
  worldCollision: WorldCollisionService
  goto: (goal: PathGoal, options?: { maxSearchDistance?: number; maxIterations?: number }) => Promise<void>
  findPath: (start: Vec3, goal: PathGoal, options?: { maxSearchDistance?: number; maxIterations?: number }) => PathResult
  stop: () => void
  /** PvP strafe controller. Set a target entity to start strafing. */
  strafe: {
    start: (targetEntity: { position: Vec3; onGround: boolean; health?: number }, options?: import('./movement/pvp-strafing').StrafeOptions) => void
    stop: () => void
    isActive: () => boolean
    getPattern: () => import('./movement/pvp-strafing').StrafePattern | null
  }
  /** Combo executor for W-taps, S-taps, crit jumps. */
  combo: {
    queue: (move: import('./movement/combo-executor').ComboMove) => void
    reset: () => void
    isActive: () => boolean
  }
  /** Elytra flight controller. Call start() when at altitude. */
  elytra: {
    start: (targetPos: Vec3, altitude: number, options?: import('./movement/elytra-controller').ElytraOptions) => void
    boost: () => boolean
    isActive: () => boolean
    isLanded: () => boolean
    reset: () => void
  }
}

export interface RealMovementPluginOptions {
  mcData?: McDataLike
  humanization?: HumanizationOptions
}

import { ElytraExecutor } from './movement/elytra-controller'
import { PvPStrafeController } from './movement/pvp-strafing'
import { ComboExecutor, type ComboMove } from './movement/combo-executor'

export function realMovementPlugin (bot: Bot, pluginOptions?: RealMovementPluginOptions): void {
  const mcData = pluginOptions?.mcData ?? (bot.registry as unknown as McDataLike)
  const worldCollision = new WorldCollisionService(mcData)

  const collisionWorld: CollisionWorld = {
    getBlock (pos) {
      const block = bot.blockAt(pos)
      if (!block) return null
      return {
        position: pos.clone(),
        name: block.name,
        stateId: block.stateId ?? 0,
        boundingBox: (block.boundingBox as 'block' | 'empty') ?? 'block',
        shapes: []
      }
    }
  }

  const predictor = new PhysicsPredictor(collisionWorld, worldCollision, mcData)
  const pathfinder = new AStarPathfinder(collisionWorld, worldCollision, predictor)
  let activeExecutor: PathExecutor | null = null

  // Phase 5 controllers
  let strafeController = new PvPStrafeController()
  const comboExecutor = new ComboExecutor()
  let elytraExecutor = new ElytraExecutor()

  let strafeTarget: { position: Vec3; onGround: boolean; health?: number } | null = null
  let strafeTickHandler: (() => void) | null = null
  let elytraTickHandler: (() => void) | null = null

  const pluginApi: RealMovementPlugin = {
    worldCollision,
    goto: async (goal: PathGoal, options = {}) => {
      // Stop any previous movement
      if (activeExecutor) {
        activeExecutor.stop()
        activeExecutor = null
      }
      pluginApi.strafe.stop()
      pluginApi.elytra.reset()

      const result = pathfinder.findPath(
        bot.entity.position.clone(),
        goal,
        options.maxIterations ?? 10000,
        options.maxSearchDistance
      )
      if (result.status !== 'success') {
        throw new Error(`Pathfinding failed: ${result.status}`)
      }

      // Create a per-path replanner that knows the current goal
      const replanner = new DynamicReplanner(
        bot as unknown as import('./execution/dynamic-replanner').ReplannerBot,
        () => {
          if (activeExecutor) {
            activeExecutor.stop()
            activeExecutor = null
          }
          pluginApi.goto(goal, options).catch(() => {})
        }
      )
      replanner.setPath(result.path)
      replanner.start()

      const replan = () => {
        replanner.stop()
        if (activeExecutor) {
          activeExecutor.stop()
          activeExecutor = null
        }
        pluginApi.goto(goal, options).catch(() => {})
      }

      const botLike = bot as unknown as import('./execution/executor').BotLike & { entity: { yaw: number } }
      // Provide setYaw for instant yaw snap near targets (prevents circling)
      botLike.setYaw = (yaw: number) => { bot.entity.yaw = yaw }

      activeExecutor = new PathExecutor(botLike, {
        replanCallback: replan,
        humanization: pluginOptions?.humanization
      })
      try {
        await activeExecutor.execute(result.path)
      } finally {
        replanner.stop()
        activeExecutor = null
      }
    },
    findPath: (start: Vec3, goal: PathGoal, options = {}) =>
      pathfinder.findPath(start, goal, options.maxIterations ?? 10000, options.maxSearchDistance),
    stop: () => {
      if (activeExecutor) {
        activeExecutor.stop()
        activeExecutor = null
      }
      pluginApi.strafe.stop()
      pluginApi.elytra.reset()
      bot.clearControlStates()
    },
    strafe: {
      start: (targetEntity, options?) => {
        strafeTarget = targetEntity
        strafeController.reset()
        if (options) strafeController = new PvPStrafeController(options)

        strafeTickHandler = () => {
          if (!strafeTarget) return
          const node: import('./core/types').MovementNode = {
            pos: bot.entity.position.clone(),
            vel: bot.entity.velocity.clone(),
            onGround: bot.entity.onGround,
            sprinting: bot.controlState.sprint
          }
          const result = strafeController.tick(
            node,
            strafeTarget.position,
            0, // attackCooldown — user manages this
            20, // botHealth placeholder
            strafeTarget.health ?? 20,
            false // targetAttacking placeholder
          )
          bot.controlState.forward = result.forward
          bot.controlState.back = result.back
          bot.controlState.left = result.left
          bot.controlState.right = result.right
          bot.controlState.jump = result.jump
          bot.controlState.sprint = result.sprint
          bot.controlState.sneak = result.sneak
          bot.entity.yaw = result.targetYaw
          bot.entity.pitch = result.targetPitch
        }
        bot.on('physicsTick', strafeTickHandler)
      },
      stop: () => {
        if (strafeTickHandler) {
          bot.removeListener('physicsTick', strafeTickHandler)
          strafeTickHandler = null
        }
        strafeTarget = null
        strafeController.reset()
      },
      isActive: () => strafeTickHandler !== null,
      getPattern: () => strafeController.getPattern()
    },
    combo: {
      queue: (move: ComboMove) => comboExecutor.queueMove(move),
      reset: () => comboExecutor.reset(),
      isActive: () => comboExecutor.isActive()
    },
    elytra: {
      start: (targetPos, altitude, options?) => {
        elytraExecutor.reset()
        if (options) elytraExecutor = new ElytraExecutor(options)
        elytraExecutor.start(altitude)

        elytraTickHandler = () => {
          const node: import('./core/types').MovementNode = {
            pos: bot.entity.position.clone(),
            vel: bot.entity.velocity.clone(),
            onGround: bot.entity.onGround,
            sprinting: bot.controlState.sprint
          }
          const result = elytraExecutor.tick(
            node,
            targetPos,
            altitude, // simplified: user should update altitude
            (bot.entity as any).elytraFlying ?? false
          )
          bot.controlState.forward = result.forward
          bot.controlState.back = result.back
          bot.controlState.left = result.left
          bot.controlState.right = result.right
          bot.controlState.jump = result.jump
          bot.controlState.sprint = result.sprint
          bot.controlState.sneak = result.sneak
          bot.entity.yaw = result.targetYaw
          bot.entity.pitch = result.targetPitch
          if (result.useFirework) {
            // Firework boost — handled by caller or future inventory integration
          }
          if (elytraExecutor.isLanded() || elytraExecutor.isFailed()) {
            if (elytraTickHandler) {
              bot.removeListener('physicsTick', elytraTickHandler)
              elytraTickHandler = null
            }
          }
        }
        bot.on('physicsTick', elytraTickHandler)
      },
      boost: () => elytraExecutor.requestBoost(),
      isActive: () => elytraExecutor.isActive(),
      isLanded: () => elytraExecutor.isLanded(),
      reset: () => {
        if (elytraTickHandler) {
          bot.removeListener('physicsTick', elytraTickHandler)
          elytraTickHandler = null
        }
        elytraExecutor.reset()
      }
    }
  }

  ;(bot as Bot & { realMovement: RealMovementPlugin }).realMovement = pluginApi
}

export { GoalBlock, GoalNear }
