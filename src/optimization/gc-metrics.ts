/**
 * GC / memory metrics tracker.
 * Uses `performance.memory` (Chromium/V8) when available,
 * falls back to `process.memoryUsage()` on Node/Bun.
 */

export interface MemorySnapshot {
  timestamp: number;
  rss: number; // bytes
  heapUsed: number; // bytes
  heapTotal: number; // bytes
  external: number; // bytes
  /** V8-specific: used JS heap size */
  usedJSHeapSize?: number;
  /** V8-specific: total JS heap size limit */
  jsHeapSizeLimit?: number;
}

export interface GcMetrics {
  snapshots: MemorySnapshot[];
  maxSnapshots: number;
}

/** Simple ring-buffer of memory snapshots. */
export class MemoryTracker {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots: number;

  constructor(maxSnapshots = 300) {
    this.maxSnapshots = maxSnapshots;
  }

  /** Record a memory snapshot now. */
  record(): MemorySnapshot {
    const snap = takeMemorySnapshot();
    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    return snap;
  }

  /** Get all stored snapshots. */
  getHistory(): readonly MemorySnapshot[] {
    return this.snapshots;
  }

  /** Compute RSS delta between first and last snapshot. */
  rssDelta(): number {
    if (this.snapshots.length < 2) return 0;
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    return last.rss - first.rss;
  }

  /** Compute average RSS across all snapshots (bytes). */
  averageRss(): number {
    if (this.snapshots.length === 0) return 0;
    const sum = this.snapshots.reduce((acc, s) => acc + s.rss, 0);
    return sum / this.snapshots.length;
  }

  /** Peak RSS seen (bytes). */
  peakRss(): number {
    return this.snapshots.reduce((max, s) => Math.max(max, s.rss), 0);
  }

  /** Format bytes to human-readable MB. */
  static formatMB(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  /** Summary string for logging. */
  summary(): string {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return "No snapshots yet.";
    return (
      `RSS=${MemoryTracker.formatMB(latest.rss)} ` +
      `Heap=${MemoryTracker.formatMB(latest.heapUsed)}/` +
      `${MemoryTracker.formatMB(latest.heapTotal)} ` +
      `ΔRSS=${MemoryTracker.formatMB(this.rssDelta())} ` +
      `Peak=${MemoryTracker.formatMB(this.peakRss())}`
    );
  }
}

function takeMemorySnapshot(): MemorySnapshot {
  const now = Date.now();

  // Bun/Node standard
  const mu = process.memoryUsage();
  const snap: MemorySnapshot = {
    timestamp: now,
    rss: mu.rss,
    heapUsed: mu.heapUsed,
    heapTotal: mu.heapTotal,
    external: mu.external ?? 0,
  };

  // V8-specific (Chromium environments, some Bun builds)
  const perf = globalThis.performance as any;
  if (perf && typeof perf.memory === "object") {
    snap.usedJSHeapSize = perf.memory.usedJSHeapSize;
    snap.jsHeapSizeLimit = perf.memory.jsHeapSizeLimit;
  }

  return snap;
}

/** Timer-based periodic memory tracker. */
export class PeriodicMemoryTracker {
  private tracker: MemoryTracker;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(intervalMs = 5000, maxSnapshots = 300) {
    this.tracker = new MemoryTracker(maxSnapshots);
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tracker.record(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTracker(): MemoryTracker {
    return this.tracker;
  }
}
