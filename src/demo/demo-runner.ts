import { createBot, type Bot } from 'mineflayer'
import { realMovementPlugin, type RealMovementPlugin } from '../plugin'
import type { RealMovementPluginOptions } from '../plugin'
import { MetricsCollector, type DemoMetrics, formatMetricsReport } from './metrics-collector'

export interface DemoRunnerOptions {
  host?: string
  port?: number
  username?: string
  version?: string
  realMovement?: RealMovementPluginOptions
  autoDisconnect?: boolean
}

export interface DemoScenario {
  name: string
  run: (bot: Bot, plugin: RealMovementPlugin, collector: MetricsCollector) => Promise<void>
}

/**
 * DemoRunner manages bot lifecycle, plugin loading, metric collection,
 * and result reporting for a single demo scenario.
 */
export class DemoRunner {
  private bot: Bot | null = null
  private metricsCollector = new MetricsCollector()
  private tickHandler: (() => void) | null = null
  private results: DemoMetrics[] = []

  constructor (private readonly options: DemoRunnerOptions = {}) {}

  /**
   * Connect to a Minecraft server and load the realMovement plugin.
   */
  async connect (): Promise<Bot> {
    const bot = createBot({
      host: this.options.host ?? 'localhost',
      port: this.options.port ?? 25565,
      username: this.options.username ?? `DemoBot_${Math.floor(Math.random() * 10000)}`,
      version: this.options.version ?? '1.20.4'
    })

    // Wait for spawn
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Spawn timeout')), 30000)
      bot.once('spawn', () => {
        clearTimeout(timeout)
        resolve()
      })
      bot.once('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // Load plugin
    bot.loadPlugin((b: Bot) => realMovementPlugin(b, this.options.realMovement))

    // Wire metrics collector to physicsTick
    this.tickHandler = () => {
      this.metricsCollector.recordTick(
        bot.entity.position.clone(),
        bot.entity.velocity.clone(),
        bot.entity.onGround,
        { ...bot.controlState }
      )
    }
    bot.on('physicsTick', this.tickHandler)

    this.bot = bot
    return bot
  }

  /**
   * Execute a demo scenario. Returns metrics.
   */
  async runScenario (scenario: DemoScenario): Promise<DemoMetrics> {
    if (!this.bot) throw new Error('Not connected. Call connect() first.')

    this.metricsCollector.reset()
    const startTime = Date.now()
    let success = false
    let failureReason: string | undefined
    let pathLength = 0

    try {
      const plugin = (this.bot as any).realMovement
      if (!plugin) throw new Error('realMovement plugin not loaded')

      await scenario.run(this.bot, plugin, this.metricsCollector)
      success = true

      // Attempt to read path length from last goto if available
      if (plugin.findPath && this.bot.entity) {
        // No direct path length from execution; scenarios can pass it via custom logic
      }
    } catch (err) {
      success = false
      failureReason = err instanceof Error ? err.message : String(err)
    }

    const endTime = Date.now()
    const metrics = this.metricsCollector.buildMetrics(scenario.name, success, failureReason, pathLength)
    metrics.startTime = startTime
    metrics.endTime = endTime
    metrics.durationMs = endTime - startTime
    this.results.push(metrics)
    return metrics
  }

  /**
   * Disconnect from the server.
   */
  disconnect (): void {
    if (this.bot && this.tickHandler) {
      this.bot.removeListener('physicsTick', this.tickHandler)
      this.tickHandler = null
    }
    if (this.bot && this.options.autoDisconnect !== false) {
      this.bot.quit()
    }
    this.bot = null
  }

  /**
   * Get all results from this session.
   */
  getResults (): DemoMetrics[] {
    return [...this.results]
  }

  /**
   * Print a formatted report of all results to console.
   */
  printReport (): void {
    for (const r of this.results) {
      console.log(formatMetricsReport(r))
    }
  }

  /**
   * Export all results as JSON string.
   */
  exportJson (): string {
    return JSON.stringify(this.results, null, 2)
  }
}

/**
 * Convenience: run a single scenario with minimal boilerplate.
 */
export async function runDemo (
  scenario: DemoScenario,
  options?: DemoRunnerOptions
): Promise<DemoMetrics> {
  const runner = new DemoRunner(options)
  await runner.connect()
  const metrics = await runner.runScenario(scenario)
  runner.printReport()
  runner.disconnect()
  return metrics
}
