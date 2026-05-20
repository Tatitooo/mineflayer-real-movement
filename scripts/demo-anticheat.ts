/**
 * Demo: Passive Anti-Cheat Test
 *
 * Prerequisites:
 *   1. Start a local server with GrimAC or Vulcan installed (or any public test server)
 *   2. Run: bun run scripts/demo-anticheat.ts
 *
 * The bot connects with humanization enabled and performs varied movements:
 *   - Walking / sprinting on flat ground
 *   - Jumping over gaps
 *   - Turning with Perlin-noise jitter
 *   - Random pauses (burst-then-rest)
 *
 * It listens for kick/disconnect events and reports survival time + detection flags.
 */

import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import type { DemoScenario } from '../src/demo/demo-runner'
import { GoalBlock } from '../src/pathfinding/goals'

const antiCheatScenario: DemoScenario = {
  name: 'Anti-Cheat Passive Test',
  run: async (bot, plugin, collector) => {
    await new Promise(r => setTimeout(r, 2000))

    const start = bot.entity.position.clone()
    let kicked = false
    let kickReason = ''

    bot.on('kicked', (reason: string) => {
      kicked = true
      kickReason = reason
      console.log(`[AntiCheat] KICKED: ${reason}`)
    })

    bot.on('end', () => {
      if (!kicked) console.log('[AntiCheat] Connection ended (possibly detected)')
    })

    // Phase 1: Walk around spawn area (30s)
    console.log('[AntiCheat] Phase 1: Walking loops')
    for (let i = 0; i < 3; i++) {
      if (kicked) break
      const target = new Vec3(start.x + (i % 2 === 0 ? 20 : -20), start.y, start.z + (i * 5))
      try {
        await plugin.goto(new GoalBlock(target, 1.5))
      } catch { /* ignore path errors */ }
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000))
    }

    // Phase 2: Jump across a small gap (if available)
    if (!kicked) {
      console.log('[AntiCheat] Phase 2: Sprint + jump')
      const jumpTarget = new Vec3(start.x + 10, start.y, start.z)
      try {
        await plugin.goto(new GoalBlock(jumpTarget, 1.5))
      } catch { /* ignore */ }
    }

    // Phase 3: Idle with micro-movements (15s)
    if (!kicked) {
      console.log('[AntiCheat] Phase 3: Idle micro-movements')
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
      for (let t = 0; t < 150; t++) {
        if (kicked) break
        bot.entity.yaw += (Math.random() - 0.5) * 0.1
        await new Promise(r => setTimeout(r, 100))
      }
    }

    if (kicked) {
      throw new Error(`Detected by anti-cheat: ${kickReason}`)
    }

    console.log('[AntiCheat] Survival complete — no kick detected')
  }
}

runDemo(antiCheatScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'HumanLikeBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: {
      enabled: true,
      seed: 11111,
      jitter: {
        yawJitterDeg: 1.0,
        pitchJitterDeg: 0.5
      }
    }
  }
}).catch(err => {
  console.error('Anti-cheat demo failed:', err)
  process.exit(1)
})
