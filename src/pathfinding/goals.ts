import { Vec3 } from 'vec3'
import type { PathGoal } from '../core/types'

/**
 * Goal that requires reaching a specific block position (within optional radius).
 */
export class GoalBlock implements PathGoal {
  constructor (private readonly target: Vec3, private readonly radius = 0) {}

  isEnd (pos: Vec3): boolean {
    return (
      Math.abs(pos.x - this.target.x) <= this.radius &&
      Math.abs(pos.y - this.target.y) <= this.radius &&
      Math.abs(pos.z - this.target.z) <= this.radius
    )
  }

  heuristic (pos: Vec3): number {
    return pos.distanceTo(this.target)
  }
}

/**
 * Goal that requires being within a Euclidean distance of the target.
 */
export class GoalNear implements PathGoal {
  constructor (private readonly target: Vec3, private readonly radius: number) {}

  isEnd (pos: Vec3): boolean {
    return pos.distanceTo(this.target) <= this.radius
  }

  heuristic (pos: Vec3): number {
    return Math.max(0, pos.distanceTo(this.target) - this.radius)
  }
}
