import { Vec3 } from 'vec3'
import type { MovementNode, MovementEdge, MovementEdgeType, ControlInputs, CollisionWorld } from '../core/types'
import { SweptAABBValidator } from '../core/swept-aabb-validator'
import { WorldCollisionService } from '../core/world-collision-service'
import { canSwimTo } from '../movement/swim-navigator'
import { generateParkourEdges } from '../movement/parkour-executor'
import { generateScaffoldEdges } from '../movement/scaffold-extension'
import { computeEdgeCost } from './cost-functions'
import { generateMomentumEdges } from './momentum-edges'
import type { PhysicsPredictor } from '../core/physics-predictor'

const CARDINALS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1]
]

const DIAGONALS: Array<[number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1]
]

/**
 * Generate basic movement edges from a node: walk, jump-up, drop-down, gap-jump, swim, and scaffold.
 * Edges are validated against the world using SweptAABBValidator or custom feasibility checks.
 *
 * When `predictor` is provided, edge costs are computed via physics simulation
 * (predicted ticks + exit velocity). Otherwise a heuristic cost is used.
 */
export function generateBasicEdges (
  node: MovementNode,
  world: CollisionWorld,
  collisionService: WorldCollisionService,
  predictor?: PhysicsPredictor
): MovementEdge[] {
  const validator = new SweptAABBValidator(world, collisionService)
  const edges: MovementEdge[] = []

  for (const [dx, dz] of CARDINALS) {
    // Walk same Y
    addEdgeIfValid(node, dx, 0, dz,
      { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false },
      1.0, world, validator, edges, predictor)

    // Jump up 1 block
    addJumpUpEdgeIfValid(node, dx, dz, world, collisionService, edges, predictor)

    // Drop down 1 block
    addEdgeIfValid(node, dx, -1, dz,
      { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false },
      1.2, world, validator, edges, predictor)

    // Gap 1 (jump across a 1-block pit)
    addEdgeIfValid(node, dx * 2, 0, dz * 2,
      { forward: true, sprint: true, jump: true, back: false, left: false, right: false, sneak: false },
      2.0, world, validator, edges, predictor)

    // Swim edges (if in or entering water)
    addSwimEdgeIfValid(node, dx, 0, dz, world, edges)
    addSwimEdgeIfValid(node, dx, 1, dz, world, edges) // swim up
    addSwimEdgeIfValid(node, dx, -1, dz, world, edges) // swim down
  }

  // Diagonal walk edges (cost sqrt(2) ≈ 1.414)
  for (const [dx, dz] of DIAGONALS) {
    const adjX = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z)))
    const adjZ = world.getBlock(new Vec3(Math.floor(node.pos.x), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))
    const corner = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))

    const adjXEmpty = !adjX || adjX.boundingBox === 'empty'
    const adjZEmpty = !adjZ || adjZ.boundingBox === 'empty'
    const cornerEmpty = !corner || corner.boundingBox === 'empty'

    if ((adjXEmpty || adjZEmpty) && cornerEmpty) {
      addEdgeIfValid(node, dx, 0, dz,
        { forward: true, sprint: false, jump: false, back: false, left: false, right: false, sneak: false },
        1.414, world, validator, edges, predictor)
    }
  }

  // Diagonal sprint edges (1.3x multiplier, only when on ground)
  if (node.onGround) {
    for (const [dx, dz] of DIAGONALS) {
      const adjX = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z)))
      const adjZ = world.getBlock(new Vec3(Math.floor(node.pos.x), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))
      const corner = world.getBlock(new Vec3(Math.floor(node.pos.x + dx), Math.floor(node.pos.y), Math.floor(node.pos.z + dz)))

      const adjXEmpty = !adjX || adjX.boundingBox === 'empty'
      const adjZEmpty = !adjZ || adjZ.boundingBox === 'empty'
      const cornerEmpty = !corner || corner.boundingBox === 'empty'

      if ((adjXEmpty || adjZEmpty) && cornerEmpty) {
        const controls = {
          forward: true, sprint: true, jump: false,
          back: false, left: dx < 0, right: dx > 0, sneak: false
        }
        addEdgeIfValid(node, dx, 0, dz, controls, 1.1, world, validator, edges, predictor, 'sprint')
      }
    }
  }

  // Parkour edges (sprint-jump gaps, ladder jumps, fence vaults)
  const parkourEdges = generateParkourEdges(node, world)
  edges.push(...parkourEdges)

  // Scaffold edges (speed bridge / ninja bridge across gaps)
  const scaffoldEdges = generateScaffoldEdges(node, world)
  edges.push(...scaffoldEdges)

  // Momentum edges (long gaps, diagonal sprint with velocity)
  const momentumEdges = generateMomentumEdges(node, world, collisionService, predictor)
  edges.push(...momentumEdges)

  return edges
}

function addEdgeIfValid (
  from: MovementNode,
  dx: number,
  dy: number,
  dz: number,
  controlInputs: ControlInputs,
  _fallbackCost: number,
  world: CollisionWorld,
  validator: SweptAABBValidator,
  edges: MovementEdge[],
  predictor?: PhysicsPredictor,
  edgeType?: MovementEdgeType
): void {
  const targetPos = new Vec3(from.pos.x + dx, from.pos.y + dy, from.pos.z + dz)
  const result = validator.validate(from.pos, targetPos, { onGround: from.onGround })
  if (!result.valid) return

  const { cost, predictedTicks, simulation } = computeEdgeCost(from, targetPos, controlInputs, predictor)

  const toNode: MovementNode = {
    pos: result.finalPos,
    vel: simulation?.exitVel ?? new Vec3(0, 0, 0),
    onGround: isGrounded(result.finalPos, world),
    sprinting: controlInputs.sprint
  }

  edges.push({
    from,
    to: toNode,
    cost,
    predictedTicks,
    controlInputs,
    type: edgeType
  })
}

function addJumpUpEdgeIfValid (
  from: MovementNode,
  dx: number,
  dz: number,
  world: CollisionWorld,
  _collisionService: WorldCollisionService,
  edges: MovementEdge[],
  predictor?: PhysicsPredictor
): void {
  if (!from.onGround) return

  const groundY = Math.floor(from.pos.y - 0.001)
  const destX = Math.floor(from.pos.x + dx)
  const destZ = Math.floor(from.pos.z + dz)
  const destGroundY = groundY + 1

  // Destination ground must be solid
  const destGround = world.getBlock(new Vec3(destX, destGroundY, destZ))
  if (!destGround || destGround.boundingBox === 'empty') return

  // Must have 2 blocks of air above destination ground for player height (1.8)
  const destAir1 = world.getBlock(new Vec3(destX, destGroundY + 1, destZ))
  const destAir2 = world.getBlock(new Vec3(destX, destGroundY + 2, destZ))
  if ((destAir1 && destAir1.boundingBox !== 'empty') || (destAir2 && destAir2.boundingBox !== 'empty')) return

  const destPos = new Vec3(destX, destGroundY + 1, destZ)
  const controls = { forward: true, sprint: false, jump: true, back: false, left: false, right: false, sneak: false }
  const { cost, predictedTicks, simulation } = computeEdgeCost(from, destPos, controls, predictor)

  const toNode: MovementNode = {
    pos: destPos,
    vel: simulation?.exitVel ?? new Vec3(0, 0, 0),
    onGround: true,
    sprinting: false
  }

  edges.push({
    from,
    to: toNode,
    cost,
    predictedTicks,
    controlInputs: controls,
    type: 'jumpUp'
  })
}

function isGrounded (pos: Vec3, world: CollisionWorld): boolean {
  const groundY = Math.floor(pos.y - 0.001)
  const block = world.getBlock(new Vec3(Math.floor(pos.x), groundY, Math.floor(pos.z)))
  return block != null && block.boundingBox !== 'empty'
}

function addSwimEdgeIfValid (
  from: MovementNode,
  dx: number,
  dy: number,
  dz: number,
  world: CollisionWorld,
  edges: MovementEdge[]
): void {
  const targetPos = new Vec3(from.pos.x + dx, from.pos.y + dy, from.pos.z + dz)
  const swimCheck = canSwimTo(world, from.pos, targetPos)
  if (!swimCheck.valid) return

  const toNode: MovementNode = {
    pos: targetPos,
    vel: new Vec3(0, 0, 0),
    onGround: false,
    sprinting: false
  }

  edges.push({
    from,
    to: toNode,
    cost: 1.8, // slower than walking
    predictedTicks: 10,
    controlInputs: {
      forward: true, sprint: true, jump: dy > 0, sneak: dy < 0,
      back: false, left: false, right: false
    },
    type: 'swim'
  })
}
