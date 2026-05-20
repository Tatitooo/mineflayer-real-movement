/**
 * Demo: Parkour Map Navigation
 *
 * Prerequisites:
 *   1. Start a local Minecraft server (Paper/Spigot vanilla) on localhost:25565
 *   2. Build a simple parkour course near spawn (gaps 1-3 blocks, ladders, fences)
 *   3. Run: bun run scripts/demo-parkour.ts
 *
 * The bot will spawn, navigate the parkour using real-movement parkour edges,
 * and print timing + distance metrics.
 */

import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import type { DemoScenario } from '../src/demo/demo-runner'
import { GoalBlock } from '../src/pathfinding/goals'

const parkourScenario: DemoScenario = {
  name: 'Parkour Map',
  run: async (bot, plugin, collector) => {
    // Wait a moment for world to load
    await new Promise(r => setTimeout(r, 1000))

    // Find nearest solid block below bot to define start
    const start = bot.entity.position.clone()
    const goal = new Vec3(start.x + 30, start.y + 5, start.z)

    console.log(`[Parkour] Start: ${start.floored().toString()}  Goal: ${goal.floored().toString()}`)

    // Attempt path to goal (bot will use parkour edges automatically)
    await plugin.goto(new GoalBlock(goal, 1.5))

    console.log(`[Parkour] Reached goal at ${bot.entity.position.floored().toString()}`)
  }
}

runDemo(parkourScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'ParkourBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: {
      enabled: true,
      seed: 12345,
      jitter: {
        yawJitterDeg: 0.8,
        pitchJitterDeg: 0.4
      }
    }
  }
}).catch(err => {
  console.error('Parkour demo failed:', err)
  process.exit(1)
})
