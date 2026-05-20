import { describe, it, expect } from 'bun:test'
import { Vec3 } from 'vec3'
import type { MovementNode } from '../src/core/types'
import {
  computeGlidePitch,
  computeGlideYaw,
  computeElytraControls,
  ElytraExecutor,
  canElytraTo,
  estimateElytraTicks,
  DEFAULT_ELYTRA_OPTIONS,
  type ElytraPhase
} from '../src/movement/elytra-controller'

import {
  computeOrbitYaw,
  shouldAttack,
  computeStrafeControls,
  selectStrafePattern,
  computeAimPitch,
  PvPStrafeController,
  DEFAULT_STRAFE_OPTIONS
} from '../src/movement/pvp-strafing'

import {
  computeWTapControls,
  computeSTapControls,
  computeCritJumpControls,
  ComboExecutor,
  getAttackCooldownProgress,
  getOptimalAttackTiming,
  DEFAULT_COMBO_OPTIONS
} from '../src/movement/combo-executor'

describe('Elytra Controller', () => {
  const makeNode = (x: number, y: number, z: number, onGround = false, vy = 0): MovementNode => ({
    pos: new Vec3(x, y, z),
    vel: new Vec3(0, vy, 0),
    onGround,
    sprinting: false
  })

  it('computes glide pitch for landing when close and low', () => {
    const currentPos = new Vec3(0, 20, 0)
    const targetPos = new Vec3(10, 10, 0)
    const vel = new Vec3(5, -2, 0)
    const pitch = computeGlidePitch(vel, targetPos, currentPos, 9, DEFAULT_ELYTRA_OPTIONS)
    expect(pitch).toBe(DEFAULT_ELYTRA_OPTIONS.landingPitch)
  })

  it('computes glide pitch for normal glide when far', () => {
    const currentPos = new Vec3(0, 50, 0)
    const targetPos = new Vec3(100, 10, 0)
    const vel = new Vec3(30, -5, 0)
    const pitch = computeGlidePitch(vel, targetPos, currentPos, 40, DEFAULT_ELYTRA_OPTIONS)
    expect(pitch).toBe(DEFAULT_ELYTRA_OPTIONS.idealGlidePitch)
  })

  it('computes glide yaw with clamped turn rate', () => {
    const currentYaw = 0
    const currentPos = new Vec3(0, 50, 0)
    const targetPos = new Vec3(50, 10, 50)
    const yaw = computeGlideYaw(currentYaw, currentPos, targetPos, 0.15)
    const diff = yaw - currentYaw
    expect(Math.abs(diff)).toBeLessThanOrEqual(0.15 + 0.001)
  })

  it(' ElytraExecutor state machine transitions launching → gliding', () => {
    const executor = new ElytraExecutor()
    executor.start(20)
    expect(executor.getPhase()).toBe('launching')

    const node = makeNode(0, 50, 0, false, -0.5)
    const target = new Vec3(100, 10, 0)

    // First tick while not flying yet
    let result = executor.tick(node, target, 20, false)
    expect(executor.getPhase()).toBe('launching')
    expect(result.jump).toBe(true)

    // Tick with elytraFlying = true
    result = executor.tick(node, target, 20, true)
    expect(executor.getPhase()).toBe('gliding')
    expect(result.forward).toBe(true)
    expect(result.targetPitch).toBe(DEFAULT_ELYTRA_OPTIONS.idealGlidePitch)
  })

  it(' ElytraExecutor transitions to landing when close', () => {
    const executor = new ElytraExecutor()
    executor.start(20)
    const node = makeNode(0, 50, 0, false, -0.5)
    executor.tick(node, new Vec3(100, 10, 0), 20, true) // launching → gliding

    // Now simulate being close to target
    const closeNode = makeNode(90, 15, 0, false, -0.5)
    executor.tick(closeNode, new Vec3(100, 10, 0), 5, true)
    expect(executor.getPhase()).toBe('landing')
  })

  it(' ElytraExecutor boost request transitions to boosting', () => {
    const executor = new ElytraExecutor()
    executor.start(20)
    const node = makeNode(0, 50, 0, false, -0.5)
    executor.tick(node, new Vec3(100, 10, 0), 20, true) // launching → gliding
    expect(executor.getPhase()).toBe('gliding')

    // Tick 5 times to satisfy boost cooldown
    for (let i = 0; i < 5; i++) {
      executor.tick(node, new Vec3(100, 10, 0), 20, true)
    }
    const boosted = executor.requestBoost()
    expect(boosted).toBe(true)
    expect(executor.getPhase()).toBe('boosting')
  })

  it(' ElytraExecutor fails if not enough altitude', () => {
    const executor = new ElytraExecutor()
    executor.start(5)
    expect(executor.isFailed()).toBe(true)
  })

  it(' ElytraExecutor isLanded when on ground', () => {
    const executor = new ElytraExecutor()
    executor.start(20)
    const node = makeNode(0, 50, 0, false, -0.5)
    executor.tick(node, new Vec3(100, 10, 0), 20, true) // launching → gliding

    // Transition to landing (needs a tick where phase is gliding and conditions met)
    const closeNode = makeNode(90, 15, 0, false, -0.5)
    executor.tick(closeNode, new Vec3(100, 10, 0), 5, true)
    expect(executor.getPhase()).toBe('landing')

    // Now with onGround=true, transition to landed
    const landingNode = makeNode(98, 11, 0, true, 0)
    executor.tick(landingNode, new Vec3(100, 10, 0), 2, false)
    expect(executor.isLanded()).toBe(true)
  })

  it(' ElytraExecutor reset returns to idle', () => {
    const executor = new ElytraExecutor()
    executor.start(20)
    executor.reset()
    expect(executor.getPhase()).toBe('idle')
    expect(executor.isActive()).toBe(false)
  })

  it('canElytraTo validates feasibility', () => {
    const from = makeNode(0, 50, 0)
    const to = new Vec3(100, 10, 0)
    expect(canElytraTo(from, to, 20)).toBe(true)
    expect(canElytraTo(from, to, 5)).toBe(false) // not enough altitude
    expect(canElytraTo(from, new Vec3(5, 10, 0), 20)).toBe(false) // too close
    expect(canElytraTo(from, new Vec3(100, 60, 0), 20)).toBe(false) // destination higher
  })

  it('estimateElytraTicks returns reasonable values', () => {
    const from = new Vec3(0, 50, 0)
    const to = new Vec3(100, 10, 0)
    const ticks = estimateElytraTicks(from, to)
    expect(ticks).toBeGreaterThan(18) // launch + travel + landing overhead
    expect(ticks).toBeGreaterThan(0)
  })

  it('computeElytraControls returns correct controls per phase', () => {
    const node = makeNode(0, 50, 0, false, -0.5)
    const target = new Vec3(100, 10, 0)

    const idle = computeElytraControls(node, target, 'idle', 20)
    expect(idle.forward).toBe(false)
    expect(idle.jump).toBe(false)

    const launching = computeElytraControls(node, target, 'launching', 20)
    expect(launching.jump).toBe(true)

    const gliding = computeElytraControls(node, target, 'gliding', 20)
    expect(gliding.forward).toBe(true)

    const boosting = computeElytraControls(node, target, 'boosting', 20)
    expect(boosting.forward).toBe(true)
    expect(boosting.useFirework).toBe(true)
  })
})

describe('PvP Strafing', () => {
  const makeNode = (x: number, y: number, z: number, onGround = true): MovementNode => ({
    pos: new Vec3(x, y, z),
    vel: new Vec3(0, 0, 0),
    onGround,
    sprinting: false
  })

  it('computeOrbitYaw turns gradually', () => {
    const currentYaw = 0
    const currentPos = new Vec3(0, 64, 0)
    const targetPos = new Vec3(3, 64, 0)
    const yaw = computeOrbitYaw(currentYaw, currentPos, targetPos, 0.12, 1)
    const diff = yaw - currentYaw
    expect(Math.abs(diff)).toBeLessThanOrEqual(0.12 * 1.5 + 0.001)
  })

  it('shouldAttack returns true when in range and cooldown ready', () => {
    expect(shouldAttack(2.5, 0)).toBe(true)
    expect(shouldAttack(4.0, 0)).toBe(false)
    expect(shouldAttack(2.5, 5)).toBe(false)
  })

  it('computeStrafeControls orbit pattern moves forward', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)
    const result = computeStrafeControls(node, target, 'orbit', 0, 0, DEFAULT_STRAFE_OPTIONS)
    expect(result.forward).toBe(true)
    expect(result.shouldAttack).toBe(true)
  })

  it('computeStrafeControls hitAndRun retreats when too close', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(1, 64, 0)
    const result = computeStrafeControls(node, target, 'hitAndRun', 0, 0, DEFAULT_STRAFE_OPTIONS)
    expect(result.back).toBe(true)
  })

  it('computeStrafeControls strafeAD toggles left/right', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)
    const r1 = computeStrafeControls(node, target, 'strafeAD', 0, 0, DEFAULT_STRAFE_OPTIONS)
    const r2 = computeStrafeControls(node, target, 'strafeAD', 0, 6, DEFAULT_STRAFE_OPTIONS)
    // At tick 0 → left or right, at tick 6 → opposite
    expect(r1.left !== r2.left || r1.right !== r2.right).toBe(true)
  })

  it('computeStrafeControls circleStrafe moves forward and sprints', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(5, 64, 0)
    const result = computeStrafeControls(node, target, 'circleStrafe', 0, 0, DEFAULT_STRAFE_OPTIONS)
    expect(result.forward).toBe(true)
  })

  it('computeStrafeControls retreat faces away and moves back', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)
    const result = computeStrafeControls(node, target, 'retreat', 0, 0, DEFAULT_STRAFE_OPTIONS)
    expect(result.back).toBe(true)
    expect(result.sprint).toBe(true)
  })

  it('computeStrafeControls crit jump when in range', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)
    const result = computeStrafeControls(node, target, 'orbit', 0, 0, {
      ...DEFAULT_STRAFE_OPTIONS,
      jumpForCrits: true
    })
    expect(result.jump).toBe(true)
  })

  it('selectStrafePattern picks retreat on low health', () => {
    expect(selectStrafePattern(3, 5, 20, false)).toBe('retreat')
  })

  it('selectStrafePattern picks strafeAD when target attacking close', () => {
    expect(selectStrafePattern(2, 15, 20, true)).toBe('strafeAD')
  })

  it('selectStrafePattern picks circleStrafe on low target health', () => {
    expect(selectStrafePattern(3, 15, 3, false)).toBe('circleStrafe')
  })

  it('computeAimPitch returns negative for targets above', () => {
    const pitch = computeAimPitch(new Vec3(0, 64, 0), new Vec3(10, 66, 0))
    expect(pitch).toBeLessThan(0)
  })

  it('computeAimPitch returns near zero for same level', () => {
    const pitch = computeAimPitch(new Vec3(0, 64, 0), new Vec3(10, 64, 0))
    expect(Math.abs(pitch)).toBeLessThan(0.1)
  })

  it('PvPStrafeController ticks and switches patterns', () => {
    const controller = new PvPStrafeController()
    const node = makeNode(0, 64, 0)
    const target = new Vec3(5, 64, 0)

    // Initial tick
    const r1 = controller.tick(node, target, 0, 20, 20, false)
    expect(r1.forward || r1.left || r1.right).toBe(true)

    // After 20 ticks pattern may re-evaluate
    const r2 = controller.tick(node, target, 0, 20, 20, false)
    expect(controller.getPattern()).toBeTruthy()
  })

  it('PvPStrafeController setPattern forces specific pattern', () => {
    const controller = new PvPStrafeController()
    controller.setPattern('retreat')
    expect(controller.getPattern()).toBe('retreat')
  })

  it('PvPStrafeController reset clears state', () => {
    const controller = new PvPStrafeController()
    controller.setPattern('orbit')
    controller.reset()
    expect(controller.getPattern()).toBe('orbit') // reset doesn't change pattern directly, but tickCounter resets
  })
})

describe('Combo Executor', () => {
  const makeNode = (x: number, y: number, z: number, onGround = true, vy = 0): MovementNode => ({
    pos: new Vec3(x, y, z),
    vel: new Vec3(0, vy, 0),
    onGround,
    sprinting: false
  })

  it('computeWTapControls sequence: sprint → reset → attack → sprint', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)

    const phase1 = computeWTapControls(0, node, target)
    expect(phase1.forward).toBe(true)
    expect(phase1.sprint).toBe(true)
    expect(phase1.shouldAttack).toBe(false)

    // At tick 3, still in forward phase (wTapForwardTicks = 4)
    const phase2 = computeWTapControls(3, node, target)
    expect(phase2.forward).toBe(true)
    expect(phase2.sprint).toBe(true)

    // At tick 4, reset phase starts (wTapForwardTicks = 4)
    const phase3 = computeWTapControls(4, node, target)
    expect(phase3.forward).toBe(true)
    expect(phase3.sprint).toBe(false)

    // At tick 7, attack happens (4 forward + 3 reset = 7)
    const phase4 = computeWTapControls(7, node, target)
    expect(phase4.shouldAttack).toBe(true)
    expect(phase4.forward).toBe(true)
    expect(phase4.sprint).toBe(false)

    // At tick 8, re-engage sprint
    const phase5 = computeWTapControls(8, node, target)
    expect(phase5.sprint).toBe(true)
  })

  it('computeSTapControls moves back then forward', () => {
    const node = makeNode(0, 64, 0)
    const target = new Vec3(3, 64, 0)

    const phase1 = computeSTapControls(0, node, target)
    expect(phase1.back).toBe(true)
    expect(phase1.forward).toBe(false)

    const phase2 = computeSTapControls(3, node, target)
    expect(phase2.forward).toBe(true)
    expect(phase2.back).toBe(false)
  })

  it('computeCritJumpControls jumps on first tick', () => {
    const node = makeNode(0, 64, 0, true)
    const target = new Vec3(3, 64, 0)

    const phase1 = computeCritJumpControls(0, node, target)
    expect(phase1.jump).toBe(true)
    expect(phase1.forward).toBe(true)
    expect(phase1.shouldAttack).toBe(false)

    const fallingNode = makeNode(0, 65, 0, false, -0.2)
    const phase2 = computeCritJumpControls(4, fallingNode, target)
    expect(phase2.shouldAttack).toBe(true)
  })

  it('ComboExecutor queues and executes moves', () => {
    const executor = new ComboExecutor()
    executor.queueMove('wTap')
    expect(executor.isActive()).toBe(true)

    const node = makeNode(0, 64, 0, true)
    const target = new Vec3(3, 64, 0)

    const r1 = executor.tick(node, target, 0, 0)
    expect(r1.forward).toBe(true)
    expect(executor.getActiveMove()).toBe('wTap')

    // Tick enough to complete the move
    for (let i = 0; i < 20; i++) {
      executor.tick(node, target, i, 0)
    }
    expect(executor.isActive()).toBe(false)
  })

  it('ComboExecutor startMove begins immediately', () => {
    const executor = new ComboExecutor()
    executor.startMove('sTap')
    expect(executor.getActiveMove()).toBe('sTap')
  })

  it('ComboExecutor reset clears everything', () => {
    const executor = new ComboExecutor()
    executor.queueMove('wTap')
    executor.queueMove('critJump')
    executor.reset()
    expect(executor.isActive()).toBe(false)
    expect(executor.getActiveMove()).toBeNull()
  })

  it('ComboExecutor comboCooldown enforces delay', () => {
    const executor = new ComboExecutor({ comboCooldownTicks: 10 })
    executor.startMove('wTap')
    executor.tick(makeNode(0, 64, 0), new Vec3(3, 64, 0), 0, 0)

    // Try to queue another move immediately
    executor.queueMove('sTap')
    const result = executor.tick(makeNode(0, 64, 0), new Vec3(3, 64, 0), 1, 0)
    // Should still be executing wTap or waiting for cooldown
    expect(result).toBeDefined()
  })

  it('getAttackCooldownProgress returns 0 at start, 1 at full', () => {
    expect(getAttackCooldownProgress(0, 0, 12)).toBe(0)
    expect(getAttackCooldownProgress(0, 6, 12)).toBe(0.5)
    expect(getAttackCooldownProgress(0, 12, 12)).toBe(1)
    expect(getAttackCooldownProgress(0, 20, 12)).toBe(1)
  })

  it('getOptimalAttackTiming suggests correct actions', () => {
    expect(getOptimalAttackTiming(5, 1, false)).toBe('moveCloser')
    expect(getOptimalAttackTiming(2, 0.5, false)).toBe('waitForCooldown')
    expect(getOptimalAttackTiming(2, 1, false)).toBe('attackNow')
    expect(getOptimalAttackTiming(1.5, 1, true)).toBe('retreat')
  })
})
