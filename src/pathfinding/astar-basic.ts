import { Vec3 } from 'vec3'
import type { MovementNode, MovementEdge, PathGoal, PathResult, CollisionWorld } from '../core/types'
import { generateBasicEdges } from './edge-generators'
import { WorldCollisionService } from '../core/world-collision-service'
import type { PhysicsPredictor } from '../core/physics-predictor'

interface AStarEntry {
  node: MovementNode
  g: number
  f: number
  parent: AStarEntry | null
  edge: MovementEdge | null
}

/**
 * Basic A* pathfinder for 3D voxel environments.
 *
 * Nodes include position, velocity, and ground state. Edges are generated
 * from a node using `generateBasicEdges`, which validates each candidate
 * with SweptAABBValidator (walk / drop / gap) or custom feasibility checks
 * (jump-up).
 *
 * When a `PhysicsPredictor` is provided, edge costs are computed by simulating
 * the movement with prismarine-physics, yielding real tick costs and exit
 * velocities that feed into the next edge (momentum chaining).
 */
export class AStarPathfinder {
  constructor (
    private readonly world: CollisionWorld,
    private readonly collisionService: WorldCollisionService,
    private readonly predictor?: PhysicsPredictor
  ) {}

  async findPath (start: Vec3, goal: PathGoal, maxIterations = 10000, maxSearchDistance?: number): Promise<PathResult> {
    const startNode: MovementNode = {
      pos: start,
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }

    const open = new Map<string, AStarEntry>()
    const closed = new Set<string>()

    const startKey = this.key(startNode)
    const startEntry: AStarEntry = {
      node: startNode,
      g: 0,
      f: goal.heuristic(start),
      parent: null,
      edge: null
    }
    open.set(startKey, startEntry)

    let iterations = 0
    const maxDistSq = maxSearchDistance != null ? maxSearchDistance * maxSearchDistance : Infinity

    while (open.size > 0 && iterations < maxIterations) {
      iterations++

      // Yield to event loop every 100 iterations to prevent blocking
      if (iterations % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve))
      }

      let bestKey = ''
      let bestF = Infinity
      open.forEach((v, k) => {
        if (v.f < bestF) {
          bestF = v.f
          bestKey = k
        }
      })

      const current = open.get(bestKey)
      if (!current) break

      open.delete(bestKey)
      closed.add(bestKey)

      if (goal.isEnd(current.node.pos)) {
        return this.reconstructPath(current)
      }

      // Safety bound: reject nodes too far from start in open-world scenarios
      if (maxDistSq !== Infinity) {
        const dx = current.node.pos.x - start.x
        const dy = current.node.pos.y - start.y
        const dz = current.node.pos.z - start.z
        if (dx * dx + dy * dy + dz * dz > maxDistSq) continue
      }

      const edges = generateBasicEdges(current.node, this.world, this.collisionService, this.predictor)
      for (const edge of edges) {
        const neighbor = edge.to
        const nKey = this.key(neighbor)
        if (closed.has(nKey)) continue

        // Skip neighbors beyond maxSearchDistance
        if (maxDistSq !== Infinity) {
          const ndx = neighbor.pos.x - start.x
          const ndy = neighbor.pos.y - start.y
          const ndz = neighbor.pos.z - start.z
          if (ndx * ndx + ndy * ndy + ndz * ndz > maxDistSq) continue
        }

        const g = current.g + edge.cost
        const existing = open.get(nKey)
        if (!existing || g < existing.g) {
          const f = g + goal.heuristic(neighbor.pos)
          open.set(nKey, {
            node: neighbor,
            g,
            f,
            parent: current,
            edge
          })
        }
      }
    }

    return { path: [], cost: 0, status: iterations >= maxIterations ? 'timeout' : 'noPath' }
  }

  private key (node: MovementNode): string {
    const x = Math.round(node.pos.x * 10) / 10
    const y = Math.round(node.pos.y * 10) / 10
    const z = Math.round(node.pos.z * 10) / 10
    return `${x},${y},${z}`
  }

  private reconstructPath (end: AStarEntry): PathResult {
    const path: MovementNode[] = []
    let cur: AStarEntry | null = end
    while (cur) {
      path.unshift(cur.node)
      cur = cur.parent
    }
    return { path, cost: end.g, status: 'success' }
  }
}
