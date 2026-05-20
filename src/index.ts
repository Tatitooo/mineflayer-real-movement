export {
  WorldCollisionService,
  type McDataLike,
  type McDataCollisionShapes,
  type McDataBlockEntry
} from './core/world-collision-service'

export {
  PhysicsPredictor,
  type PredictorEffectState,
  type SimulationResult
} from './core/physics-predictor'

export {
  getPlayerAABB,
  makeAABB,
  shapeToWorldAABB,
  aabbIntersects,
  aabbContainsPoint,
  sweptAABBOffset,
  sweptQueryAABB
} from './core/aabb-utils'

export {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_HALF_WIDTH,
  type MovementNode,
  type MovementEdge,
  type ControlInputs,
  type PathGoal,
  type PathResult,
  type ResolvedBlockCollision,
  type BlockCollisionInfo,
  type CollisionWorld,
  type SimPlayerState,
  type SweptValidationOptions
} from './core/types'

export { SweptAABBValidator, type SweptValidationResult } from './core/swept-aabb-validator'

export { AStarPathfinder } from './pathfinding/astar-basic'
export { GoalBlock, GoalNear } from './pathfinding/goals'

export {
  PathExecutor,
  ExecutorState,
  type ExecutorOptions,
  type BotLike
} from './execution/executor'

export {
  computeControlInputs,
  estimateTicks
} from './execution/control-generator'

export {
  yawToTarget,
  pitchToTarget,
  yawDifference,
  isAligned,
  hasArrived,
  needsJump
} from './execution/alignment-logic'

export { realMovementPlugin, type RealMovementPlugin } from './plugin'

export {
  classifySpecialBlock,
  getModifier,
  getGroundBlock,
  getGroundModifier,
  getBodyModifier,
  isOnIce,
  isInCobweb,
  isOnSoulSand,
  type SpecialBlockType,
  type MovementModifier
} from './movement/special-blocks'

export {
  isSubmerged,
  is1BlockTunnel,
  getBubbleColumnDirection,
  computeSwimControls,
  estimateSwimTicks,
  canSwimTo
} from './movement/swim-navigator'

export {
  analyzeKnockback,
  computeRecoveryControls,
  KnockbackRecoveryTracker,
  type KnockbackAnalysis,
  type KnockbackRecoveryOptions
} from './movement/knockback-recovery'

export {
  isClimbable,
  isFenceOrWall,
  canSprintJumpGap,
  canLadderJump,
  canFenceVault,
  generateParkourEdges,
  computeParkourControls,
  estimateParkourTicks,
  ParkourExecutor,
  PARKOUR_MOVES,
  type ParkourMove,
  type ParkourPhase
} from './movement/parkour-executor'

export {
  isScaffoldBlock,
  canPlaceBlock,
  canSpeedBridge,
  canNinjaBridge,
  generateScaffoldEdges,
  computeScaffoldControls,
  estimateScaffoldTicks,
  ScaffoldExecutor,
  SCAFFOLD_BLOCKS,
  DEFAULT_SCAFFOLD_OPTIONS,
  type ScaffoldOptions,
  type ScaffoldPhase
} from './movement/scaffold-extension'

export {
  computeGlidePitch,
  computeGlideYaw,
  computeElytraControls,
  ElytraExecutor,
  canElytraTo,
  estimateElytraTicks,
  DEFAULT_ELYTRA_OPTIONS,
  type ElytraPhase,
  type ElytraOptions
} from './movement/elytra-controller'

export {
  StrafePattern,
  computeOrbitYaw,
  shouldAttack,
  computeStrafeControls,
  selectStrafePattern,
  computeAimPitch,
  PvPStrafeController,
  DEFAULT_STRAFE_OPTIONS,
  type StrafeOptions
} from './movement/pvp-strafing'

export {
  ComboMove,
  computeWTapControls,
  computeSTapControls,
  computeCritJumpControls,
  ComboExecutor,
  getAttackCooldownProgress,
  getOptimalAttackTiming,
  DEFAULT_COMBO_OPTIONS,
  type ComboOptions
} from './movement/combo-executor'

export {
  DynamicReplanner,
  type ReplannerBot,
  type ReplanCallback
} from './execution/dynamic-replanner'

export {
  HumanizationLayer,
  type HumanizationOptions,
  type HumanizedControls
} from './humanization/humanization-layer'

export {
  JitterInjector,
  type JitterConfig,
  type JitterResult
} from './humanization/jitter-injector'

export {
  AccelerationController,
  type AccelerationProfile,
  DEFAULT_ACCEL_PROFILE
} from './humanization/acceleration-curves'

export {
  DelayTracker,
  DelayPresets,
  computeReactionDelay,
  type DelayOptions,
  type DelayResult
} from './humanization/delay-injector'

export {
  PingTracker,
  computeTickTiming,
  estimateTps,
  type PingSyncOptions,
  type TickTiming
} from './humanization/ping-sync'

export {
  PerlinNoise,
  SimplexNoise,
  gaussian,
  gaussianPair,
  clamp,
  boundedBrownianStep,
  Easing
} from './humanization/noise-generators'

// Phase 6: Optimization + Orchestration
export {
  ObjectPool,
  type PooledObject,
  type ObjectPoolConfig,
  type PoolMetrics
} from './optimization/object-pool'

export {
  PooledVec3,
  vec3Pool,
  acquireVec3,
  releaseVec3
} from './optimization/vec3-pool'

export {
  PooledAABB,
  type AABBLike,
  aabbPool,
  acquireAABB,
  releaseAABB
} from './optimization/aabb-pool'

export {
  MemoryTracker,
  PeriodicMemoryTracker,
  type MemorySnapshot,
  type GcMetrics
} from './optimization/gc-metrics'

// Phase 7: Demo framework
export {
  MetricsCollector,
  type PositionSample,
  type HumanizationSample,
  type DemoMetrics,
  formatMetricsReport,
  metricsToJson
} from './demo/metrics-collector'

export {
  DemoRunner,
  type DemoRunnerOptions,
  type DemoScenario,
  runDemo
} from './demo/demo-runner'

export {
  BotOrchestrator,
  type BotWorkerConfig,
  type WorkerStatus,
  type BotWorkerState,
  type WorkerMessage,
  type WorkerHealth,
  type OrchestratorHealth
} from './optimization/orchestrator'
