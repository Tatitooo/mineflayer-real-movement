/**
 * Demo: PvP Strafing + Combo Execution
 *
 * Prerequisites:
 *   1. Start a local Minecraft server with PvP enabled
 *   2. Have a second player (or another bot) standing near spawn
 *   3. Run: bun run scripts/demo-pvp.ts
 *
 * The bot will orbit the nearest player, execute W-taps and crit jumps,
 * and report strafe pattern + attack timing metrics.
 */

import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import type { DemoScenario } from '../src/demo/demo-runner'
import { DEFAULT_STRAFE_OPTIONS } from '../src/movement/pvp-strafing'

const pvpScenario: DemoScenario = {
  name: 'PvP 1v1 Strafing',
  run: async (bot, plugin, collector) => {
    await new Promise(r => setTimeout(r, 1000))

    // Find nearest player
    const players = Object.values(bot.players)
    const targetPlayer = players.find(p => p.entity && p.username !== bot.username)
    if (!targetPlayer || !targetPlayer.entity) {
      throw new Error('No target player found on server')
    }

    console.log(`[PvP] Target acquired: ${targetPlayer.username}`)

    // Start strafing around target
    plugin.strafe.start(
      { position: targetPlayer.entity.position, onGround: true, health: 20 },
      { ...DEFAULT_STRAFE_OPTIONS, preferredRange: 3, orbitSpeed: 0.12 }
    )

    // Queue combo moves every ~1.5 seconds for 10 seconds
    const comboInterval = setInterval(() => {
      plugin.combo.queue('wTap')
      setTimeout(() => plugin.combo.queue('critJump'), 200)
    }, 1500)

    await new Promise(r => setTimeout(r, 10000))

    clearInterval(comboInterval)
    plugin.strafe.stop()
    plugin.combo.reset()

    console.log(`[PvP] Demo complete. Final strafe pattern: ${plugin.strafe.getPattern()}`)
  }
}

runDemo(pvpScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'PvPBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: {
      enabled: true,
      seed: 54321,
      jitter: {
        yawJitterDeg: 1.2,
        pitchJitterDeg: 0.6
      }
    }
  }
}).catch(err => {
  console.error('PvP demo failed:', err)
  process.exit(1)
})
