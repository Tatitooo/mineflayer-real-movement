declare module 'prismarine-physics' {
  import { Vec3 } from 'vec3'

  export class AABB {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number

    constructor (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number)
    clone (): AABB
    floor (): void
    extend (dx: number, dy: number, dz: number): this
    contract (x: number, y: number, z: number): this
    expand (x: number, y: number, z: number): this
    offset (x: number, y: number, z: number): this
    computeOffsetX (other: AABB, offsetX: number): number
    computeOffsetY (other: AABB, offsetY: number): number
    computeOffsetZ (other: AABB, offsetZ: number): number
    intersects (other: AABB): boolean
  }

  export interface ControlState {
    forward: boolean
    back: boolean
    left: boolean
    right: boolean
    jump: boolean
    sprint: boolean
    sneak: boolean
  }

  export interface PlayerStateLike {
    pos: Vec3
    vel: Vec3
    onGround: boolean
    isInWater: boolean
    isInLava: boolean
    isInWeb: boolean
    isCollidedHorizontally: boolean
    isCollidedVertically: boolean
    elytraFlying: boolean
    yaw: number
    pitch: number
    control: ControlState
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    attributes: Record<string, unknown>
    speed: number
    slowness: number
    jumpBoost: number
    dolphinsGrace: number
    slowFalling: number
    levitation: number
    depthStrider: number
    elytraEquipped: boolean
  }

  export interface BotLike {
    version: string
    entity: {
      position: Vec3
      velocity: Vec3
      onGround: boolean
      isInWater: boolean
      isInLava: boolean
      isInWeb: boolean
      isCollidedHorizontally: boolean
      isCollidedVertically: boolean
      elytraFlying: boolean
      yaw: number
      pitch: number
      attributes: Record<string, unknown>
      effects: Array<{ id: number; amplifier: number; duration: number }>
    }
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    inventory: {
      slots: Array<{ name: string; nbt?: unknown } | null>
    }
  }

  export class PlayerState implements PlayerStateLike {
    constructor (bot: BotLike, control: ControlState)
    pos: Vec3
    vel: Vec3
    onGround: boolean
    isInWater: boolean
    isInLava: boolean
    isInWeb: boolean
    isCollidedHorizontally: boolean
    isCollidedVertically: boolean
    elytraFlying: boolean
    yaw: number
    pitch: number
    control: ControlState
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    attributes: Record<string, unknown>
    speed: number
    slowness: number
    jumpBoost: number
    dolphinsGrace: number
    slowFalling: number
    levitation: number
    depthStrider: number
    elytraEquipped: boolean
    apply (bot: BotLike): void
  }

  export interface World {
    getBlock (pos: Vec3): BlockInWorld | null
  }

  export interface BlockInWorld {
    position: Vec3
    type: number
    name: string
    boundingBox: 'block' | 'empty'
    shapes: Array<[number, number, number, number, number, number]>
    metadata?: number
  }

  export interface PhysicsEngine {
    gravity: number
    airdrag: number
    yawSpeed: number
    pitchSpeed: number
    playerSpeed: number
    sprintSpeed: number
    sneakSpeed: number
    stepHeight: number
    negligeableVelocity: number
    soulsandSpeed: number
    honeyblockSpeed: number
    honeyblockJumpSpeed: number
    ladderMaxSpeed: number
    ladderClimbSpeed: number
    playerHalfWidth: number
    playerHeight: number
    waterInertia: number
    lavaInertia: number
    liquidAcceleration: number
    airborneInertia: number
    airborneAcceleration: number
    defaultSlipperiness: number
    outOfLiquidImpulse: number
    autojumpCooldown: number

    simulatePlayer (state: PlayerStateLike, world: World): PlayerStateLike
    getPlayerBB (pos: Vec3): AABB
    moveEntity (entity: PlayerStateLike, world: World, dx: number, dy: number, dz: number): void
    adjustPositionHeight (pos: Vec3): void
  }

  export function Physics (mcData: unknown, world: World): PhysicsEngine
}
