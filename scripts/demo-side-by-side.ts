/**
 * Demo: Side-by-Side Comparison — Vanilla Pathfinder vs Real-Movement
 *
 * Prerequisites:
 *   1. Start a local Minecraft server
 *   2. Build an obstacle course: flat 50 blocks, then a 2-block gap, then a hill
 *   3. Run: bun run scripts/demo-side-by-side.ts
 *
 * Two bots connect:
 *   - VanillaBot: uses vanilla mineflayer-pathfinder (if installed)
 *   - RealBot: uses mineflayer-real-movement
 *
 * Both navigate the same course. Metrics are printed side-by-side.
 */

import { createBot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { realMovementPlugin } from '../src/plugin'
import { MetricsCollector, formatMetricsReport } from '../src/demo/metrics-collector'

const HOST = process.env.MC_HOST ?? 'localhost'
const PORT = Number(process.env.MC_PORT ?? 25565)
const VERSION = process.env.MC_VERSION ?? '1.20.4'

async function spawnBot (username: string, loadPlugin: boolean): Promise<{ bot: any; metrics: MetricsCollector }> {
  const bot = createBot({ host: HOST, port: PORT, username, version: VERSION })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spawn timeout')), 30000)
    bot.once('spawn', () => { clearTimeout(timeout); resolve() })
    bot.once('error', (err: Error) => { clearTimeout(timeout); reject(err) })
  })

  if (loadPlugin) {
    bot.loadPlugin((b: any) => realMovementPlugin(b))
  }

  const collector = new MetricsCollector()
  bot.on('physicsTick', () => {
    collector.recordTick(
      bot.entity.position.clone(),
      bot.entity.velocity.clone(),
      bot.entity.onGround,
      { ...bot.controlState }
    )
  })

  return { bot, metrics: collector }
}

async function runComparison (): Promise<void> {
  const goal = new Vec3(50, 70, 0)

  // Spawn both bots
  const vanilla = await spawnBot('VanillaBot', false)
  const real = await spawnBot('RealBot', true)

  // Wait for world
  await new Promise(r => setTimeout(r, 1500))

  // Position bots at same start
  const start = vanilla.bot.entity.position.clone()

  console.log(`\n[SIDE-BY-SIDE] Start: ${start.floored().toString()}  Goal: ${goal.floored().toString()}`)

  // Real-movement bot path
  const realStart = Date.now()
  try {
    await real.bot.realMovement.goto({ position: goal, isEnd: (pos: Vec3) => pos.distanceTo(goal) < 1.5 })
  } catch (e) {
    console.log('[RealBot] Path failed:', (e as Error).message)
  }
  const realEnd = Date.now()

  // Vanilla bot path (if mineflayer-pathfinder is available)
  let vanillaEnd = realEnd
  try {
    const pathfinder = require('mineflayer-pathfinder')
    vanilla.bot.loadPlugin(pathfinder.pathfinder)
    const { GoalBlock } = pathfinder.goals
    const vanillaStart = Date.now()
    await new Promise<void>((resolve, reject) => {
      vanilla.bot.pathfinder.setGoal(new GoalBlock(goal.x, goal.y, goal.z))
      const check = setInterval(() => {
        if (vanilla.bot.entity.position.distanceTo(goal) < 1.5) {
          clearInterval(check)
          resolve()
        }
      }, 250)
      setTimeout(() => { clearInterval(check); reject(new Error('Vanilla timeout')) }, 60000)
    })
    vanillaEnd = Date.now()
  } catch (e) {
    console.log('[VanillaBot] Pathfinder not available or failed:', (e as Error).message)
  }

  // Build metrics
  const realMetrics = real.metrics.buildMetrics('Real-Movement', true, undefined, 0)
  realMetrics.durationMs = realEnd - realStart
  const vanillaMetrics = vanilla.metrics.buildMetrics('Vanilla-Pathfinder', true, undefined, 0)
  vanillaMetrics.durationMs = vanillaEnd - realStart

  console.log(formatMetricsReport(realMetrics))
  console.log(formatMetricsReport(vanillaMetrics))

  vanilla.bot.quit()
  real.bot.quit()
}

runComparison().catch(err => {
  console.error('Side-by-side demo failed:', err)
  process.exit(1)
})
