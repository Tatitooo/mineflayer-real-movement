import { Vec3 } from 'vec3'
import type { MovementNode } from '../core/types'
import { computeControlInputs } from './control-generator'
import { hasArrived, yawDifference, yawToTarget } from './alignment-logic'
import { ParkourExecutor, PARKOUR_MOVES, type ParkourMove } from '../movement/parkour-executor'
import { ScaffoldExecutor } from '../movement/scaffold-extension'
import { HumanizationLayer, type HumanizationOptions } from '../humanization/humanization-layer'
/**
 * Minimal bot interface required by the executor.
 * This decouples the executor from the full mineflayer Bot type,
 * enabling unit tests with a lightweight MockBot.
 */
export interface BotLike {
  entity: {
    position: Vec3
    yaw: number
    velocity: Vec3
    onGround: boolean
  }
  controlState: {
    forward: boolean
    back: boolean
    left: boolean
    right: boolean
    jump: boolean
    sprint: boolean
    sneak: boolean
  }
  lookAt: (point: Vec3, force?: boolean) => Promise<void>
  /** Directly set yaw (instant snap). Used for fine alignment near targets. */
  setYaw?: (yaw: number) => void
  clearControlStates: () => void
  on: (event: string, callback: () => void) => void
  removeListener: (event: string, callback: () => void) => void
}

export enum ExecutorState {
  IDLE = 'idle',
  ALIGNING = 'aligning',
  MOVING = 'moving',
  JUMPING = 'jumping',
  FALLING = 'falling',
  REPLANNING = 'replanning',
  DONE = 'done',
  FAILED = 'failed'
}

export interface ExecutorOptions {
  /** Maximum ticks to wait for the bot to reach the next node before replanning. */
  nodeTimeoutTicks?: number
  /** Maximum total ticks for the entire path before giving up. */
  totalTimeoutTicks?: number
  /** If true, the executor will attempt to replan when stuck. */
  allowReplanning?: boolean
  /** Distance threshold to consider a node reached. */
  arrivalThreshold?: number
  /** Called when the executor decides replanning is needed. The caller should
   *  compute a new path and call `execute()` again. */
  replanCallback?: () => void
  /** Humanization layer options. If omitted, humanization is disabled. */
  humanization?: HumanizationOptions
}

const DEFAULT_OPTIONS: Required<Omit<ExecutorOptions, 'humanization'>> & { humanization: HumanizationOptions | undefined } = {
  nodeTimeoutTicks: 60,
  totalTimeoutTicks: 1200,
  allowReplanning: true,
  arrivalThreshold: 0.3,
  replanCallback: () => {},
  humanization: undefined
}

/**
 * Executes a computed path tick-by-tick by setting the bot's control states.
 *
 * The executor listens to `physicsTick` events, updates the bot's look direction,
 * and sets forward/jump/sprint/sneak based on the current path node.
 *
 * Features:
 * - Node-by-node progression with arrival detection
 * - Replanning trigger when stuck (configurable)
 * - Timeout protection (node-level and total)
 * - Yaw smoothing via `lookAt` (throttled, not spammed)
 * - Direct yaw snap for fine alignment near targets
 * - Momentum-aware braking to prevent overshoot
 * - ALIGNING state when the bot needs to rotate in place before moving
 */
export class PathExecutor {
  private state = ExecutorState.IDLE
  private path: MovementNode[] = []
  private currentNodeIndex = 0
  private ticksSinceProgress = 0
  private totalTicks = 0
  private bestProgressIndex = 0
  private resolve: (() => void) | null = null
  private reject: ((err: Error) => void) | null = null
  private readonly options: Required<Omit<ExecutorOptions, 'humanization'>> & { humanization: HumanizationOptions | undefined }
  private tickHandler: (() => void) | null = null
  private parkourExecutor = new ParkourExecutor()
  private scaffoldExecutor = new ScaffoldExecutor()
  private humanization: HumanizationLayer | null = null

  // Look-at throttling to prevent spamming mineflayer's smooth-rotation
  private lookAtCooldown = 0
  private lastLookNodeIndex = -1

  constructor (
    private readonly bot: BotLike,
    options?: ExecutorOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    if (this.options.humanization) {
      this.humanization = new HumanizationLayer(this.options.humanization)
    }
  }

  /**
   * Start executing a path. Returns a promise that resolves when the goal is
   * reached or rejects on timeout / failure.
   */
  async execute (path: MovementNode[]): Promise<void> {
    if (path.length === 0) {
      throw new Error('Cannot execute empty path')
    }

    this.path = path
    this.currentNodeIndex = 0
    this.ticksSinceProgress = 0
    this.totalTicks = 0
    this.bestProgressIndex = 0
    this.state = ExecutorState.MOVING
    this.lookAtCooldown = 0
    this.lastLookNodeIndex = -1

    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject

      this.tickHandler = () => this.onTick()
      this.bot.on('physicsTick', this.tickHandler)
    })
  }

  /**
   * Stop execution immediately and clear all control states.
   */
  stop (): void {
    if (this.tickHandler) {
      this.bot.removeListener('physicsTick', this.tickHandler)
      this.tickHandler = null
    }
    this.bot.clearControlStates()
    this.state = ExecutorState.IDLE
    if (this.reject) {
      this.reject(new Error('Path execution stopped by user'))
      this.reject = null
      this.resolve = null
    }
  }

  private onTick (): void {
    if (this.state === ExecutorState.DONE || this.state === ExecutorState.FAILED) {
      return
    }

    this.totalTicks++
    this.ticksSinceProgress++

    // Total timeout check
    if (this.totalTicks > this.options.totalTimeoutTicks) {
      this.fail(new Error(`Path execution timed out after ${this.totalTicks} ticks`))
      return
    }

    const currentPos = this.bot.entity.position
    const currentYaw = this.bot.entity.yaw
    const currentVel = this.bot.entity.velocity
    const onGround = this.bot.entity.onGround

    // Check if we arrived at the final goal
    const finalNode = this.path[this.path.length - 1]
    if (hasArrived(currentPos, finalNode.pos, this.options.arrivalThreshold)) {
      this.succeed()
      return
    }

    // Advance node index if we've arrived at the current intermediate node
    while (
      this.currentNodeIndex < this.path.length - 1 &&
      hasArrived(currentPos, this.path[this.currentNodeIndex].pos, this.options.arrivalThreshold)
    ) {
      this.currentNodeIndex++
      this.ticksSinceProgress = 0
      if (this.currentNodeIndex > this.bestProgressIndex) {
        this.bestProgressIndex = this.currentNodeIndex
      }
    }

    // Check if we're making progress; if not, trigger replan / fail
    if (this.ticksSinceProgress > this.options.nodeTimeoutTicks) {
      if (this.options.allowReplanning && this.state !== ExecutorState.REPLANNING) {
        this.state = ExecutorState.REPLANNING
        this.options.replanCallback()
        return
      } else {
        this.fail(new Error(`Stuck at node ${this.currentNodeIndex} after ${this.ticksSinceProgress} ticks`))
        return
      }
    }

    const targetNode = this.path[this.currentNodeIndex]
    const currentNode: MovementNode = {
      pos: currentPos,
      vel: currentVel,
      onGround,
      sprinting: this.bot.controlState.sprint
    }

    let controls: ReturnType<typeof computeControlInputs> = computeControlInputs(currentNode, targetNode, currentYaw)

    // Detect scaffold edges and use ScaffoldExecutor
    const isScaffoldEdge = targetNode && this.currentNodeIndex > 0 && this.isScaffoldEdgeType(this.path[this.currentNodeIndex - 1], targetNode)
    if (isScaffoldEdge) {
      if (!this.scaffoldExecutor.isActive()) {
        const isNinja = this.isNinjaEdgeType(this.path[this.currentNodeIndex - 1], targetNode)
        // Estimate place positions from the edge delta
        const prev = this.path[this.currentNodeIndex - 1]
        const dx = Math.sign(targetNode.pos.x - prev.pos.x)
        const dz = Math.sign(targetNode.pos.z - prev.pos.z)
        const gap = Math.round(Math.max(Math.abs(targetNode.pos.x - prev.pos.x), Math.abs(targetNode.pos.z - prev.pos.z))) - 1
        const placePositions: Vec3[] = []
        const groundY = Math.floor(prev.pos.y - 0.001)
        for (let i = 1; i <= Math.max(0, gap); i++) {
          placePositions.push(new Vec3(Math.floor(prev.pos.x + dx * i), groundY, Math.floor(prev.pos.z + dz * i)))
        }
        this.scaffoldExecutor.start(placePositions, isNinja)
      }
      const scaffoldResult = this.scaffoldExecutor.tick(currentNode, targetNode.pos)
      controls = { ...scaffoldResult, targetYaw: yawToTarget(currentPos, targetNode.pos), targetPitch: 0 }
    } else {
      this.scaffoldExecutor.reset()
    }

    // Detect parkour edges and use ParkourExecutor for stateful timing
    const isParkourEdge = targetNode && this.currentNodeIndex > 0 && this.isParkourEdgeType(this.path[this.currentNodeIndex - 1], targetNode)
    if (isParkourEdge && !isScaffoldEdge) {
      if (!this.parkourExecutor.isActive()) {
        const move = this.resolveParkourMove(this.path[this.currentNodeIndex - 1], targetNode)
        if (move) this.parkourExecutor.start(move)
      }
      const parkourResult = this.parkourExecutor.tick(currentNode, targetNode.pos)
      controls = { ...parkourResult, targetYaw: yawToTarget(currentPos, targetNode.pos), targetPitch: 0 }
    } else if (!isScaffoldEdge) {
      this.parkourExecutor.reset()
      controls = computeControlInputs(currentNode, targetNode, currentYaw)
    }

    // Apply humanization layer if enabled
    if (this.humanization) {
      const humanized = this.humanization.humanize(
        {
          forward: controls.forward,
          back: controls.back,
          left: controls.left,
          right: controls.right,
          jump: controls.jump,
          sprint: controls.sprint,
          sneak: controls.sneak,
          targetYaw: controls.targetYaw,
          targetPitch: controls.targetPitch
        },
        currentPos,
        currentYaw,
        0, // currentPitch — executor doesn't track pitch yet
        this.totalTicks,
        targetNode.pos
      )
      controls = {
        forward: humanized.forward,
        back: humanized.back,
        left: humanized.left,
        right: humanized.right,
        jump: humanized.jump,
        sprint: humanized.sprint,
        sneak: humanized.sneak,
        targetYaw: humanized.targetYaw,
        targetPitch: humanized.targetPitch
      }
    }

    // --- YAW MANAGEMENT (throttled, not spammed) ---
    const yawDiff = yawDifference(currentYaw, controls.targetYaw)
    const horizDist = Math.sqrt(
      (targetNode.pos.x - currentPos.x) ** 2 +
      (targetNode.pos.z - currentPos.z) ** 2
    )

    // Decrement cooldown
    if (this.lookAtCooldown > 0) this.lookAtCooldown--

    // Decide whether we need a yaw update
    const nodeChanged = this.currentNodeIndex !== this.lastLookNodeIndex
    const significantMisalignment = Math.abs(yawDiff) > 0.25 // ~14 degrees
    const minorMisalignment = Math.abs(yawDiff) > 0.05 // ~3 degrees
    const closeToTarget = horizDist <= 1.5

    // Strategy:
    // 1. New node → call lookAt once for smooth rotation toward next waypoint.
    // 2. Significant misalignment (>14°) and not close → call lookAt (throttled).
    // 3. Close to target (<1.5 blocks) and minor misalignment → snap yaw directly
    //    to prevent circling caused by smooth-rotation overshoot.
    // 4. Otherwise, let the existing lookAt progress finish.
    if (nodeChanged) {
      this.lastLookNodeIndex = this.currentNodeIndex
      this.lookAtCooldown = 0 // allow immediate look
    }

    if (closeToTarget && minorMisalignment && this.bot.setYaw) {
      // Instant snap for fine alignment — prevents circling near goal
      this.bot.setYaw(controls.targetYaw)
    } else if (significantMisalignment && this.lookAtCooldown <= 0) {
      // Smooth lookAt for large reorientations or distant waypoints
      const lookTarget = targetNode.pos.offset(0, 1.6, 0) // look at head height
      this.bot.lookAt(lookTarget, true).catch(() => {})
      this.lookAtCooldown = 5 // wait 5 ticks (250ms) before calling lookAt again
    }

    // --- STATE CLASSIFICATION ---
    const yawAligned = Math.abs(yawDiff) < 0.25
    if (!yawAligned && !controls.forward && !controls.jump && onGround) {
      this.state = ExecutorState.ALIGNING
    } else if (!onGround && currentVel.y < -0.1) {
      this.state = ExecutorState.FALLING
    } else if (controls.jump) {
      this.state = ExecutorState.JUMPING
    } else {
      this.state = ExecutorState.MOVING
    }

    // Apply control states
    this.bot.controlState.forward = controls.forward
    this.bot.controlState.back = controls.back
    this.bot.controlState.left = controls.left
    this.bot.controlState.right = controls.right
    this.bot.controlState.jump = controls.jump
    this.bot.controlState.sprint = controls.sprint
    this.bot.controlState.sneak = controls.sneak
  }

  private succeed (): void {
    this.state = ExecutorState.DONE
    this.cleanup()
    if (this.resolve) {
      this.resolve()
      this.resolve = null
      this.reject = null
    }
  }

  private fail (err: Error): void {
    this.state = ExecutorState.FAILED
    this.cleanup()
    if (this.reject) {
      this.reject(err)
      this.reject = null
      this.resolve = null
    }
  }

  private cleanup (): void {
    if (this.tickHandler) {
      this.bot.removeListener('physicsTick', this.tickHandler)
      this.tickHandler = null
    }
    this.bot.clearControlStates()
  }

  /** Current executor state (for monitoring). */
  getState (): ExecutorState {
    return this.state
  }

  /** Current path index. */
  getCurrentIndex (): number {
    return this.currentNodeIndex
  }

  /** Total path length. */
  getPathLength (): number {
    return this.path.length
  }

  /**
   * Determine whether the transition from `from` to `to` is a parkour edge.
   * Parkour edges are detected by horizontal distance and vertical delta.
   */
  private isParkourEdgeType (from: MovementNode, to: MovementNode): boolean {
    const dx = Math.abs(to.pos.x - from.pos.x)
    const dz = Math.abs(to.pos.z - from.pos.z)
    const dy = to.pos.y - from.pos.y
    const horizDist = Math.max(dx, dz)

    // Sprint-jump gaps (2+ blocks horizontal, same Y or up 1)
    if (horizDist >= 2 && horizDist <= 3 && dy >= 0 && dy <= 1) return true

    // Ladder jumps (1 block horizontal, ±1 Y)
    if (horizDist === 1 && Math.abs(dy) === 1) {
      // Could be ladder or regular jump-up; we treat possible ladder as parkour
      return true
    }

    // Fence vaults (1 block horizontal, same Y, but with height difference implied)
    // Since we don't have block data here, we approximate by checking if the
    // destination is very close horizontally but requires a jump.
    if (horizDist === 1 && dy === 0 && from.onGround && to.onGround) {
      // Could be a fence vault; let resolveParkourMove decide
      return true
    }

    return false
  }

  /**
   * Determine whether the transition from `from` to `to` is a scaffold edge.
   * Scaffold edges are detected by longer horizontal spans (>= 3 blocks)
   * with no vertical change and both nodes on ground.
   * Shorter spans are handled by normal walk or parkour.
   */
  private isScaffoldEdgeType (from: MovementNode, to: MovementNode): boolean {
    const dx = Math.abs(to.pos.x - from.pos.x)
    const dz = Math.abs(to.pos.z - from.pos.z)
    const dy = to.pos.y - from.pos.y
    const horizDist = Math.max(dx, dz)

    // Scaffold bridges: horizontal gap of 3-5 blocks with no vertical change
    // and the destination is at same Y (walkable after placing)
    // Shorter gaps (1-2) are covered by parkour or normal walk.
    if (horizDist >= 3 && horizDist <= 5 && dy === 0 && from.onGround && to.onGround) {
      return true
    }

    return false
  }

  /**
   * Determine whether a scaffold edge is a ninja bridge.
   */
  private isNinjaEdgeType (from: MovementNode, to: MovementNode): boolean {
    const dx = Math.abs(to.pos.x - from.pos.x)
    const dz = Math.abs(to.pos.z - from.pos.z)
    const horizDist = Math.max(dx, dz)
    // Ninja edges are longer gaps (4+) or have sprinting set
    return horizDist >= 4 || to.sprinting
  }

  /**
   * Resolve which parkour move best matches the edge from `from` to `to`.
   */
  private resolveParkourMove (from: MovementNode, to: MovementNode): ParkourMove | null {
    const dx = Math.abs(to.pos.x - from.pos.x)
    const dz = Math.abs(to.pos.z - from.pos.z)
    const dy = to.pos.y - from.pos.y
    const horizDist = Math.round(Math.max(dx, dz))
    const deltaY = Math.round(dy)

    const key = deltaY === 0 ? `gap${horizDist}` : `gap${horizDist}Up${deltaY}`
    if (PARKOUR_MOVES[key]) return PARKOUR_MOVES[key]

    // Fallbacks
    if (horizDist === 1 && deltaY === 0) return PARKOUR_MOVES.gap1
    if (horizDist === 2 && deltaY === 0) return PARKOUR_MOVES.gap2
    if (horizDist === 3 && deltaY === 0) return PARKOUR_MOVES.gap3
    if (horizDist === 2 && deltaY === 1) return PARKOUR_MOVES.gap2Up1
    if (Math.abs(deltaY) === 1 && horizDist <= 1) return deltaY > 0 ? PARKOUR_MOVES.ladderUp : PARKOUR_MOVES.ladderDown

    return null
  }
}
