/**
 * Demo: Escape Chase
 *
 * Prerequisites:
 *   1. Start a local Minecraft server
 *   2. Build a varied terrain with hills, trees, and a safe house 50-100 blocks away
 *   3. Have a "pursuer" player chase the bot (or simulate by standing between bot and goal)
 *   4. Run: bun run scripts/demo-escape.ts
 *
 * The bot will detect the pursuer, pick a safe location, and navigate there
 * using sprint, parkour, and knockback recovery if hit.
 */

import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import type { DemoScenario } from '../src/demo/demo-runner'
import { GoalBlock } from '../src/pathfinding/goals'

const escapeScenario: DemoScenario = {
  name: 'Escape Chase',
  run: async (bot, plugin, collector) => {
    await new Promise(r => setTimeout(r, 1000))

    const start = bot.entity.position.clone()
    // Goal: 60 blocks away, elevated for dramatic escape
    const goal = new Vec3(start.x + 60, start.y + 10, start.z + 20)

    console.log(`[Escape] Start: ${start.floored().toString()}  Safe house: ${goal.floored().toString()}`)

    // If pursuer is nearby, log it (detection would be via entity tracking in real use)
    const nearby = Object.values(bot.entities).filter(e =>
      e.type === 'player' && e.id !== bot.entity.id && e.position.distanceTo(start) < 10
    )
    if (nearby.length > 0) {
      console.log(`[Escape] ${nearby.length} pursuer(s) detected within 10 blocks`)
    }

    await plugin.goto(new GoalBlock(goal, 2))

    console.log(`[Escape] Reached safe house at ${bot.entity.position.floored().toString()}`)
  }
}

runDemo(escapeScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'EscapeBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: {
      enabled: true,
      seed: 99999,
      jitter: {
        yawJitterDeg: 0.5,
        pitchJitterDeg: 0.3
      }
    }
  }
}).catch(err => {
  console.error('Escape demo failed:', err)
  process.exit(1)
})
