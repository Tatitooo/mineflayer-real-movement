# mineflayer-real-movement

Realistic movement engine for [Mineflayer](https://github.com/PrismarineJS/mineflayer) bots with true AABB physics, momentum-aware pathfinding, and human-like motion.

> **Goal**: Transform Mineflayer bots into beasts of movement indistinguishable from human players.

[![Tests](https://img.shields.io/badge/tests-260%2F260%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()
[![Runtime](https://img.shields.io/badge/runtime-Bun%20%7C%20Node%2020+-orange)]()

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Demo Scenarios](#demo-scenarios)
- [Testing](#testing)
- [Performance](#performance)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### Phase 1 — Core Physics + Basic Pathfinding
- **WorldCollisionService**: Precise AABB collision using `minecraft-data` `blockCollisionShapes` (4,327 shapes for 1.20).
- **SweptAABBValidator**: Micro-simulates `moveEntity` between points to detect intermediate collisions (fence corners, trapdoor edges).
- **A* 3D Pathfinder**: Nodes include `{pos, vel, onGround, sprinting}`. Edge costs computed via `prismarine-physics` simulation.

### Phase 2 — Advanced Movement
- **Parkour executor**: Sprint-jump gaps (1–3 blocks), ladder jumps, fence vaults with state-machine timing.
- **Swim navigator**: 1-block tunnel swimming, bubble column ascent, Depth Strider awareness.
- **Knockback recovery**: Detects impulse vector, applies counter-strafe, re-engages pathfinder.
- **Special blocks**: Soul sand (×0.4), honey (reduced jump), slime bounce, cobweb escape, ice momentum preservation.
- **Scaffold extension**: Speed bridging / ninja bridging with tick-perfect block placement simulation.

### Phase 3 — Momentum-Aware Pathfinding
- **Momentum edges**: Diagonal sprint (1.3× multiplier), long-gap jumps (3–5 blocks) when exiting ice or sprint-jumps.
- **Velocity chaining**: Exit velocity of one edge = entry velocity of the next.
- **Dynamic re-planning**: Reacts to block updates and entity movements in <100 ms.

### Phase 4 — Humanization / Anti-Bot Layer
- **Perlin noise** on yaw/pitch/velocity for organic micro-variation.
- **Gaussian reaction delays** (150–300 ms) with burst/rest cycles.
- **Ping-aware timing** + TPS synchronization (no robotic 20 TPS perfection).
- **Acceleration curves**: Ease-in (3–6 ticks) / ease-out (2–4 ticks) on movement state changes.
- **WASD jitter**: Micro-corrections, intermittent sprint drops, "fatigue" simulation.

### Phase 5 — Elytra + PvP Movement
- **Elytra controller**: Launch, glide pitch/yaw, firework boost requests, soft landing.
- **PvP strafing**: A/D orbiting, hit-and-run, circle-strafe, retreat patterns.
- **Combo executor**: W-tap (sprint reset for extra KB), S-tap (range control), crit-jump timing.

### Phase 6 — Optimization + Orchestration
- **Object pools**: Pooled `Vec3` and AABB allocations to reduce GC pressure.
- **Child-process orchestrator**: One process per bot with health checks and auto-restart.
- **Metrics collection**: Tick-level sampling for latency, CPU%, RSS memory.

### Phase 7 — Demo + Video
- **Demo framework**: Parkour maps, PvP 1v1, escape chases, speedrun navigation.
- **Side-by-side comparator**: Vanilla pathfinder vs real-movement.
- **Metrics reports**: Human-readable + JSON export for video evidence.

---

## Installation

```bash
# Clone
git clone https://github.com/yourname/mineflayer-real-movement.git
cd mineflayer-real-movement

# Install (Bun preferred)
bun install

# Or npm
npm install
```

### Requirements
- **Bun** ≥ 1.1.20 (primary) or **Node.js** ≥ 20 LTS (fallback)
- A Minecraft Java server (local or remote) for integration testing

---

## Quick Start

```typescript
import mineflayer from 'mineflayer'
import { realMovementPlugin, GoalBlock } from 'mineflayer-real-movement'
import { Vec3 } from 'vec3'

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'RealMovementBot',
  version: '1.20.4'
})

// Load the plugin
bot.loadPlugin(realMovementPlugin)

bot.once('spawn', async () => {
  // Walk to a specific block
  await bot.realMovement.goto(new GoalBlock(new Vec3(100, 64, 200)))

  // Or find a path without executing it
  const result = bot.realMovement.findPath(
    bot.entity.position,
    new GoalBlock(new Vec3(120, 64, 220))
  )
  console.log(result.status, result.path.length)
})
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  LAYER 5: Humanization / Anti-Bot       │  Perlin noise, Gaussian delays, GCD smoothing
├──────────────────────────────────────────────────┤
│  LAYER 4: Execution Controller          │  Tick-by-tick control state generator with feedback
├──────────────────────────────────────────────────┤
│  LAYER 3: Advanced Movement Engine       │  Parkour, elytra, swim, ladder, knockback recovery
├──────────────────────────────────────────────────┤
│  LAYER 2: Momentum-Aware Pathfinder     │  A* 3D with real tick costs + swept-AABB validation
├──────────────────────────────────────────────────┤
│  LAYER 1: Physics Core (prismarine)     │  Collision, gravity, friction, stepHeight = 0.6
├──────────────────────────────────────────────────┤
│  LAYER 0: World & Collision Data        │  minecraft-data shapes, prismarine-world chunks
└──────────────────────────────────────────────────┘
```

---

## API Reference

### Plugin Registration

```typescript
bot.loadPlugin(realMovementPlugin)
```

### Navigation

```typescript
// Go to a block
await bot.realMovement.goto(new GoalBlock(new Vec3(x, y, z)))

// Go near a point with radius
await bot.realMovement.goto(new GoalNear(new Vec3(x, y, z), radius))

// Find path only
const result = bot.realMovement.findPath(start, goal)
```

### PvP Strafing

```typescript
bot.realMovement.strafe.start(targetEntity, { pattern: 'orbit' })
bot.realMovement.strafe.stop()
```

### Combo Moves

```typescript
bot.realMovement.combo.queue(ComboMove.WTap)
bot.realMovement.combo.queue(ComboMove.CritJump)
```

### Elytra Flight

```typescript
bot.realMovement.elytra.start(targetPos, altitude)
bot.realMovement.elytra.boost() // request firework boost
```

### Stopping

```typescript
bot.realMovement.stop() // halt all movement, clear control states
```

---

## Demo Scenarios

```bash
# Parkour demo
bun run demo:parkour

# PvP strafing demo
bun run demo:pvp

# Escape chase demo
bun run demo:escape

# Side-by-side comparison (vanilla vs real-movement)
bun run demo:side-by-side

# Anti-cheat stress test
bun run demo:anticheat

# Speedrun navigation
bun run demo:speedrun
```

---

## Testing

```bash
# Run all tests (Bun)
bun test

# Run all tests (Node fallback)
npm test

# Lint only
bun run lint
```

### Test Coverage

- **Collision**: AABB validation, swept tests, block shape resolution
- **Pathfinding**: A* correctness, momentum edge chaining, heuristic admissibility
- **Movement**: Parkour state machine, scaffold phases, swim feasibility
- **Execution**: Node progression, timeout handling, replanning triggers
- **Humanization**: Noise bounds, delay distributions, acceleration curves
- **PvP / Elytra**: Orbit yaw, attack timing, glide pitch computation
- **Integration**: Full bot scenarios with mock worlds

---

## Performance

| Metric | Target | Status |
|--------|--------|--------|
| Pathfinding latency | <50 ms for 100-block path | ✅ Met |
| Tick overhead | <0.5 ms / tick | ✅ Met |
| Memory RSS | <80 MB per bot | ✅ Met |
| Multi-bot scaling | 1 process / bot via `child_process` | ✅ Implemented |

Run benchmarks:
```bash
bun run benchmark
```

---

## Roadmap

- [x] Phase 1: Core Physics + Basic Pathfinder
- [x] Phase 2: Advanced Movement
- [x] Phase 3: Momentum-Aware Pathfinding
- [x] Phase 4: Humanization Layer
- [x] Phase 5: Elytra + PvP Movement
- [x] Phase 6: Optimization + Orchestration
- [ ] Phase 7: YouTube Video Production
  - [ ] Capture demo footage
  - [ ] Side-by-side editing
  - [ ] Narration script

---

## License

MIT © 2026
