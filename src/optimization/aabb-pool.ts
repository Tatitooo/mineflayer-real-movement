import { ObjectPool, PooledObject } from "./object-pool";

/** Minimal AABB interface for pooling (avoids importing prismarine-physics class). */
export interface AABBLike {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Pooled AABB to reduce GC in collision hot paths. */
export class PooledAABB implements AABBLike, PooledObject {
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;

  reset(): void {
    this.minX = 0;
    this.minY = 0;
    this.minZ = 0;
    this.maxX = 0;
    this.maxY = 0;
    this.maxZ = 0;
  }

  /** In-place set from min/max coordinates. */
  set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): this {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    return this;
  }

  /** In-place copy from another AABB. */
  copyFrom(other: AABBLike): this {
    this.minX = other.minX;
    this.minY = other.minY;
    this.minZ = other.minZ;
    this.maxX = other.maxX;
    this.maxY = other.maxY;
    this.maxZ = other.maxZ;
    return this;
  }

  /** Compute width. */
  width(): number {
    return this.maxX - this.minX;
  }

  /** Compute height. */
  height(): number {
    return this.maxY - this.minY;
  }

  /** Compute depth. */
  depth(): number {
    return this.maxZ - this.minZ;
  }

  /** Translate in-place by (dx,dy,dz). */
  translate(dx: number, dy: number, dz: number): this {
    this.minX += dx;
    this.minY += dy;
    this.minZ += dz;
    this.maxX += dx;
    this.maxY += dy;
    this.maxZ += dz;
    return this;
  }

  /** Expand in-place by (dx,dy,dz) on all sides (like grow). */
  expand(dx: number, dy: number, dz: number): this {
    this.minX -= dx;
    this.minY -= dy;
    this.minZ -= dz;
    this.maxX += dx;
    this.maxY += dy;
    this.maxZ += dz;
    return this;
  }
}

/** Global AABB pool for the movement engine. */
export const aabbPool = new ObjectPool<PooledAABB>({
  factory: () => new PooledAABB(),
  initialSize: 128,
  maxSize: 2048,
  name: "AABBPool",
});

/** Convenience: acquire a pooled AABB and initialize it. */
export function acquireAABB(
  minX = 0,
  minY = 0,
  minZ = 0,
  maxX = 0,
  maxY = 0,
  maxZ = 0
): PooledAABB {
  const box = aabbPool.acquire();
  box.set(minX, minY, minZ, maxX, maxY, maxZ);
  return box;
}

/** Release a pooled AABB back to the pool. */
export function releaseAABB(box: PooledAABB): void {
  aabbPool.release(box);
}
