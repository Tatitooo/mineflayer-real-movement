import { Vec3 } from 'vec3'
import type { MovementNode, MovementEdge, CollisionWorld } from '../core/types'
import { SweptAABBValidator } from '../core/swept-aabb-validator'
import { WorldCollisionService } from '../core/world-collision-service'
import type { PhysicsPredictor } from '../core/physics-predictor'
import { computeEdgeCost } from './cost-functions'

const DIAGONALS: Array<[number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1]
]

/**
 * Generate edges that are only feasible because the bot already has momentum.
 *
 * When the bot's current velocity is high (e.g., sprinting off ice, or exiting
 * a sprint-jump), it can clear gaps of 3-5 blocks that are impossible from a
 * standstill.
 *
 * This function supplements the basic edge generator; it does NOT replace it.
 */
export function generateMomentumEdges (
  node: MovementNode,
  world: CollisionWorld,
  collisionService: WorldCollisionService,
  predictor?: PhysicsPredictor
): MovementEdge[] {
  const edges: MovementEdge[] = []
  const validator = new SweptAABBValidator(world, collisionService)

  const horizVel = Math.sqrt(node.vel.x * node.vel.x + node.vel.z * node.vel.z)
  const onGround = node.onGround

  // --- Diagonal sprint edges (1.3x multiplier) ---
  if (onGround && horizVel > 0.05) {
    for (const [dx, dz] of DIAGONALS) {
      // Diagonal sprint requires clearing both cardinal neighbors + corner
      const adjX = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z)))
      const adjZ = world.getBlock(new Vec3(Math.floor(node.pos.x), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))
      const corner = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))

      const adjXEmpty = !adjX || adjX.boundingBox === 'empty'
      const adjZEmpty = !adjZ || adjZ.boundingBox === 'empty'
      const cornerEmpty = !corner || corner.boundingBox === 'empty'

      if ((adjXEmpty || adjZEmpty) && cornerEmpty) {
        const targetPos = new Vec3(node.pos.x + dx, node.pos.y, node.pos.z + dz)
        const controls = {
          forward: true, right: dx > 0, left: dx < 0,
          back: false, jump: false, sprint: true, sneak: false
        }

        const swept = validator.validate(node.pos, targetPos, { onGround: true })
        if (swept.valid) {
          const { cost, predictedTicks, simulation } = computeEdgeCost(node, targetPos, controls, predictor)

          edges.push({
            from: node,
            to: {
              pos: targetPos,
              vel: simulation?.exitVel ?? new Vec3(0, 0, 0),
              onGround: true,
              sprinting: true
            },
            cost,
            predictedTicks,
            controlInputs: controls,
            type: 'sprint'
          })
        }
      }
    }
  }

  // --- Long-gap edges (3-5 blocks) when velocity is high ---
  if (horizVel > 0.15 && onGround) {
    const cardinalDirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const [dx, dz] of cardinalDirs) {
      const yaw = Math.atan2(-dx, -dz)
      // Only consider directions roughly aligned with current velocity
      const velYaw = Math.atan2(-node.vel.x, -node.vel.z)
      const yawDiff = Math.abs(normalizeAngle(yaw - velYaw))
      if (yawDiff > Math.PI / 4) continue // velocity not aligned with this direction

      // Gap distances based on velocity tier
      const maxGap = horizVel > 0.25 ? 5 : horizVel > 0.18 ? 4 : 3
      for (let gap = 3; gap <= maxGap; gap++) {
        const targetPos = new Vec3(node.pos.x + dx * gap, node.pos.y, node.pos.z + dz * gap)

        // Must have air under the gap and landing ground at the end
        let landingSolid = false
        let allAir = true
        for (let i = 1; i < gap; i++) {
          const mid = new Vec3(Math.floor(node.pos.x + dx * i), Math.floor(node.pos.y), Math.floor(node.pos.z + dz * i))
          const midBlock = world.getBlock(mid)
          if (midBlock && midBlock.boundingBox !== 'empty') allAir = false
        }
        const landing = world.getBlock(new Vec3(Math.floor(targetPos.x), Math.floor(targetPos.y - 0.001), Math.floor(targetPos.z)))
        landingSolid = landing != null && landing.boundingBox !== 'empty'

        if (!allAir || !landingSolid) continue

        // Sprint-jump to clear the gap
        const controls = {
          forward: true, sprint: true, jump: true,
          back: false, left: false, right: false, sneak: false
        }

        const swept = validator.validate(node.pos, targetPos, { onGround: true })
        if (swept.valid) {
          const { cost, predictedTicks, simulation } = computeEdgeCost(node, targetPos, controls, predictor)
          if (simulation?.arrived ?? true) {
            edges.push({
              from: node,
              to: {
                pos: targetPos,
                vel: simulation?.exitVel ?? new Vec3(0, 0, 0),
                onGround: true,
                sprinting: true
              },
              cost,
              predictedTicks,
              controlInputs: controls,
              type: gap === 3 ? 'gap3' : gap === 4 ? 'gap3' : 'gap3' // map to existing types
            })
          }
        }
      }
    }
  }

  return edges
}

function normalizeAngle (angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI
  while (angle < -Math.PI) angle += 2 * Math.PI
  return Math.abs(angle)
}
