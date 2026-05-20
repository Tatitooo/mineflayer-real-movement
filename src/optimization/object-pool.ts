/** Generic object pool for reducing GC pressure in hot paths. */
export interface PooledObject {
  reset(): void;
}

export interface ObjectPoolConfig<T extends PooledObject> {
  factory: () => T;
  initialSize?: number;
  maxSize?: number;
  name?: string;
}

export class ObjectPool<T extends PooledObject> {
  private available: T[] = [];
  private inUse = 0;
  private factory: () => T;
  private maxSize: number;
  private name: string;
  private totalCreated = 0;
  private totalReused = 0;

  constructor(config: ObjectPoolConfig<T>) {
    this.factory = config.factory;
    this.maxSize = config.maxSize ?? 1024;
    this.name = config.name ?? "Pool";

    const initial = config.initialSize ?? 64;
    for (let i = 0; i < initial; i++) {
      const obj = this.factory();
      this.available.push(obj);
      this.totalCreated++;
    }
  }

  acquire(): T {
    if (this.available.length > 0) {
      const obj = this.available.pop()!;
      this.inUse++;
      this.totalReused++;
      return obj;
    }

    if (this.inUse >= this.maxSize) {
      throw new Error(
        `[${this.name}] Pool exhausted: maxSize=${this.maxSize}. ` +
          `Consider increasing maxSize or checking for leaks.`
      );
    }

    const obj = this.factory();
    this.inUse++;
    this.totalCreated++;
    return obj;
  }

  release(obj: T): void {
    obj.reset();
    this.inUse--;
    if (this.available.length < this.maxSize) {
      this.available.push(obj);
    }
    // If pool is at maxSize, dropped object will be GC'd — that's fine.
  }

  /** Release multiple objects in one call. */
  releaseMany(objs: T[]): void {
    for (const obj of objs) {
      this.release(obj);
    }
  }

  getMetrics(): PoolMetrics {
    return {
      name: this.name,
      available: this.available.length,
      inUse: this.inUse,
      totalCreated: this.totalCreated,
      totalReused: this.totalReused,
      reuseRatio:
        this.totalCreated === 0
          ? 0
          : this.totalReused / (this.totalReused + this.totalCreated),
    };
  }

  clear(): void {
    this.available.length = 0;
    this.inUse = 0;
  }
}

export interface PoolMetrics {
  name: string;
  available: number;
  inUse: number;
  totalCreated: number;
  totalReused: number;
  reuseRatio: number;
}
