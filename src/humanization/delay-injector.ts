/**
 * Reaction delay injector.
 *
 * Human reaction times follow a Gaussian distribution with:
 * - Simple reaction: mean ~200ms, σ ~30ms
 * - Choice reaction: mean ~320ms, σ ~50ms
 *
 * The injector computes per-event delays that are:
 * - Ping-aware: delay scales with measured latency
 * - Probabilistically missed: small stimuli ignored ~10% of the time
 * - Context-dependent: movement delays < combat delays < inventory delays
 */

import { gaussian, clamp } from './noise-generators'

export interface DelayOptions {
  /** Base reaction delay in milliseconds. */
  baseDelayMs: number
  /** Standard deviation of the Gaussian jitter. */
  stdDevMs: number
  /** Current ping in milliseconds (measured via keep-alive). */
  pingMs: number
  /** Scale factor applied to ping (0..1). @default 0.5 */
  pingScale?: number
  /** Probability [0..1] of ignoring a minor stimulus. @default 0.1 */
  missProbability?: number
}

export interface DelayResult {
  /** Total delay in milliseconds (base + Gaussian jitter + ping compensation). */
  delayMs: number
  /** Whether this stimulus should be ignored (simulates human inattention). */
  missed: boolean
}

const DEFAULT_PING_SCALE = 0.5
const DEFAULT_MISS_PROBABILITY = 0.1

/**
 * Compute a human-like reaction delay for a stimulus.
 *
 * @param options Delay configuration
 * @param rng Optional random source (for deterministic tests)
 * @returns Delay result with `delayMs` and `missed` flag
 */
export function computeReactionDelay (
  options: DelayOptions,
  rng: () => number = Math.random
): DelayResult {
  const pingScale = options.pingScale ?? DEFAULT_PING_SCALE
  const missProbability = options.missProbability ?? DEFAULT_MISS_PROBABILITY

  // Decide if we "miss" this stimulus (human inattention)
  const missed = rng() < missProbability

  // Gaussian jitter around the base delay
  const jitteredBase = gaussian(options.baseDelayMs, options.stdDevMs, rng)

  // Ping-aware compensation: humans react slower when lag is higher
  const pingCompensation = options.pingMs * pingScale

  // Total delay, clamped to reasonable bounds
  const delayMs = clamp(Math.round(jitteredBase + pingCompensation), 50, 2000)

  return { delayMs, missed }
}

/**
 * Pre-configured delay presets for different contexts.
 */
export const DelayPresets = {
  /** Moving / pathing reaction (small obstacle appears). */
  movement: (pingMs: number): DelayOptions => ({
    baseDelayMs: 150,
    stdDevMs: 25,
    pingMs,
    pingScale: 0.3,
    missProbability: 0.15
  }),

  /** Combat reaction (enemy moves, attack window). */
  combat: (pingMs: number): DelayOptions => ({
    baseDelayMs: 220,
    stdDevMs: 40,
    pingMs,
    pingScale: 0.5,
    missProbability: 0.05
  }),

  /** Inventory interaction (slot click, item move). */
  inventory: (pingMs: number): DelayOptions => ({
    baseDelayMs: 280,
    stdDevMs: 60,
    pingMs,
    pingScale: 0.4,
    missProbability: 0.08
  }),

  /** Block placement / breaking (bridging, mining). */
  blockInteraction: (pingMs: number): DelayOptions => ({
    baseDelayMs: 200,
    stdDevMs: 50,
    pingMs,
    pingScale: 0.35,
    missProbability: 0.12
  })
} as const

/**
 * Stateful delay tracker for a sequence of events.
 * Ensures delays don't stack unrealistically and introduces
 * occasional "bursts" (quick reactions) followed by "rest" (slow ones).
 */
export class DelayTracker {
  private lastReactionTick = -9999

  constructor (
    private readonly rng: () => number = Math.random
  ) {}

  /**
   * Compute delay for an event occurring at `currentTick`.
   * Introduces burst/rest cycles: after a fast reaction, next reactions
   * may be slower; after a slow reaction, next may be faster.
   */
  compute (
    currentTick: number,
    options: DelayOptions
  ): DelayResult {
    const base = computeReactionDelay(options, this.rng)

    // Convert ms to ticks (20 TPS)
    // tick delay would be Math.ceil(base.delayMs / 50)

    // Burst mode: if we reacted very recently, we might be "in the zone"
    const ticksSinceLast = currentTick - this.lastReactionTick
    if (ticksSinceLast < 4) {
      // Fast successive reactions — reduce delay by 30%
      base.delayMs = Math.round(base.delayMs * 0.7)
    } else if (ticksSinceLast > 40) {
      // Long pause — slightly slower ("waking up")
      base.delayMs = Math.round(base.delayMs * 1.15)
    }

    this.lastReactionTick = currentTick
    return base
  }

  /** Reset burst state. */
  reset (): void {
    this.lastReactionTick = -9999
  }
}
