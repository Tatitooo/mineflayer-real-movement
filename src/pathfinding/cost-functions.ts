import { Vec3 } from 'vec3'
import type { MovementNode, ControlInputs } from '../core/types'
import type { PhysicsPredictor, SimulationResult } from '../core/physics-predictor'

/**
 * Compute the cost of an edge using physics simulation when available,
 * falling back to a heuristic when the predictor is absent or simulation fails.
 *
 * The cost is expressed in **predicted ticks** (vanilla 20 TPS), which makes
 * the A* search time-optimal rather than distance-optimal.
 */
export function computeEdgeCost (
  from: MovementNode,
  toPos: Vec3,
  controls: ControlInputs,
  predictor: PhysicsPredictor | undefined
): { cost: number; predictedTicks: number; simulation?: SimulationResult } {
  if (predictor != null) {
    const sim = predictor.simulateEdge(from, controls, toPos, {
      maxSimulationTicks: 60,
      arrivalThreshold: 0.4
    })
    if (sim.arrived) {
      // Normalize cost to ~1 per block so heuristic (distance) remains admissible
      const normalizedCost = Math.max(0.5, sim.predictedTicks / 12)
      return { cost: normalizedCost, predictedTicks: sim.predictedTicks, simulation: sim }
    }
    // If simulation didn't arrive, still use its tick count as a penalty cost
    const normalizedPenalty = Math.max(1, sim.predictedTicks / 12) * 2
    return { cost: normalizedPenalty, predictedTicks: sim.predictedTicks, simulation: sim }
  }

  // Fallback heuristic: Euclidean distance scaled by speed
  const dist = from.pos.distanceTo(toPos)
  const speed = controls.sprint ? 5.6 : (controls.forward ? 4.3 : 0)
  let predictedTicks: number
  if (speed > 0) {
    predictedTicks = Math.ceil((dist / speed) * 20) + (controls.jump ? 4 : 0)
  } else {
    predictedTicks = Math.ceil(dist * 5) // arbitrary slow penalty
  }

  return { cost: predictedTicks, predictedTicks }
}

/**
 * Adjust cost based on dangerous blocks (lava, soul sand, cobweb) or
 * beneficial blocks (ice, slime, bubble column).
 */
export function applyBlockModifierCost (
  baseCost: number,
  blockUnder: string | null,
  blockAtFeet: string | null
): number {
  // Danger penalties
  if (blockAtFeet === 'lava' || blockAtFeet === 'flowing_lava') return baseCost + 40
  if (blockAtFeet === 'cobweb' || blockAtFeet === 'web') return baseCost + 20

  // Surface modifiers
  if (blockUnder === 'soul_sand') return baseCost * 2.5 // 0.4x speed
  if (blockUnder === 'honey_block' || blockUnder === 'honey') return baseCost * 3.0

  // Speed bonuses (ice momentum handled by predictor velocity; this is static bonus)
  if (blockUnder === 'ice' || blockUnder === 'packed_ice' || blockUnder === 'blue_ice') {
    return baseCost * 0.7 // ice is fast once moving
  }

  return baseCost
}
