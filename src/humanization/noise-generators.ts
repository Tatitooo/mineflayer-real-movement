/**
 * Coherent noise generators for humanizing bot movement.
 *
 * Provides:
 * - Perlin noise (2D/3D) for smooth variation
 * - Simplex noise (faster, less directional artifacts)
 * - Gaussian noise for random jitter
 * - Bounded Brownian motion for aim drift
 *
 * All functions use deterministic seeds so each bot session is statistically
 * unique while reproducible for debugging.
 */

/**
 * Linear interpolation between a and b by factor t (0..1).
 */
function lerp (a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Smoothstep easing: 0..1 with zero derivatives at boundaries.
 */
function fade (t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Hash an integer to a pseudo-random float in [0,1).
 */
function hashInt (n: number): number {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return Math.floor(x)
}

/**
 * 2D gradient vector from hash.
 */
function grad2 (hash: number, x: number, y: number): number {
  const h = hash & 3
  const u = h < 2 ? x : y
  const v = h < 2 ? y : x
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

/**
 * 3D gradient vector from hash.
 */
function grad3 (hash: number, x: number, y: number, z: number): number {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

/**
 * Permutation table for Perlin noise (classic 256 + overflow).
 */
function makePermutationTable (seed: number): number[] {
  const p: number[] = []
  for (let i = 0; i < 256; i++) p[i] = i
  // Fisher-Yates shuffle with seeded PRNG
  for (let i = 255; i > 0; i--) {
    const j = Math.abs(hashInt(seed + i * 374761)) % (i + 1)
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  // Duplicate for overflow
  return p.concat(p)
}

/**
 * Perlin noise generator (2D and 3D) with seeded permutation table.
 */
export class PerlinNoise {
  private readonly perm: number[]

  constructor (seed: number = Math.random() * 65536) {
    this.perm = makePermutationTable(seed)
  }

  /**
   * Sample 2D Perlin noise at (x, y). Returns value in [-1, 1].
   */
  sample2D (x: number, y: number): number {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)

    const u = fade(xf)
    const v = fade(yf)

    const aa = this.perm[this.perm[xi] + yi]
    const ab = this.perm[this.perm[xi] + yi + 1]
    const ba = this.perm[this.perm[xi + 1] + yi]
    const bb = this.perm[this.perm[xi + 1] + yi + 1]

    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u)
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u)
    return lerp(x1, x2, v)
  }

  /**
   * Sample 3D Perlin noise at (x, y, z). Returns value in [-1, 1].
   */
  sample3D (x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const zi = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)

    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const aaa = this.perm[this.perm[this.perm[xi] + yi] + zi]
    const aba = this.perm[this.perm[this.perm[xi] + yi + 1] + zi]
    const aab = this.perm[this.perm[this.perm[xi] + yi] + zi + 1]
    const abb = this.perm[this.perm[this.perm[xi] + yi + 1] + zi + 1]
    const baa = this.perm[this.perm[this.perm[xi + 1] + yi] + zi]
    const bba = this.perm[this.perm[this.perm[xi + 1] + yi + 1] + zi]
    const bab = this.perm[this.perm[this.perm[xi + 1] + yi] + zi + 1]
    const bbb = this.perm[this.perm[this.perm[xi + 1] + yi + 1] + zi + 1]

    const y1 = lerp(grad3(aaa, xf, yf, zf), grad3(baa, xf - 1, yf, zf), u)
    const y2 = lerp(grad3(aba, xf, yf - 1, zf), grad3(bba, xf - 1, yf - 1, zf), u)
    const y3 = lerp(grad3(aab, xf, yf, zf - 1), grad3(bab, xf - 1, yf, zf - 1), u)
    const y4 = lerp(grad3(abb, xf, yf - 1, zf - 1), grad3(bbb, xf - 1, yf - 1, zf - 1), u)

    const z1 = lerp(y1, y2, v)
    const z2 = lerp(y3, y4, v)
    return lerp(z1, z2, w)
  }

  /**
   * Fractal Brownian Motion (FBM) combining multiple octaves.
   * Higher octaves = more detail. Lacunarity controls frequency gap.
   * Returns value roughly in [-1, 1] (amplitude decreases per octave).
   */
  fbm2D (x: number, y: number, octaves: number = 4, lacunarity: number = 2.0, gain: number = 0.5): number {
    let total = 0
    let amplitude = 1
    let frequency = 1
    let maxValue = 0
    for (let i = 0; i < octaves; i++) {
      total += amplitude * this.sample2D(x * frequency, y * frequency)
      maxValue += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return total / maxValue
  }
}

/**
 * Simplex noise generator (2D and 3D).
 * Faster than Perlin, with less directional artifacts.
 */
export class SimplexNoise {
  private readonly perm: number[]
  private readonly grad3Table: number[][] = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
  ]

  constructor (seed: number = Math.random() * 65536) {
    this.perm = makePermutationTable(seed)
  }

  /**
   * Sample 2D Simplex noise at (x, y). Returns value in [-1, 1].
   */
  sample2D (xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0)
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0

    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const X0 = i - t
    const Y0 = j - t
    const x0 = xin - X0
    const y0 = yin - Y0

    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1

    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1.0 + 2.0 * G2
    const y2 = y0 - 1.0 + 2.0 * G2

    const ii = i & 255
    const jj = j & 255
    const gi0 = this.perm[ii + this.perm[jj]] % 12
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12

    let n0 = 0, n1 = 0, n2 = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 >= 0) {
      t0 *= t0
      n0 = t0 * t0 * (this.grad3Table[gi0][0] * x0 + this.grad3Table[gi0][1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 >= 0) {
      t1 *= t1
      n1 = t1 * t1 * (this.grad3Table[gi1][0] * x1 + this.grad3Table[gi1][1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 >= 0) {
      t2 *= t2
      n2 = t2 * t2 * (this.grad3Table[gi2][0] * x2 + this.grad3Table[gi2][1] * y2)
    }

    return 70.0 * (n0 + n1 + n2)
  }
}

/**
 * Box-Muller transform: two independent standard normal variates from uniform randoms.
 */
export function gaussianPair (rng: () => number = Math.random): [number, number] {
  let u = 0, v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const mag = Math.sqrt(-2.0 * Math.log(u))
  const z0 = mag * Math.cos(2.0 * Math.PI * v)
  const z1 = mag * Math.sin(2.0 * Math.PI * v)
  return [z0, z1]
}

/**
 * Single Gaussian sample with mean and standard deviation.
 */
export function gaussian (mean: number, stdDev: number, rng: () => number = Math.random): number {
  return mean + gaussianPair(rng)[0] * stdDev
}

/**
 * Clamp a value between min and max.
 */
export function clamp (value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Bounded Brownian motion: random walk with soft bounds.
 * Useful for simulating aim drift that doesn't escape the target area.
 *
 * @param current Current position
 * @param stepSize Max change per step
 * @param bounds [min, max] hard limits
 * @param pullBack Strength of restoring force toward center (0 = none)
 * @param center Center of the target area
 * @param rng Random function
 */
export function boundedBrownianStep (
  current: number,
  stepSize: number,
  bounds: [number, number],
  pullBack: number,
  center: number,
  rng: () => number = Math.random
): number {
  const delta = (rng() - 0.5) * 2 * stepSize
  let next = current + delta
  // Pull-back toward center
  next += (center - next) * pullBack
  return clamp(next, bounds[0], bounds[1])
}

/**
 * Easing functions for acceleration curves.
 */
export const Easing = {
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  smoothstep: (t: number): number => t * t * (3 - 2 * t)
} as const
