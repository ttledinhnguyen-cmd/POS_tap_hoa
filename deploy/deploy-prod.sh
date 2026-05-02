#!/usr/bin/env bash
# =============================================================================
# deploy-prod.sh — Production deploy với migrations + health check
# =============================================================================
# Khác với deploy.sh (code-only quick update), script này:
#   1. Pull code mới
#   2. Chạy pending migrations Supabase (npx supabase db push)
#   3. Rebuild + restart containers (docker compose down → up --build)
#   4. Health check curl https://$DOMAIN
#
# Yêu cầu trên server:
#   - .env có DOMAIN=, ACME_EMAIL= đã set
#   - SUPABASE_ACCESS_TOKEN env hoặc đã `supabase login --token <sbp_*>`
#   - Project đã linked: `supabase link --project-ref lidkbryncjlwqquadywn`
#
# Sử dụng: ./deploy/deploy-prod.sh
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env nếu có (cần cho DOMAIN)
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a
  . ./.env
  set +a
fi

DOMAIN="${DOMAIN:-pos.example.com}"

echo "📥 [1/4] Pull code mới..."
git pull --ff-only

echo ""
echo "🗄️  [2/4] Chạy pending migrations Supabase..."
if command -v npx >/dev/null 2>&1; then
  npx supabase db push --linked || {
    echo "⚠️  Migration push fail. Kiểm tra:"
    echo "    - SUPABASE_ACCESS_TOKEN env hoặc supabase login --token"
    echo "    - supabase link --project-ref lidkbryncjlwqquadywn"
    exit 1
  }
else
  echo "⚠️  npx không có trên server. Skip migrations — phải chạy thủ công từ máy dev:"
  echo "    cd <project> && npx supabase db push"
fi

echo ""
echo "🔨 [3/4] Rebuild + restart containers..."
docker compose down
docker compose up -d --build
docker image prune -f

echo ""
echo "⏳ Đợi container ready (30s)..."
sleep 30

echo ""
echo "🩺 [4/4] Health check..."
if curl -fsS -o /dev/null -w "HTTP %{http_code}\n" "https://$DOMAIN"; then
  echo "✅ Deploy xong. App live tại https://$DOMAIN"
else
  echo "⚠️  Health check fail. Kiểm tra:"
  echo "    docker compose logs -f"
  echo "    DNS đúng A record về server IP?"
  echo "    Caddy đã xin Let's Encrypt cert chưa?"
  exit 1
fi
