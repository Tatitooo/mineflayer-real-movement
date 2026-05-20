import { Vec3 } from 'vec3'
import { runDemo } from '../src/demo/demo-runner'
import { GoalBlock } from '../src/pathfinding/goals'

const walkScenario = {
  name: 'Flat Ground Walk',
  run: async (bot: any, plugin: any, collector: any) => {
    await new Promise(r => setTimeout(r, 500))
    const start = bot.entity.position.clone()
    const goal = new Vec3(start.x + 10, start.y, start.z)
    console.log(`[Walk] Start: ${start.floored().toString()} Goal: ${goal.floored().toString()}`)
    await plugin.goto(new GoalBlock(goal, 1.5))
    console.log(`[Walk] Reached goal at ${bot.entity.position.floored().toString()}`)
  }
}

runDemo(walkScenario, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USER ?? 'WalkBot',
  version: process.env.MC_VERSION ?? '1.20.4',
  realMovement: {
    humanization: { enabled: false, seed: 1 }
  }
}).catch(err => {
  console.error('Walk test failed:', err)
  process.exit(1)
})
