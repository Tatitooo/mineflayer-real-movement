declare module 'prismarine-physics/lib/aabb' {
  class AABB {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number

    constructor (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number)
    clone (): AABB
    floor (): void
    extend (dx: number, dy: number, dz: number): this
    contract (x: number, y: number, z: number): this
    expand (x: number, y: number, z: number): this
    offset (x: number, y: number, z: number): this
    computeOffsetX (other: AABB, offsetX: number): number
    computeOffsetY (other: AABB, offsetY: number): number
    computeOffsetZ (other: AABB, offsetZ: number): number
    intersects (other: AABB): boolean
  }
  export = AABB
}
