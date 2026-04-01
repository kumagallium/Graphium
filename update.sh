#!/usr/bin/env bash
# provnote update — pull latest images and rebuild
set -euo pipefail

echo "==> Pulling latest images..."
docker compose pull

echo "==> Rebuilding and restarting..."
docker compose up -d --build

echo ""
echo "Done! Services:"
echo "  provnote          http://localhost:5174/provnote/"
echo "  Crucible Agent    http://localhost:8090"
echo "  Crucible Registry http://localhost:8081"
