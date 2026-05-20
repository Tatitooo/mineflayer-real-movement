import { Vec3 } from 'vec3'
import type { MovementNode, ControlInputs } from '../core/types'
import { yawToTarget } from '../execution/alignment-logic'

/**
 * Combo move types for PvP.
 */
export type ComboMove =
  | 'wTap'      // Sprint reset for extra knockback
  | 'sTap'      // S-tap to control range
  | 'critJump'  // Jump-crit (falling attack for +50% damage)
  | 'blockHit'  // Block-hitting (1.8 style, not applicable in 1.9+)
  | 'doubleTap' // Two quick attacks (1.8 style)

/**
 * Configuration for combo timing and behavior.
 */
export interface ComboOptions {
  /** Attack cooldown in ticks (1.9+ combat). 12 for swords, 20 for axes. */
  attackCooldownTicks: number
  /** W-tap sprint reset duration (ticks). */
  wTapResetTicks: number
  /** W-tap forward duration before reset. */
  wTapForwardTicks: number
  /** S-tap backward duration. */
  sTapBackTicks: number
  /** Crit jump timing: jump this many ticks before attack lands. */
  critJumpLeadTicks: number
  /** Minimum time between combo moves (ticks). */
  comboCooldownTicks: number
}

export const DEFAULT_COMBO_OPTIONS: ComboOptions = {
  attackCooldownTicks: 12,  // sword
  wTapResetTicks: 3,
  wTapForwardTicks: 4,
  sTapBackTicks: 3,
  critJumpLeadTicks: 4,
  comboCooldownTicks: 8
}

/**
 * Compute controls for a W-tap sprint reset.
 * Pattern: sprint forward → release sprint → attack → sprint again.
 * The sprint reset gives extra knockback because the server considers
 * the player "not sprinting" at the moment of attack, but the momentum
 * carries over, resulting in velocity-based knockback.
 */
export function computeWTapControls (
  tickInSequence: number,
  currentNode: MovementNode,
  targetPos: Vec3,
  options: ComboOptions = DEFAULT_COMBO_OPTIONS
): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  const targetYaw = yawToTarget(currentNode.pos, targetPos)

  // Phase 1: sprint forward briefly
  if (tickInSequence < options.wTapForwardTicks) {
    inputs.forward = true
    inputs.sprint = true
  }
  // Phase 2: release sprint (the "reset")
  else if (tickInSequence < options.wTapForwardTicks + options.wTapResetTicks) {
    inputs.forward = true
    inputs.sprint = false
  }
  // Phase 3: attack window
  else if (tickInSequence === options.wTapForwardTicks + options.wTapResetTicks) {
    inputs.forward = true
    inputs.sprint = false
    return { ...inputs, targetYaw, targetPitch: 0, shouldAttack: true }
  }
  // Phase 4: re-engage sprint
  else {
    inputs.forward = true
    inputs.sprint = true
  }

  return { ...inputs, targetYaw, targetPitch: 0, shouldAttack: false }
}

/**
 * Compute controls for an S-tap.
 * Pattern: move backward briefly to create distance, then re-engage.
 * Used when the opponent is too close or when you want to bait a hit.
 */
export function computeSTapControls (
  tickInSequence: number,
  currentNode: MovementNode,
  targetPos: Vec3,
  options: ComboOptions = DEFAULT_COMBO_OPTIONS
): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  const targetYaw = yawToTarget(currentNode.pos, targetPos)

  // Phase 1: move backward
  if (tickInSequence < options.sTapBackTicks) {
    inputs.back = true
    // Face the target while backing up (Minecraft allows strafing backward)
  }
  // Phase 2: re-engage forward
  else {
    inputs.forward = true
    inputs.sprint = true
  }

  return { ...inputs, targetYaw, targetPitch: 0, shouldAttack: false }
}

/**
 * Compute controls for a critical hit jump.
 * In 1.9+ combat, falling attacks deal +50% damage.
 * Pattern: jump → wait to start falling → attack at peak descent.
 */
export function computeCritJumpControls (
  tickInSequence: number,
  currentNode: MovementNode,
  targetPos: Vec3,
  options: ComboOptions = DEFAULT_COMBO_OPTIONS
): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
  const inputs: ControlInputs = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }

  const targetYaw = yawToTarget(currentNode.pos, targetPos)
  let shouldAttack = false

  // Phase 1: jump (must be on ground to jump)
  if (tickInSequence === 0 && currentNode.onGround) {
    inputs.jump = true
    inputs.forward = true // forward momentum
  }
  // Phase 2: falling attack
  else if (tickInSequence === options.critJumpLeadTicks && !currentNode.onGround && currentNode.vel.y < -0.1) {
    shouldAttack = true
    inputs.forward = true
  }
  // Phase 3: landing recovery
  else if (tickInSequence > options.critJumpLeadTicks) {
    inputs.forward = true
    inputs.sprint = true
  }

  return { ...inputs, targetYaw, targetPitch: 0, shouldAttack }
}

/**
 * State machine for executing combo sequences.
 */
export class ComboExecutor {
  private activeMove: ComboMove | null = null
  private tickInSequence = 0
  private lastComboTick = -999
  private options: ComboOptions
  private comboQueue: ComboMove[] = []

  constructor (options?: Partial<ComboOptions>) {
    this.options = { ...DEFAULT_COMBO_OPTIONS, ...options }
  }

  /**
   * Queue a combo move to execute.
   */
  queueMove (move: ComboMove): void {
    this.comboQueue.push(move)
  }

  /**
   * Start a specific combo move immediately.
   */
  startMove (move: ComboMove): void {
    this.activeMove = move
    this.tickInSequence = 0
    this.lastComboTick = 0
  }

  /**
   * Tick the combo executor.
   * Returns controls + whether to attack this tick.
   */
  tick (
    currentNode: MovementNode,
    targetPos: Vec3,
    totalTicks: number,
    attackCooldown: number
  ): ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean } {
    // Check cooldown
    const cooldownElapsed = totalTicks - this.lastComboTick >= this.options.comboCooldownTicks

    // If no active move and queue is empty, return neutral
    if (!this.activeMove && this.comboQueue.length === 0) {
      const targetYaw = yawToTarget(currentNode.pos, targetPos)
      return {
        forward: false, back: false, left: false, right: false,
        jump: false, sprint: false, sneak: false,
        targetYaw, targetPitch: 0, shouldAttack: false
      }
    }

    // Start next queued move if cooldown elapsed
    if (!this.activeMove && this.comboQueue.length > 0 && cooldownElapsed && attackCooldown <= 0) {
      this.activeMove = this.comboQueue.shift()!
      this.tickInSequence = 0
      this.lastComboTick = totalTicks
    }

    if (!this.activeMove) {
      const targetYaw = yawToTarget(currentNode.pos, targetPos)
      return {
        forward: false, back: false, left: false, right: false,
        jump: false, sprint: false, sneak: false,
        targetYaw, targetPitch: 0, shouldAttack: false
      }
    }

    let result: ControlInputs & { targetYaw: number; targetPitch: number; shouldAttack: boolean }

    switch (this.activeMove) {
      case 'wTap': {
        result = computeWTapControls(this.tickInSequence, currentNode, targetPos, this.options)
        break
      }
      case 'sTap': {
        result = computeSTapControls(this.tickInSequence, currentNode, targetPos, this.options)
        break
      }
      case 'critJump': {
        result = computeCritJumpControls(this.tickInSequence, currentNode, targetPos, this.options)
        break
      }
      default: {
        const targetYaw = yawToTarget(currentNode.pos, targetPos)
        result = {
          forward: false, back: false, left: false, right: false,
          jump: false, sprint: false, sneak: false,
          targetYaw, targetPitch: 0, shouldAttack: false
        }
      }
    }

    this.tickInSequence++

    // Auto-complete moves after their natural duration
    const maxDuration = this.getMoveDuration(this.activeMove)
    if (this.tickInSequence >= maxDuration) {
      this.activeMove = null
      this.tickInSequence = 0
    }

    return result
  }

  private getMoveDuration (move: ComboMove): number {
    switch (move) {
      case 'wTap': return this.options.wTapForwardTicks + this.options.wTapResetTicks + 2
      case 'sTap': return this.options.sTapBackTicks + 2
      case 'critJump': return this.options.critJumpLeadTicks + 4
      default: return 5
    }
  }

  /** Whether a combo is currently active. */
  isActive (): boolean {
    return this.activeMove !== null || this.comboQueue.length > 0
  }

  /** Current active move. */
  getActiveMove (): ComboMove | null {
    return this.activeMove
  }

  /** Reset state. */
  reset (): void {
    this.activeMove = null
    this.tickInSequence = 0
    this.lastComboTick = -999
    this.comboQueue = []
  }
}

/**
 * Calculate attack cooldown progress (0 = ready, 1 = full cooldown).
 */
export function getAttackCooldownProgress (
  lastAttackTick: number,
  currentTick: number,
  cooldownTicks: number
): number {
  const elapsed = currentTick - lastAttackTick
  return Math.min(1, Math.max(0, elapsed / cooldownTicks))
}

/**
 * Determine optimal attack timing based on cooldown and distance.
 */
export function getOptimalAttackTiming (
  distance: number,
  cooldownProgress: number,
  targetMovingToward: boolean
): 'attackNow' | 'waitForCooldown' | 'moveCloser' | 'retreat' {
  if (distance > 3.5) return 'moveCloser'
  if (cooldownProgress < 0.8) return 'waitForCooldown'
  if (targetMovingToward && distance < 2.0) return 'retreat'
  return 'attackNow'
}
