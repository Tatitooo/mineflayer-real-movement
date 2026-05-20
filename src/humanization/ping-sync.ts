/**
 * Ping synchronization and server TPS alignment.
 *
 * Anti-cheats detect bots that run at a perfectly regular 20 TPS while
 * the server is lagging (e.g., 18 TPS). Humans naturally jitter their
 * packet timing to match perceived server responsiveness.
 *
 * This module:
 * - Estimates server TPS from keep-alive round-trip times
 * - Computes ping-aware packet delays
 * - Introduces burst-then-rest timing patterns
 * - Jitters tick-aligned sends to avoid robotic regularity
 */

import { gaussian, clamp } from './noise-generators'

export interface PingSyncOptions {
  /** Measured ping in milliseconds. */
  pingMs: number
  /** Target server TPS (default 20). */
  targetTps?: number
  /** Estimated actual server TPS (e.g., 18.5). */
  estimatedTps?: number
  /** Max extra jitter per packet in ms. @default 12 */
  maxJitterMs?: number
  /** Base interval between action bursts in ticks. @default 30 */
  burstIntervalTicks?: number
  /** Duration of a burst in ticks. @default 6 */
  burstDurationTicks?: number
}

export interface TickTiming {
  /** Delay before executing the next action (ms). */
  delayMs: number
  /** Whether this tick is part of a "burst" of rapid actions. */
  isBurst: boolean
  /** Recommended interval until next packet send (ms). */
  sendIntervalMs: number
}

const MS_PER_TICK = 50

/**
 * Estimate server TPS from a window of tick durations.
 * Call this every tick with the time since last tick.
 *
 * @param tickDurationsMs Array of recent tick durations
 * @returns Estimated TPS
 */
export function estimateTps (tickDurationsMs: number[]): number {
  if (tickDurationsMs.length === 0) return 20.0
  // Use median to ignore outliers
  const sorted = [...tickDurationsMs].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median <= 0) return 20.0
  return clamp(1000 / median, 5, 40)
}

/**
 * Compute ping-aware delay and send timing for a packet/action.
 *
 * @param tick Current tick count
 * @param options Ping sync configuration
 * @param rng Random source
 * @returns Timing recommendation
 */
export function computeTickTiming (
  tick: number,
  options: PingSyncOptions,
  rng: () => number = Math.random
): TickTiming {
  const targetTps = options.targetTps ?? 20.0
  const estimatedTps = options.estimatedTps ?? targetTps
  const maxJitterMs = options.maxJitterMs ?? 12
  const burstIntervalTicks = options.burstIntervalTicks ?? 30
  const burstDurationTicks = options.burstDurationTicks ?? 6

  // If server is lagging, slow down our sends slightly to match
  const tpsRatio = targetTps / estimatedTps
  const baseDelayMs = options.pingMs * 0.5

  // Gaussian jitter so packets don't arrive at mathematically perfect intervals
  const jitterMs = gaussian(0, maxJitterMs * 0.5, rng)

  // Burst detection: humans act in short bursts then rest
  const cyclePos = tick % burstIntervalTicks
  const isBurst = cyclePos < burstDurationTicks

  // During bursts, compress timing slightly; during rest, stretch it
  const burstMultiplier = isBurst ? 0.7 : 1.15

  // If server TPS is lower than target, add extra delay
  const tpsDelayMs = tpsRatio > 1.05 ? (tpsRatio - 1) * 30 : 0

  const delayMs = clamp(
    Math.round(baseDelayMs + jitterMs + tpsDelayMs) * burstMultiplier,
    0,
    800
  )

  const sendIntervalMs = clamp(
    MS_PER_TICK * tpsRatio + jitterMs,
    30,
    120
  )

  return { delayMs, isBurst, sendIntervalMs }
}

/**
 * Stateful ping tracker that maintains a sliding window of tick durations
 * and computes running TPS / ping estimates.
 */
export class PingTracker {
  private readonly tickDurations: number[] = []
  private lastTickTime = 0
  private readonly windowSize: number

  /** Current smoothed ping estimate. */
  smoothedPingMs = 50
  /** Current TPS estimate. */
  estimatedTps = 20.0

  constructor (windowSize: number = 20) {
    this.windowSize = windowSize
  }

  /**
   * Record the time of a new tick.
   * @param nowMs Current time in milliseconds (e.g., performance.now())
   */
  recordTick (nowMs: number): void {
    if (this.lastTickTime > 0) {
      const duration = nowMs - this.lastTickTime
      this.tickDurations.push(duration)
      if (this.tickDurations.length > this.windowSize) {
        this.tickDurations.shift()
      }
      this.estimatedTps = estimateTps(this.tickDurations)
      // Rough ping estimate: half the round-trip spread
      const spread = Math.max(...this.tickDurations) - Math.min(...this.tickDurations)
      this.smoothedPingMs = clamp(spread * 0.5 + 20, 20, 500)
    }
    this.lastTickTime = nowMs
  }

  /** Reset all tracking state. */
  reset (): void {
    this.tickDurations.length = 0
    this.lastTickTime = 0
    this.smoothedPingMs = 50
    this.estimatedTps = 20.0
  }
}
