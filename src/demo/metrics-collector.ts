import { Vec3 } from 'vec3'

/**
 * A single position sample captured during demo execution.
 */
export interface PositionSample {
  tick: number
  pos: Vec3
  vel: Vec3
  onGround: boolean
  controlState: Record<string, boolean>
}

/**
 * Humanization metrics captured per tick.
 */
export interface HumanizationSample {
  tick: number
  yawJitter: number
  pitchJitter: number
  reactionDelayMs: number
  wasdRelease: boolean
}

/**
 * Aggregated metrics for a demo run.
 */
export interface DemoMetrics {
  scenario: string
  startTime: number
  endTime: number
  durationMs: number
  success: boolean
  failureReason?: string
  pathLengthNodes: number
  distanceTraveled: number
  avgSpeed: number
  maxSpeed: number
  minSpeed: number
  groundTimePct: number
  airTimePct: number
  controlChanges: number
  positionSamples: number
  humanizationSamples?: HumanizationSample[]
}

/**
 * Collects metrics during a demo scenario execution.
 * Non-invasive: samples bot state every N ticks without modifying behavior.
 */
export class MetricsCollector {
  private samples: PositionSample[] = []
  private humanizationSamples: HumanizationSample[] = []
  private tickCount = 0
  private lastPos: Vec3 | null = null
  private totalDistance = 0
  private groundTicks = 0
  private controlChangeCount = 0
  private lastControls: Record<string, boolean> = {}
  private readonly sampleInterval: number

  constructor (options?: { sampleInterval?: number }) {
    this.sampleInterval = options?.sampleInterval ?? 5
  }

  /**
   * Record a tick of bot state. Call from the bot's physicsTick handler.
   */
  recordTick (
    pos: Vec3,
    vel: Vec3,
    onGround: boolean,
    controlState: Record<string, boolean>,
    humanization?: { yawJitter?: number; pitchJitter?: number; reactionDelayMs?: number; wasdRelease?: boolean }
  ): void {
    this.tickCount++

    if (this.lastPos) {
      this.totalDistance += this.lastPos.distanceTo(pos)
    }
    this.lastPos = pos.clone()

    if (onGround) this.groundTicks++

    // Count control state changes (ignore first tick since lastControls starts empty)
    if (this.tickCount > 1) {
      for (const key of Object.keys(controlState)) {
        if (this.lastControls[key] !== controlState[key]) {
          this.controlChangeCount++
        }
      }
    }
    this.lastControls = { ...controlState }

    // Sampling
    if (this.tickCount % this.sampleInterval === 0) {
      this.samples.push({
        tick: this.tickCount,
        pos: pos.clone(),
        vel: vel.clone(),
        onGround,
        controlState: { ...controlState }
      })

      if (humanization) {
        this.humanizationSamples.push({
          tick: this.tickCount,
          yawJitter: humanization.yawJitter ?? 0,
          pitchJitter: humanization.pitchJitter ?? 0,
          reactionDelayMs: humanization.reactionDelayMs ?? 0,
          wasdRelease: humanization.wasdRelease ?? false
        })
      }
    }
  }

  /**
   * Build final metrics object after the scenario completes.
   */
  buildMetrics (scenario: string, success: boolean, failureReason?: string, pathLengthNodes = 0): DemoMetrics {
    const speeds = this.samples.map(s => Math.sqrt(s.vel.x ** 2 + s.vel.z ** 2))
    const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
    const minSpeed = speeds.length > 0 ? Math.min(...speeds) : 0

    return {
      scenario,
      startTime: 0, // caller should patch
      endTime: 0,   // caller should patch
      durationMs: 0, // caller should patch
      success,
      failureReason,
      pathLengthNodes,
      distanceTraveled: this.totalDistance,
      avgSpeed,
      maxSpeed,
      minSpeed,
      groundTimePct: this.tickCount > 0 ? this.groundTicks / this.tickCount : 0,
      airTimePct: this.tickCount > 0 ? 1 - this.groundTicks / this.tickCount : 0,
      controlChanges: this.controlChangeCount,
      positionSamples: this.samples.length,
      humanizationSamples: this.humanizationSamples.length > 0 ? this.humanizationSamples : undefined
    }
  }

  reset (): void {
    this.samples = []
    this.humanizationSamples = []
    this.tickCount = 0
    this.lastPos = null
    this.totalDistance = 0
    this.groundTicks = 0
    this.controlChangeCount = 0
    this.lastControls = {}
  }
}

/**
 * Format metrics as a human-readable report string.
 */
export function formatMetricsReport (m: DemoMetrics): string {
  const lines: string[] = []
  lines.push(`\n╔════════════════════════════════════════════════════════════╗`)
  lines.push(`║  DEMO RESULTS: ${m.scenario.padEnd(42)}║`)
  lines.push(`╠════════════════════════════════════════════════════════════╣`)
  lines.push(`║  Success        : ${(m.success ? 'YES ✓' : 'NO ✗').padEnd(41)}║`)
  if (m.failureReason) lines.push(`║  Failure Reason : ${m.failureReason.padEnd(41)}║`)
  lines.push(`║  Duration       : ${(m.durationMs.toFixed(1) + ' ms').padEnd(41)}║`)
  lines.push(`║  Path Nodes     : ${(String(m.pathLengthNodes)).padEnd(41)}║`)
  lines.push(`║  Distance       : ${(m.distanceTraveled.toFixed(2) + ' blocks').padEnd(41)}║`)
  lines.push(`║  Avg Speed      : ${(m.avgSpeed.toFixed(2) + ' b/t').padEnd(41)}║`)
  lines.push(`║  Max Speed      : ${(m.maxSpeed.toFixed(2) + ' b/t').padEnd(41)}║`)
  lines.push(`║  Ground Time    : ${((m.groundTimePct * 100).toFixed(1) + '%').padEnd(41)}║`)
  lines.push(`║  Air Time       : ${((m.airTimePct * 100).toFixed(1) + '%').padEnd(41)}║`)
  lines.push(`║  Control Changes: ${(String(m.controlChanges)).padEnd(41)}║`)
  lines.push(`║  Samples        : ${(String(m.positionSamples)).padEnd(41)}║`)
  if (m.humanizationSamples) {
    lines.push(`║  Humanization   : ${(String(m.humanizationSamples.length) + ' samples').padEnd(41)}║`)
  }
  lines.push(`╚════════════════════════════════════════════════════════════╝`)
  return lines.join('\n')
}

/**
 * Export metrics as JSON for downstream processing (video graphs, etc.)
 */
export function metricsToJson (m: DemoMetrics): string {
  return JSON.stringify(m, null, 2)
}
