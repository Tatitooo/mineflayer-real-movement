import { Vec3 } from 'vec3'
import { ElytraExecutor } from './src/movement/elytra-controller'

const makeNode = (x: number, y: number, z: number, onGround = false, vy = 0) => ({
  pos: new Vec3(x, y, z),
  vel: new Vec3(0, vy, 0),
  onGround,
  sprinting: false
})

const executor = new ElytraExecutor()
executor.start(20)
const node = makeNode(0, 50, 0, false, -0.5)
executor.tick(node, new Vec3(100, 10, 0), 20, true)
console.log('After first tick:', executor.getPhase())

const closeNode = makeNode(90, 15, 0, false, -0.5)
executor.tick(closeNode, new Vec3(100, 10, 0), 5, true)
console.log('After close tick:', executor.getPhase())

const landingNode = makeNode(98, 11, 0, true, 0)
const result = executor.tick(landingNode, new Vec3(100, 10, 0), 2, false)
console.log('After landing tick:', executor.getPhase(), 'isLanded:', executor.isLanded())
console.log('Result controls:', JSON.stringify(result))
