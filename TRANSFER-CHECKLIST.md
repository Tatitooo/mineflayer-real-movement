# Transfer Checklist — Windows Target Machine (RX 7900 XTX + 7950X3D)

> Use this checklist when the target Windows machine is available to complete Phase 7.

---

## Pre-Flight (Before First Boot)

- [ ] Confirm Windows has Git, Bun, and Node.js 20+ installed
- [ ] Confirm Java 17+ installed (`java -version`)
- [ ] Confirm GitHub repo is cloned or source is transferred
- [ ] Confirm OBS Studio installed (29+) with NVENC/AMF encoder
- [ ] Confirm DaVinci Resolve installed (free version ok)
- [ ] Confirm Minecraft 1.20.4 client with OptiFine or Sodium
- [ ] Confirm Replay Mod installed in client (for free-camera post-capture)

---

## Server Setup

- [ ] Run `server-setup/download-server.sh` (Git Bash / WSL)
- [ ] If Vulcan download fails, purchase and place `Vulcan.jar` in `server/plugins/`
- [ ] Copy `server-setup/server.properties` and `eula.txt` into `server/`
- [ ] Start server: `cd server && java -Xms1G -Xmx2G -jar paper-1.20.4-496.jar nogui`
- [ ] Verify bot can connect: `bun run scripts/demo-walk-test.ts`
- [ ] Build demo maps near spawn:
  - [ ] Parkour course at ~(50, 64, 0)
  - [ ] Ice momentum track at ~(100, 64, 0)
  - [ ] PvP arena at ~(0, 64, 50)
  - [ ] Elytra tower at ~(-50, 64, 0)
  - [ ] Forest escape route at ~(0, 64, -50)
- [ ] Save world backup: zip `server/demo-world/`

---

## Demo Execution

- [ ] **Escena A — Hook side-by-side**: `bun run demo:side-by-side`
  - Record 3 takes in OBS (scene: 3rd person behind both bots)
- [ ] **Escena B — AABB precision**: manual spectate + debug overlay
  - Use `F3+B` for vanilla hitboxes; compare with our debug renderer
- [ ] **Escena C — Parkour**: `bun run demo:parkour`
  - Record with Replay Mod for slow-mo freedom
- [ ] **Escena D — Ice momentum**: `bun run demo:escape` (customize for ice)
  - Record 5 attempts, keep best take
- [ ] **Escena E — Humanization metrics**: `bun run demo:anticheat`
  - Enable `metrics-collector.ts` JSON export before run
- [ ] **Escena F — PvP**: `bun run demo:pvp`
  - Requires human opponent or second bot; record 30 min, cut best combos
- [ ] **Escena G — Elytra**: manual launch from tower
  - Record with Replay Mod for flight trajectory replay
- [ ] **Escena H — Anti-cheat stress test**: `bun run demo:anticheat`
  - Run for 5 min; capture server console logs
- [ ] **Escena I — Escape chase**: `bun run demo:escape`
  - Cinematic chase music; cut for tension
- [ ] **Escena J — Benchmarks**: `bun run benchmark`
  - Screen-record terminal output; also capture generated charts

---

## Post-Production

- [ ] Export all OBS recordings to lossless or high-quality intermediate
- [ ] Export Replay Mod camera paths to MP4
- [ ] Render telemetry overlays:
  ```bash
  python video-production/render-telemetry.py metrics/anticheat-demo.json -o frames/
  ```
- [ ] Composite telemetry in DaVinci Resolve (overlay track)
- [ ] Record narration voice-over (Audacity or DaVinci Fairlight)
- [ ] Sync narration to video cuts
- [ ] Add subtitles (English + Spanish)
- [ ] Color grade: cinematic dark look
- [ ] Music: royalty-free epic/electronic, side-chain duck to narration
- [ ] Thumbnail: bot silhouette vs human silhouette, text "INDISTINGUISHABLE"
- [ ] Export final: 1440p60, H.264 or H.265, bitrate ≥ 25 Mbps
- [ ] Upload to YouTube with tags: minecraft, mineflayer, bot, pathfinding, anti-cheat

---

## Post-Upload

- [ ] Update README with YouTube video link
- [ ] Update task `06-Cron/Active/004-mineflayer-real-movement.md` → move to Completed
- [ ] Tweet / post announcement with video link
- [ ] Monitor comments for first 48h, reply to technical questions

---

## Known Risks & Fallbacks

| Risk | Fallback |
|------|----------|
| Bot fails during demo | Record 3 takes per scene; use Replay Mod for re-camera |
| Anti-cheat install fails | GrimAC is open-source and auto-downloads; Vulcan optional |
| OBS capture drops frames | Lower CQP to 20; use AMD AMF encoder on RX 7900 XTX |
| Replay Mod crashes | Record live OBS as primary; Replay Mod as bonus |
| Human opponent unavailable | Use second bot with simple orbit pattern |

---

*Last updated: 2026-05-17*
