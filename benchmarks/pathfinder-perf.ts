/**
 * Benchmark suite for pathfinding latency, CPU%, and RSS memory.
 * Run with: `bun run benchmarks/pathfinder-perf.ts`
 */

import { performance } from "perf_hooks";
import { Vec3 } from "vec3";
import { AStarPathfinder } from "../src/pathfinding/astar-basic";
import { GoalBlock } from "../src/pathfinding/goals";
import { WorldCollisionService } from "../src/core/world-collision-service";
import { MockWorld, createFlatGround, createTree } from "../tests/physics-mocks";

interface BenchmarkResult {
  name: string;
  runs: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  rssStartMb: number;
  rssEndMb: number;
  rssDeltaMb: number;
  successRate: number;
  pathLengthAvg: number;
}

function measure<R>(fn: () => R): { ms: number; result: R } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { ms, result };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function rssMB(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

function buildTreeWorld(count: number): MockWorld {
  const world = new MockWorld();
  createFlatGround(world, 64, 100);
  for (let i = 0; i < count; i++) {
    createTree(world, 5 + i * 4, 0);
  }
  return world;
}

function buildHillyWorld(): MockWorld {
  const world = new MockWorld();
  createFlatGround(world, 64, 100);
  for (let x = 10; x < 40; x += 5) {
    world.setBlock(x, 65, 0, { name: "stone", stateId: 1, boundingBox: "block", shapes: [[0, 0, 0, 1, 1, 1]] });
    world.setBlock(x + 1, 65, 0, { name: "stone", stateId: 1, boundingBox: "block", shapes: [[0, 0, 0, 1, 1, 1]] });
    world.setBlock(x + 2, 66, 0, { name: "stone", stateId: 1, boundingBox: "block", shapes: [[0, 0, 0, 1, 1, 1]] });
  }
  return world;
}

function buildGapWorld(gap: number): MockWorld {
  const world = new MockWorld();
  createFlatGround(world, 64, 100);
  for (let x = 4; x < 4 + gap; x++) {
    world.removeBlock(x, 64, 0);
  }
  return world;
}

function runBenchmark(params: {
  name: string;
  runs: number;
  buildWorld: () => MockWorld;
  start: Vec3;
  goal: Vec3;
  maxIterations?: number;
  maxDistance?: number;
}): BenchmarkResult {
  const times: number[] = [];
  let successes = 0;
  let totalPathLength = 0;
  const rssStart = rssMB();

  // Warm-up
  {
    const world = params.buildWorld();
    const cs = new WorldCollisionService(world as any);
    const pf = new AStarPathfinder(world, cs);
    const goal = new GoalBlock(params.goal);
    pf.findPath(params.start, goal, params.maxIterations ?? 10000, params.maxDistance);
  }

  for (let i = 0; i < params.runs; i++) {
    const world = params.buildWorld();
    const cs = new WorldCollisionService(world as any);
    const pf = new AStarPathfinder(world, cs);
    const goal = new GoalBlock(params.goal);
    const { ms, result } = measure(() =>
      pf.findPath(params.start, goal, params.maxIterations ?? 10000, params.maxDistance)
    );
    times.push(ms);
    if (result.path.length > 0) {
      successes++;
      totalPathLength += result.path.length;
    }
  }

  const sorted = [...times].sort((a, b) => a - b);
  const rssEnd = rssMB();

  return {
    name: params.name,
    runs: params.runs,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    rssStartMb: rssStart,
    rssEndMb: rssEnd,
    rssDeltaMb: rssEnd - rssStart,
    successRate: successes / params.runs,
    pathLengthAvg: successes > 0 ? totalPathLength / successes : 0,
  };
}

function printResult(r: BenchmarkResult): void {
  console.log(`\n==== ${r.name} ====`);
  console.log(`  Runs        : ${r.runs}`);
  console.log(`  SuccessRate : ${(r.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg PathLen : ${r.pathLengthAvg.toFixed(1)} nodes`);
  console.log(`  Latency     : avg=${r.avgMs.toFixed(2)}ms  min=${r.minMs.toFixed(2)}ms  max=${r.maxMs.toFixed(2)}ms`);
  console.log(`              : med=${r.medianMs.toFixed(2)}ms  p95=${r.p95Ms.toFixed(2)}ms  p99=${r.p99Ms.toFixed(2)}ms`);
  console.log(`  Memory      : start=${r.rssStartMb.toFixed(1)}MB  end=${r.rssEndMb.toFixed(1)}MB  d=${r.rssDeltaMb.toFixed(1)}MB`);
}

// ───────────────────────────────────────────────────────────────
const RUNS = 100;

const benchmarks: BenchmarkResult[] = [];

benchmarks.push(
  runBenchmark({
    name: "Flat 100 blocks",
    runs: RUNS,
    buildWorld: () => {
      const w = new MockWorld();
      createFlatGround(w, 64, 100);
      return w;
    },
    start: new Vec3(0, 64, 0),
    goal: new Vec3(100, 64, 0),
    maxDistance: 200,
  })
);

benchmarks.push(
  runBenchmark({
    name: "Tree avoidance (20 trees)",
    runs: RUNS,
    buildWorld: () => buildTreeWorld(20),
    start: new Vec3(0, 64, 0),
    goal: new Vec3(80, 64, 0),
    maxDistance: 200,
  })
);

benchmarks.push(
  runBenchmark({
    name: "Hilly terrain",
    runs: RUNS,
    buildWorld: () => buildHillyWorld(),
    start: new Vec3(0, 64, 0),
    goal: new Vec3(50, 70, 0),
    maxDistance: 200,
  })
);

benchmarks.push(
  runBenchmark({
    name: "2-block gap",
    runs: RUNS,
    buildWorld: () => buildGapWorld(2),
    start: new Vec3(0, 64, 0),
    goal: new Vec3(10, 64, 0),
    maxDistance: 200,
  })
);

for (const r of benchmarks) {
  printResult(r);
}

console.log("\n==== Summary ====");
const totalAvg = benchmarks.reduce((s, b) => s + b.avgMs, 0) / benchmarks.length;
const totalP95 = benchmarks.reduce((s, b) => s + b.p95Ms, 0) / benchmarks.length;
console.log(`  Overall avg latency : ${totalAvg.toFixed(2)}ms`);
console.log(`  Overall p95 latency : ${totalP95.toFixed(2)}ms`);
