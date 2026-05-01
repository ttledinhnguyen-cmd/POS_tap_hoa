#!/usr/bin/env bash
# Script deploy đơn giản. Chạy trên server.
# Sử dụng: ./deploy/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "📥 Pull code mới..."
git pull --ff-only

echo "🔨 Build và start container..."
docker compose up -d --build

echo "🧹 Dọn image cũ..."
docker image prune -f

echo "✅ Deploy xong. Kiểm tra: docker compose logs -f"
