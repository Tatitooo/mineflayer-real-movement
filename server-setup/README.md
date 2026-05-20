# Server Setup for mineflayer-real-movement Demos

Pre-configured PaperMC 1.20.4 server with anti-cheat plugins for local testing and video capture.

## Quick Start

```bash
# 1. Download server jar + plugins
./server-setup/download-server.sh

# 2. Accept EULA (already set to true in template)
cp server-setup/eula.txt server/eula.txt

# 3. Copy server properties
cp server-setup/server.properties server/server.properties

# 4. Start server
cd server
java -Xms1G -Xmx2G -jar paper-1.20.4-496.jar nogui
```

## What Gets Downloaded

| File | Purpose |
|------|---------|
| `paper-1.20.4-496.jar` | PaperMC server (optimized Spigot fork) |
| `plugins/grimac.jar` | GrimAC — open-source anti-cheat (movement checks) |
| `plugins/Vulcan.jar` | Vulcan — premium anti-cheat (purchase required) |

## Server Configuration

- **Port**: 25565
- **Online mode**: `false` (bots can connect without Mojang auth)
- **Spawn protection**: `0` (bots can place/break at spawn)
- **PvP**: enabled
- **Difficulty**: normal

## Anti-Cheat Notes

### GrimAC
- Free, open-source. Downloaded automatically by script.
- Default config flags unrealistic movement (no-clip, high velocity, bad rotations).
- Our humanization layer is designed to pass GrimAC checks.

### Vulcan
- Premium plugin (~$20). Requires manual purchase from SpigotMC.
- If automated download fails, place `Vulcan.jar` in `server/plugins/` manually.
- Vulcan checks are stricter; passing both GrimAC + Vulcan = high confidence.

## Building Demo Maps

The video capture plan requires several custom areas. Build these near spawn (0, ~, 0) for easy bot access:

| Area | Coordinates | Description |
|------|-------------|-------------|
| Parkour course | (50, 64, 0) | Gaps 1-3 blocks, ladder jumps, fence vaults |
| Ice momentum track | (100, 64, 0) | 8-block ice strip → 4-5 block gap |
| PvP arena | (0, 64, 50) | 20×20 flat stone platform with barriers |
| Elytra tower | (-50, 64, 0) | 80-block tower + water landing pool |
| Forest escape route | (0, 64, -50) | Trees, river, cave entrance, ladder, roof exit |

Use `/gamemode creative` to build quickly. Save the world folder (`server/demo-world/`) for re-use.

## Bot Connection

```typescript
const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'DemoBot',
  version: '1.20.4'
})
```

No premium account needed (`online-mode=false`).
