import { describe, it, expect } from "bun:test";
import { ObjectPool } from "../src/optimization/object-pool";
import {
  PooledVec3,
  vec3Pool,
  acquireVec3,
  releaseVec3,
} from "../src/optimization/vec3-pool";
import {
  PooledAABB,
  aabbPool,
  acquireAABB,
  releaseAABB,
} from "../src/optimization/aabb-pool";
import {
  MemoryTracker,
  PeriodicMemoryTracker,
} from "../src/optimization/gc-metrics";
import {
  BotOrchestrator,
  type BotWorkerConfig,
} from "../src/optimization/orchestrator";

// ───────────────────────────────────────────────────────────────
// Object Pool Core
// ───────────────────────────────────────────────────────────────

describe("ObjectPool", () => {
  class TestObj {
    value = 0;
    reset() {
      this.value = 0;
    }
  }

  it("pre-creates initial objects", () => {
    const pool = new ObjectPool({
      factory: () => new TestObj(),
      initialSize: 10,
      maxSize: 20,
    });
    const m = pool.getMetrics();
    expect(m.totalCreated).toBe(10);
    expect(m.available).toBe(10);
    expect(m.inUse).toBe(0);
  });

  it("reuses released objects", () => {
    const pool = new ObjectPool({
      factory: () => new TestObj(),
      initialSize: 2,
      maxSize: 10,
    });
    const a = pool.acquire();
    a.value = 42;
    pool.release(a);
    const b = pool.acquire();
    expect(b.value).toBe(0); // reset called
    expect(pool.getMetrics().totalReused).toBe(2);
  });

  it("creates new objects when pool exhausted", () => {
    const pool = new ObjectPool({
      factory: () => new TestObj(),
      initialSize: 1,
      maxSize: 3,
    });
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(pool.getMetrics().totalCreated).toBe(3);
  });

  it("throws when maxSize exceeded", () => {
    const pool = new ObjectPool({
      factory: () => new TestObj(),
      initialSize: 1,
      maxSize: 2,
    });
    pool.acquire();
    pool.acquire();
    expect(() => pool.acquire()).toThrow(/exhausted/);
  });

  it("clear resets state", () => {
    const pool = new ObjectPool({
      factory: () => new TestObj(),
      initialSize: 5,
      maxSize: 10,
    });
    pool.acquire();
    pool.clear();
    expect(pool.getMetrics().inUse).toBe(0);
    expect(pool.getMetrics().available).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// Vec3 Pool
// ───────────────────────────────────────────────────────────────

describe("Vec3 Pool", () => {
  it("acquireVec3 initializes coordinates", () => {
    const v = acquireVec3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
    releaseVec3(v);
  });

  it("released Vec3 is reset", () => {
    const v = acquireVec3(5, 6, 7);
    releaseVec3(v);
    const w = acquireVec3();
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
    expect(w.z).toBe(0);
    releaseVec3(w);
  });

  it("setxyz updates in place", () => {
    const v = acquireVec3();
    v.setxyz(10, 20, 30);
    expect(v.x).toBe(10);
    expect(v.y).toBe(20);
    expect(v.z).toBe(30);
    releaseVec3(v);
  });

  it("copyFrom clones another Vec3", () => {
    const src = acquireVec3(1, 2, 3);
    const dst = acquireVec3();
    dst.copyFrom(src);
    expect(dst.x).toBe(1);
    expect(dst.y).toBe(2);
    expect(dst.z).toBe(3);
    releaseVec3(src);
    releaseVec3(dst);
  });

  it("global pool tracks metrics", () => {
    const before = vec3Pool.getMetrics().totalCreated;
    const v = acquireVec3(1, 1, 1);
    releaseVec3(v);
    const after = vec3Pool.getMetrics();
    expect(after.totalCreated).toBeGreaterThanOrEqual(before);
  });
});

// ───────────────────────────────────────────────────────────────
// AABB Pool
// ───────────────────────────────────────────────────────────────

describe("AABB Pool", () => {
  it("acquireAABB initializes bounds", () => {
    const b = acquireAABB(0, 0, 0, 1, 2, 3);
    expect(b.minX).toBe(0);
    expect(b.maxY).toBe(2);
    expect(b.maxZ).toBe(3);
    releaseAABB(b);
  });

  it("released AABB is reset", () => {
    const b = acquireAABB(1, 2, 3, 4, 5, 6);
    releaseAABB(b);
    const c = acquireAABB();
    expect(c.minX).toBe(0);
    expect(c.maxX).toBe(0);
    releaseAABB(c);
  });

  it("translate shifts bounds in place", () => {
    const b = acquireAABB(0, 0, 0, 1, 1, 1);
    b.translate(5, 10, 15);
    expect(b.minX).toBe(5);
    expect(b.minY).toBe(10);
    expect(b.minZ).toBe(15);
    expect(b.maxX).toBe(6);
    expect(b.maxY).toBe(11);
    expect(b.maxZ).toBe(16);
    releaseAABB(b);
  });

  it("expand grows bounds", () => {
    const b = acquireAABB(0, 0, 0, 1, 1, 1);
    b.expand(2, 3, 4);
    expect(b.minX).toBe(-2);
    expect(b.minY).toBe(-3);
    expect(b.minZ).toBe(-4);
    expect(b.maxX).toBe(3);
    expect(b.maxY).toBe(4);
    expect(b.maxZ).toBe(5);
    releaseAABB(b);
  });

  it("copyFrom clones another AABB", () => {
    const src = acquireAABB(1, 2, 3, 4, 5, 6);
    const dst = acquireAABB();
    dst.copyFrom(src);
    expect(dst.minX).toBe(1);
    expect(dst.maxZ).toBe(6);
    releaseAABB(src);
    releaseAABB(dst);
  });

  it("width/height/depth computed correctly", () => {
    const b = acquireAABB(1, 2, 3, 5, 7, 9);
    expect(b.width()).toBe(4);
    expect(b.height()).toBe(5);
    expect(b.depth()).toBe(6);
    releaseAABB(b);
  });
});

// ───────────────────────────────────────────────────────────────
// GC / Memory Metrics
// ───────────────────────────────────────────────────────────────

describe("MemoryTracker", () => {
  it("records snapshots", () => {
    const tracker = new MemoryTracker();
    const s1 = tracker.record();
    expect(s1.rss).toBeGreaterThan(0);
    expect(s1.heapUsed).toBeGreaterThan(0);
    expect(s1.timestamp).toBeGreaterThan(0);
  });

  it("maintains history", () => {
    const tracker = new MemoryTracker(5);
    for (let i = 0; i < 10; i++) {
      tracker.record();
    }
    expect(tracker.getHistory().length).toBeLessThanOrEqual(5);
  });

  it("summary includes RSS", () => {
    const tracker = new MemoryTracker();
    tracker.record();
    const summary = tracker.summary();
    expect(summary).toContain("RSS=");
    expect(summary).toContain("MB");
  });

  it("peakRss returns highest value", () => {
    const tracker = new MemoryTracker();
    tracker.record();
    expect(tracker.peakRss()).toBeGreaterThan(0);
  });
});

describe("PeriodicMemoryTracker", () => {
  it("starts and stops without error", () => {
    const pmt = new PeriodicMemoryTracker(50, 10);
    pmt.start();
    // Let it tick once
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        pmt.stop();
        const hist = pmt.getTracker().getHistory();
        expect(hist.length).toBeGreaterThanOrEqual(1);
        resolve();
      }, 120);
    });
  });
});

// ───────────────────────────────────────────────────────────────
// Orchestrator
// ───────────────────────────────────────────────────────────────

describe("BotOrchestrator", () => {
  it("throws on duplicate spawn", () => {
    const orch = new BotOrchestrator();
    const config: BotWorkerConfig = {
      id: "bot-1",
      scriptPath: "./dummy.js",
    };
    orch.spawn(config);
    expect(() => orch.spawn(config)).toThrow(/already exists/);
    orch.shutdown();
  });

  it("lists spawned workers", () => {
    const orch = new BotOrchestrator();
    orch.spawn({ id: "a", scriptPath: "./a.js" });
    orch.spawn({ id: "b", scriptPath: "./b.js" });
    expect(orch.listWorkers()).toContain("a");
    expect(orch.listWorkers()).toContain("b");
    orch.shutdown();
  });

  it("getState returns correct ID", () => {
    const orch = new BotOrchestrator();
    orch.spawn({ id: "x", scriptPath: "./x.js" });
    const st = orch.getState("x");
    expect(st).toBeDefined();
    expect(st!.id).toBe("x");
    orch.shutdown();
  });

  it("health reports totals", () => {
    const orch = new BotOrchestrator();
    orch.spawn({ id: "w1", scriptPath: "./w1.js" });
    orch.spawn({ id: "w2", scriptPath: "./w2.js" });
    const h = orch.health();
    expect(h.total).toBe(2);
    expect(h.workers.length).toBe(2);
    orch.shutdown();
  });

  it("remove deletes worker", () => {
    const orch = new BotOrchestrator();
    orch.spawn({ id: "del", scriptPath: "./del.js" });
    expect(orch.remove("del")).toBe(true);
    expect(orch.getState("del")).toBeUndefined();
    orch.shutdown();
  });

  it("kill returns false for unknown worker", () => {
    const orch = new BotOrchestrator();
    expect(orch.kill("ghost")).toBe(false);
    orch.shutdown();
  });

  it("stop returns false for unknown worker", () => {
    const orch = new BotOrchestrator();
    expect(orch.stop("ghost")).toBe(false);
    orch.shutdown();
  });

  it("shutdown clears all workers", () => {
    const orch = new BotOrchestrator();
    orch.spawn({ id: "s1", scriptPath: "./s1.js" });
    orch.spawn({ id: "s2", scriptPath: "./s2.js" });
    orch.shutdown();
    expect(orch.listWorkers().length).toBe(0);
  });
});
