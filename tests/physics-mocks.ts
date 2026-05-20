import { Vec3 } from 'vec3'
import type { BlockCollisionInfo, CollisionWorld } from '../src/core/types'

/**
 * A simple in-memory mock world for unit tests.
 * Stores blocks by integer position and returns them via getBlock.
 */
export class MockWorld implements CollisionWorld {
  private readonly blocks = new Map<string, BlockCollisionInfo>()

  /**
   * Set a block at the given integer coordinates.
   */
  setBlock (x: number, y: number, z: number, info: Omit<BlockCollisionInfo, 'position'>): void {
    this.blocks.set(`${x},${y},${z}`, { position: new Vec3(x, y, z), ...info })
  }

  /**
   * Remove a block at the given coordinates.
   */
  removeBlock (x: number, y: number, z: number): void {
    this.blocks.delete(`${x},${y},${z}`)
  }

  /**
   * Clear all blocks.
   */
  clear (): void {
    this.blocks.clear()
  }

  getBlock (pos: Vec3): BlockCollisionInfo | null {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    return this.blocks.get(key) ?? null
  }

  /**
   * Fill a rectangular region with a single block type.
   */
  fill (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, info: Omit<BlockCollisionInfo, 'position'>): void {
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setBlock(x, y, z, info)
        }
      }
    }
  }
}

/**
 * Create a flat ground plane at y = 0 stretching from -50 to 50 on X/Z.
 */
export function createFlatGround (world: MockWorld, groundY = 0, size = 10): void {
  world.fill(-size, groundY, -size, size, groundY, size, {
    name: 'stone',
    stateId: 1,
    boundingBox: 'block',
    shapes: [[0, 0, 0, 1, 1, 1]]
  })
}

/**
   * Create a simple tree obstacle.
   */
export function createTree (world: MockWorld, x: number, z: number, trunkY = 1, height = 4): void {
  for (let y = trunkY; y < trunkY + height; y++) {
    world.setBlock(x, y, z, {
      name: 'oak_log',
      stateId: 100,
      boundingBox: 'block',
      shapes: [[0, 0, 0, 1, 1, 1]]
    })
  }
  // Leaves
  for (let ly = trunkY + height - 2; ly < trunkY + height + 1; ly++) {
    for (let lx = x - 1; lx <= x + 1; lx++) {
      for (let lz = z - 1; lz <= z + 1; lz++) {
        if (lx === x && lz === z && ly < trunkY + height) continue
        world.setBlock(lx, ly, lz, {
          name: 'oak_leaves',
          stateId: 200,
          boundingBox: 'block',
          shapes: [[0, 0, 0, 1, 1, 1]]
        })
      }
    }
  }
}
