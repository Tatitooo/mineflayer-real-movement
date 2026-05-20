import { Vec3 } from "vec3";
import { ObjectPool, PooledObject } from "./object-pool";

/** Pooled Vec3 to reduce GC in physics hot paths. */
export class PooledVec3 extends Vec3 implements PooledObject {
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }

  /** In-place update; returns this for chaining. */
  setxyz(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  /** In-place copy from another Vec3. */
  copyFrom(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
}

/** Global Vec3 pool for the movement engine. */
export const vec3Pool = new ObjectPool<PooledVec3>({
  factory: () => new PooledVec3(0, 0, 0),
  initialSize: 256,
  maxSize: 4096,
  name: "Vec3Pool",
});

/** Convenience: acquire a pooled Vec3 and initialize it. */
export function acquireVec3(x = 0, y = 0, z = 0): PooledVec3 {
  const v = vec3Pool.acquire();
  v.setxyz(x, y, z);
  return v;
}

/** Release a pooled Vec3 back to the pool. */
export function releaseVec3(v: PooledVec3): void {
  vec3Pool.release(v);
}
