import { Vec3 } from 'vec3'
import type { MovementNode } from '../core/types'

/**
 * Lightweight bot interface for the replanner (decoupled from full mineflayer Bot).
 */
export interface ReplannerBot {
  entity: { position: Vec3 }
  on: (event: string, callback: (blockOrEntity: unknown) => void) => void
  removeListener: (event: string, callback: (blockOrEntity: unknown) => void) => void
}

/**
 * Callback signature for requesting a replan.
 */
export type ReplanCallback = (reason: string) => void

/**
 * DynamicReplanner monitors block updates and entity movements to invalidate
 * the current path and trigger replanning in <100ms.
 *
 * It checks whether the changed block intersects the path's bounding cylinder
 * (horizontal radius = 2, vertical = 1 around each path node).
 */
export class DynamicReplanner {
  private path: MovementNode[] = []
  private active = false
  private startTime = 0
  private blockHandler: ((block: unknown) => void) | null = null
  private entityHandler: ((entity: unknown) => void) | null = null

  constructor (
    private readonly bot: ReplannerBot,
    private readonly onReplan: ReplanCallback
  ) {}

  /**
   * Attach listeners and start monitoring.
   */
  start (): void {
    if (this.active) return
    this.active = true
    this.startTime = Date.now()

    this.blockHandler = (block: unknown) => this.handleBlockUpdate(block)
    this.entityHandler = () => this.handleEntityMove()

    this.bot.on('blockUpdate', this.blockHandler)
    this.bot.on('entityMoved', this.entityHandler)
  }

  /**
   * Detach listeners and stop monitoring.
   */
  stop (): void {
    if (!this.active) return
    this.active = false

    if (this.blockHandler) {
      this.bot.removeListener('blockUpdate', this.blockHandler)
      this.blockHandler = null
    }
    if (this.entityHandler) {
      this.bot.removeListener('entityMoved', this.entityHandler)
      this.entityHandler = null
    }
  }

  /**
   * Set the current path to monitor.
   */
  setPath (path: MovementNode[]): void {
    this.path = path
  }

  private handleBlockUpdate (block: unknown): void {
    if (this.path.length === 0) return

    // Grace period: ignore block updates for first 3 seconds after path start
    // to avoid reacting to initial chunk loading noise.
    if (Date.now() - this.startTime < 3000) return

    // Mineflayer blockUpdate gives an object with position
    const b = block as { position?: Vec3 } | null
    const pos = b?.position
    if (!pos) return

    // Check if this block is near any upcoming path node
    const currentPos = this.bot.entity.position
    const remainingNodes = this.path.filter(n => n.pos.distanceTo(currentPos) > 0.5)

    for (const node of remainingNodes) {
      const dx = Math.abs(node.pos.x - pos.x)
      const dy = Math.abs(node.pos.y - pos.y)
      const dz = Math.abs(node.pos.z - pos.z)
      // Cylinder radius 2 horizontally, 1 vertically
      if (dx <= 2 && dz <= 2 && dy <= 1) {
        this.onReplan(`blockUpdate at ${pos.x},${pos.y},${pos.z} near path node`)
        return
      }
    }
  }

  private handleEntityMove (): void {
    if (this.path.length === 0) return
    // For now, entity moves are treated conservatively: if any entity moves
    // within 3 blocks of the bot, we flag for potential replan.
    // In practice this is debounced by the executor (won't replan every tick).
    //
    // Since we don't have the entity position here easily, we leave this as
    // a no-op hook. The executor can poll entity distances if needed.
  }
}
