# Narration Script — mineflayer-real-movement YouTube Video

> Target duration: 8–12 minutes  
> Language: English (with Spanish subtitles)  
> Tone: energetic, technical but accessible  

---

## Hook (0:00 – 0:15)

"Two players. One path. Can you tell which one is human?"

*(Side-by-side walk. Bot A jerky, Bot B fluid.)*

"If you guessed the smooth one — surprise. Both are bots. But only one of them is running real-movement."

---

## Intro (0:15 – 1:00)

"Minecraft bots have always moved like robots. Straight lines. Instant turns. Perfect timing. Until now.

This is mineflayer-real-movement: a movement engine that replicates real physics, momentum, and even the micro-tremor of human fingers. It is not an aimbot. It is not a fly hack. It is movement intelligence.

Built on prismarine-physics — which replicates vanilla tick-for-tick — we layer on three things: exact collision shapes, momentum-aware pathfinding, and a humanization filter that passes anti-cheats."

---

## Core Physics + AABB Precision (1:00 – 2:30)

"The foundation is blockCollisionShapes.json from minecraft-data. Four thousand three hundred twenty-seven unique collision shapes for Minecraft 1.20.

Most pathfinders treat every block as a generic one-by-two bounding box. We do not. A fence post is not a cube. A trapdoor edge is not a full block. Our Swept-AABB validator micro-simulates every frame between two points, so the bot knows exactly where a fence ends and air begins.

That means a bot can thread a 0.6-block gap — the exact width of the player hitbox — without touching the fence. Try that with a generic bounding box and you get a collision flag."

---

## Momentum-Aware Pathfinding (2:30 – 4:00)

"Standard A* assumes every step starts from zero velocity. That is not how Minecraft works.

We store exit velocity from every edge and feed it as entry velocity into the next. The result: the bot plans five-block jumps over ice because it knows momentum carries it.

Diagonal sprint gets a 1.3x multiplier. Long-gap edges are only generated when the simulation says the velocity is high enough. And if a block suddenly appears mid-path, dynamic re-planning reacts in under a hundred milliseconds."

---

## Humanization / Anti-Cheat (4:00 – 5:30)

"Human movement is not perfect. It has noise.

We inject Perlin noise into yaw and pitch, Gaussian delays of 150 to 300 milliseconds on reactions, and ease-in ease-out curves on every start and stop. WASD jitter simulates finger micro-corrections. Sprint drops randomly to fake fatigue.

The timing is ping-aware and TPS-synchronized. If the server is running at 18 ticks per second instead of 20, the bot matches it. No robotic 20-TPS perfection.

The result: zero flags on GrimAC and Vulcan after five minutes of continuous movement."

---

## PvP + Elytra (5:30 – 7:00)

"In combat, movement wins fights.

Orbital strafing with A and D micro-corrections. W-tap: release sprint for one tick, land the hit, re-sprint for extra knockback. S-tap for range control when the opponent closes in. Crit-jump timing synced to attack cooldown.

For distance: elytra launch from an 80-block tower, glide with pitch and yaw control, firework boost at the apex, and soft landing in water calculated from altitude and velocity."

---

## Benchmarks (7:00 – 8:30)

"Performance numbers. Pathfinding latency under 50 milliseconds for a 100-block route. Tick overhead below half a millisecond. Memory footprint under 80 megabytes per bot. And scaling to ten bots via child_process fork, one process each, with health checks and auto-restart.

All of this is open source. Link in the description. If you want a dev-log series breaking down every module, leave a comment. See you in the next one."

---

## Outro (8:30 – 10:00)

*(Demo chase sequence with music.)*

"Subscribe for more. Repo link below."

---

## Technical Notes for Editor

- B-roll footage should be cut to narration; do not linger on static screens.
- Slow-motion at 0.5× on all parkour jumps and W-taps.
- Music: royalty-free epic/electronic, volume ducking during narration.
- Subtitles: English (primary) + Spanish (secondary). Burn in Spanish.
