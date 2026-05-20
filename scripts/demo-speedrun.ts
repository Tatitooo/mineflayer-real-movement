/**
 * Demo: Speedrun-Style Navigation
 *
 * Prerequisites:
 *   1. Start a local Minecraft server
 *   2. Build a straight 100-block course with minor elevation changes and a 2-block gap
 *   3. Run: bun run scripts/demo-speedrun.ts
 *
 * The bot will navigate from spawn to a far goal as fast as possible,
 * using sprint, sprint-jumps, and momentum-aware pathfinding.
 */

import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import type { DemoScenario } from '../src/demo/demo-runner'
import { GoalBlock } from '../src/pathfinding/goals'

const speedrunScenario: DemoScenario = {
  name: 'Speedrun Navigation',
  run: async (bot, plugin, collector) => {
    await new Promise(r => setTimeout(r, 1000))

    const start = bot.entity.position.clone()
    const goal = new Vec3(start.x + 100, start.y + 2, start.z)

    console.log(`[Speedrun] Start: ${start.floored().toString()}  Goal: ${goal.floored().toString()}`)

    // Enable sprint immediately for maximum speed
    bot.setControlState('sprint', true)

    const t0 = Date.now()
    await plugin.goto(new GoalBlock(goal, 1.5))
    const t1 = Date.now()

    const duration = t1 - t0
    const distance = start.distanceTo(bot.entity.position)
    const speed = distance / (duration / 1000)

    console.log(`[Speedrun] Finished in ${duration}ms (${(duration / 1000).toFixed(2)}s)`)
    console.log(`[Speedrun] Distance: ${distance.toFixed(1)} blocks  Avg speed: ${speed.toFixed(2)} blocks/s`)
  }
}

runDemo(speedrunScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'SpeedrunBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: {
      enabled: false,
      seed: 0
    }
  }
}).catch(err => {
  console.error('Speedrun demo failed:', err)
  process.exit(1)
})
