#!/usr/bin/env bash
# download-server.sh — Download PaperMC 1.20.4 + anti-cheat plugins for demo server
# Run on target Windows machine (Git Bash / WSL / MSYS2) or Linux server

set -euo pipefail

PAPER_VERSION="1.20.4"
PAPER_BUILD="496"  # last 1.20.4 build, verify at https://papermc.io/downloads/all
PAPER_JAR="paper-${PAPER_VERSION}-${PAPER_BUILD}.jar"

GRIMAC_URL="https://github.com/GrimAnticheat/Grim/releases/download/2.3.67/grimac-2.3.67.jar"
VULCAN_URL="https://www.spigotmc.org/resources/vulcan-anti-cheat-advanced-cheat-detection-1-7-1-21-4.83626/download"  # requires Spigot account; fallback link below

mkdir -p server/plugins

echo "[1/4] Downloading PaperMC ${PAPER_VERSION} build ${PAPER_BUILD}..."
if [ ! -f "server/${PAPER_JAR}" ]; then
    curl -L -o "server/${PAPER_JAR}" \
        "https://api.papermc.io/v2/projects/paper/versions/${PAPER_VERSION}/builds/${PAPER_BUILD}/downloads/${PAPER_JAR}"
else
    echo "  Already exists, skipping."
fi

echo "[2/4] Downloading GrimAC..."
if [ ! -f "server/plugins/grimac.jar" ]; then
    curl -L -o "server/plugins/grimac.jar" "${GRIMAC_URL}"
else
    echo "  Already exists, skipping."
fi

echo "[3/4] Downloading Vulcan..."
echo "  NOTE: Vulcan requires a SpigotMC account or purchase."
echo "  If automated download fails, manually place Vulcan jar in server/plugins/"
if [ ! -f "server/plugins/Vulcan.jar" ]; then
    # Attempt direct download (often fails due to Cloudflare / auth)
    curl -L -o "server/plugins/Vulcan.jar" "${VULCAN_URL}" || {
        echo "  WARNING: Vulcan download failed. Please download manually from:"
        echo "  https://www.spigotmc.org/resources/vulcan-anti-cheat-advanced-cheat-detection-1-7-1-21-4.83626/"
        rm -f "server/plugins/Vulcan.jar"
    }
else
    echo "  Already exists, skipping."
fi

echo "[4/4] Copying server config templates..."
cp server-setup/server.properties server/server.properties 2>/dev/null || true
cp server-setup/eula.txt server/eula.txt 2>/dev/null || true

echo ""
echo "Done. To start the server:"
echo "  cd server && java -Xms1G -Xmx2G -jar ${PAPER_JAR} nogui"
