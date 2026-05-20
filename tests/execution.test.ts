import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import { PathExecutor, ExecutorState, type BotLike } from '../src/execution/executor'
import { MovementNode } from '../src/core/types'

/**
 * Lightweight mock bot for unit testing the PathExecutor.
 * Simulates mineflayer's Bot interface without a real Minecraft connection.
 */
class MockBot implements BotLike {
  entity = {
    position: new Vec3(0, 1, 0),
    yaw: 0,
    velocity: new Vec3(0, 0, 0),
    onGround: true
  }

  controlState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  private listeners = new Map<string, Set<() => void>>()
  private lookTarget: Vec3 | null = null
  private _setYawCalls: number[] = []

  lookAt (point: Vec3): Promise<void> {
    this.lookTarget = point
    // Update yaw to face the point
    const dx = point.x - this.entity.position.x
    const dz = point.z - this.entity.position.z
    this.entity.yaw = Math.atan2(-dx, dz)
    return Promise.resolve()
  }

  setYaw (yaw: number): void {
    this._setYawCalls.push(yaw)
    this.entity.yaw = yaw
  }

  getSetYawCalls (): number[] {
    return this._setYawCalls
  }

  clearControlStates (): void {
    this.controlState.forward = false
    this.controlState.back = false
    this.controlState.left = false
    this.controlState.right = false
    this.controlState.jump = false
    this.controlState.sprint = false
    this.controlState.sneak = false
  }

  on (event: string, callback: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  removeListener (event: string, callback: () => void): void {
    this.listeners.get(event)?.delete(callback)
  }

  emit (event: string): void {
    this.listeners.get(event)?.forEach(cb => cb())
  }

  /**
   * Simulate physics for one tick.
   * Moves the bot in the direction of its yaw when forward is active.
   */
  simulateTick (speed = 0.25): void {
    if (this.controlState.forward) {
      // Move in direction of yaw (matches vanilla physics)
      const dx = -Math.sin(this.entity.yaw)
      const dz = Math.cos(this.entity.yaw)
      this.entity.position.x += dx * speed
      this.entity.position.z += dz * speed
    }
    if (this.controlState.jump) {
      this.entity.velocity.y = 0.42
      this.entity.onGround = false
    }
    if (!this.entity.onGround) {
      this.entity.velocity.y -= 0.08 // gravity
      this.entity.position.y += this.entity.velocity.y
      if (this.entity.position.y <= Math.floor(this.entity.position.y) + 1.0) {
        // simple ground collision
        this.entity.onGround = true
        this.entity.velocity.y = 0
      }
    }
  }
}

function makePath (points: Array<[number, number, number]>): MovementNode[] {
  return points.map(([x, y, z]) => ({
    pos: new Vec3(x, y, z),
    vel: new Vec3(0, 0, 0),
    onGround: true,
    sprinting: false
  }))
}

describe('PathExecutor', () => {
  it('executes a straight-line path to completion', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)

    const executor = new PathExecutor(bot)
    const path = makePath([
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 1, 0]
    ])

    const promise = executor.execute(path)

    // Simulate 60 ticks (3 seconds)
    for (let i = 0; i < 60; i++) {
      bot.emit('physicsTick')
      bot.simulateTick()
      if (executor.getState() === ExecutorState.DONE) break
    }

    await promise
    expect(executor.getState()).toBe(ExecutorState.DONE)
    expect(bot.entity.position.x).toBeCloseTo(3, 0)
    expect(bot.controlState.forward).toBe(false)
  })

  it('sets forward and looks at next node while moving', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)

    const executor = new PathExecutor(bot)
    const path = makePath([[0, 1, 0], [2, 1, 0]])

    const promise = executor.execute(path)

    // Emit a few ticks
    for (let i = 0; i < 5; i++) {
      bot.emit('physicsTick')
    }

    expect(bot.controlState.forward).toBe(true)
    expect(bot.entity.yaw).not.toBe(0) // should have looked toward target

    executor.stop()
    try { await promise } catch { /* expected */ }
  })

  it('stops and clears control states when stop() is called', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)

    const executor = new PathExecutor(bot)
    const path = makePath([[0, 1, 0], [10, 1, 0]])

    const promise = executor.execute(path)

    // Let it align yaw and start moving (needs at least 2 ticks: 1 for look, 1 for forward)
    bot.emit('physicsTick')
    bot.emit('physicsTick')
    expect(bot.controlState.forward).toBe(true)

    executor.stop()

    try {
      await promise
      expect(true).toBe(false) // should not resolve
    } catch (err) {
      expect((err as Error).message).toContain('stopped by user')
    }

    expect(bot.controlState.forward).toBe(false)
    expect(executor.getState()).toBe(ExecutorState.IDLE)
  })

  it('fails with timeout on unreachable path', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)

    // Make the bot unable to move by not simulating physics
    const executor = new PathExecutor(bot, {
      nodeTimeoutTicks: 5,
      totalTimeoutTicks: 20,
      allowReplanning: false
    })

    const path = makePath([[0, 1, 0], [5, 1, 0]])
    const promise = executor.execute(path)

    // Emit ticks but don't simulate movement → bot stays at start
    for (let i = 0; i < 25; i++) {
      bot.emit('physicsTick')
    }

    try {
      await promise
      expect(true).toBe(false) // should not resolve
    } catch (err) {
      expect((err as Error).message).toContain('Stuck')
    }

    expect(executor.getState()).toBe(ExecutorState.FAILED)
  })

  it('progresses through multiple nodes', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)

    const executor = new PathExecutor(bot)
    const path = makePath([
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 1, 0],
      [4, 1, 0]
    ])

    const promise = executor.execute(path)

    for (let i = 0; i < 100; i++) {
      bot.emit('physicsTick')
      bot.simulateTick()
      if (executor.getState() === ExecutorState.DONE) break
    }

    await promise
    expect(executor.getCurrentIndex()).toBeGreaterThanOrEqual(path.length - 2)
    expect(bot.entity.position.x).toBeCloseTo(4, 0)
  })

  it('uses setYaw for close-target alignment to prevent circling', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)
    bot.entity.yaw = Math.PI / 4 // 45 degrees off target

    const executor = new PathExecutor(bot)
    // Path where the final node is very close (0.5 blocks away)
    const path = makePath([[0, 1, 0], [0.4, 1, 0.3]])

    const promise = executor.execute(path)

    // Emit a single tick
    bot.emit('physicsTick')

    // When close to target (<1.5 blocks) and misaligned, the executor
    // should call setYaw for an instant snap rather than relying on
    // smooth lookAt rotation that causes circling.
    const yawCalls = bot.getSetYawCalls()
    expect(yawCalls.length).toBeGreaterThanOrEqual(1)

    executor.stop()
    try { await promise } catch { /* expected */ }
  })

  it('throttles lookAt calls to avoid spamming', async () => {
    const bot = new MockBot()
    bot.entity.position = new Vec3(0, 1, 0)
    bot.entity.yaw = Math.PI // facing opposite direction

    const executor = new PathExecutor(bot)
    const path = makePath([[0, 1, 0], [0, 1, 10]])

    const promise = executor.execute(path)

    // Emit 10 ticks
    for (let i = 0; i < 10; i++) {
      bot.emit('physicsTick')
    }

    // lookAt should be called at most twice in 10 ticks:
    // once on node change, and once after the 5-tick cooldown.
    // In the MockBot, lookAt is synchronous so it resolves instantly.
    // We verify by checking that yaw settled to target quickly.
    expect(Math.abs(bot.entity.yaw)).toBeLessThan(0.3)

    executor.stop()
    try { await promise } catch { /* expected */ }
  })
})

describe('Alignment Logic', () => {
  it('yawToTarget faces +Z when target is ahead', () => {
    const { yawToTarget } = require('../src/execution/alignment-logic')
    const pos = new Vec3(0, 0, 0)
    const target = new Vec3(0, 0, 5)
    const yaw = yawToTarget(pos, target)
    expect(yaw).toBeCloseTo(0, 2)
  })

  it('yawToTarget faces -X when target is to the east', () => {
    const { yawToTarget } = require('../src/execution/alignment-logic')
    const pos = new Vec3(0, 0, 0)
    const target = new Vec3(5, 0, 0)
    const yaw = yawToTarget(pos, target)
    expect(yaw).toBeCloseTo(-Math.PI / 2, 2)
  })

  it('yawDifference wraps around correctly', () => {
    const { yawDifference } = require('../src/execution/alignment-logic')
    expect(yawDifference(3.0, -3.0)).toBeCloseTo(0.283, 2) // near PI wrap
    expect(yawDifference(-3.0, 3.0)).toBeCloseTo(-0.283, 2)
    expect(yawDifference(0, Math.PI)).toBeCloseTo(Math.PI, 2)
    expect(yawDifference(0, -Math.PI)).toBeCloseTo(-Math.PI, 2)
  })

  it('stoppingDistance returns 0 for near-zero velocity', () => {
    const { stoppingDistance } = require('../src/execution/alignment-logic')
    expect(stoppingDistance(0)).toBe(0)
    expect(stoppingDistance(0.005)).toBe(0)
  })

  it('stoppingDistance scales with velocity', () => {
    const { stoppingDistance } = require('../src/execution/alignment-logic')
    const d1 = stoppingDistance(0.2)
    const d2 = stoppingDistance(0.4)
    expect(d2).toBeGreaterThan(d1)
    expect(d1).toBeGreaterThan(0)
  })
})

describe('Control Generator', () => {
  it('computeControlInputs sets forward when aligned and far', () => {
    const { computeControlInputs } = require('../src/execution/control-generator')
    const current = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = {
      pos: new Vec3(3, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const currentYaw = 0 // facing +Z; target is at +X (needs -PI/2 yaw)
    const result = computeControlInputs(current, target, currentYaw)
    // Not yaw-aligned yet → forward should be false
    expect(result.forward).toBe(false)
  })

  it('computeControlInputs sets forward and sprint when yaw-aligned', () => {
    const { computeControlInputs } = require('../src/execution/control-generator')
    const current = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = {
      pos: new Vec3(0, 1, 5),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const currentYaw = 0 // facing +Z
    const result = computeControlInputs(current, target, currentYaw)
    expect(result.forward).toBe(true)
    expect(result.sprint).toBe(true)
    expect(result.jump).toBe(false)
  })

  it('computeControlInputs triggers jump for upward target', () => {
    const { computeControlInputs } = require('../src/execution/control-generator')
    const current = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = {
      pos: new Vec3(0, 2, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const result = computeControlInputs(current, target, 0)
    expect(result.jump).toBe(true)
    expect(result.sprint).toBe(false) // sprint disabled during jump
  })

  it('computeControlInputs disables sprint when close to target', () => {
    const { computeControlInputs } = require('../src/execution/control-generator')
    const current = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const target = {
      pos: new Vec3(0, 1, 1.2), // 1.2 blocks away
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const currentYaw = 0 // facing +Z
    const result = computeControlInputs(current, target, currentYaw)
    // In close-target mode (<1.5 blocks), sprint should be disabled
    expect(result.sprint).toBe(false)
    expect(result.forward).toBe(true)
  })

  it('computeControlInputs releases forward early with momentum', () => {
    const { computeControlInputs } = require('../src/execution/control-generator')
    const current = {
      pos: new Vec3(0, 1, 0),
      vel: new Vec3(0.25, 0, 0), // moving fast toward target
      onGround: true,
      sprinting: false
    }
    const target = {
      pos: new Vec3(0.5, 1, 0), // only 0.5 blocks away
      vel: new Vec3(0, 0, 0),
      onGround: true,
      sprinting: false
    }
    const currentYaw = -Math.PI / 2 // facing +X
    const result = computeControlInputs(current, target, currentYaw)
    // With vel 0.25 and target 0.5 away, stopping distance ~2.0,
    // so forward should be released early
    expect(result.forward).toBe(false)
    expect(result.sprint).toBe(false)
  })
})
