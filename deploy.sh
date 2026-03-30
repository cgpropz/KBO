#!/bin/bash
# KBO Props — Refresh data, build, and deploy to Vercel
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KBO Props — Refresh & Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Run data pipeline
echo ""
echo "▶ Step 1: Refreshing data..."
"$DIR/venv/bin/python" "$DIR/refresh.py" "$@"

# Step 2: Build the UI
echo ""
echo "▶ Step 2: Building site..."
cd "$DIR/kbo-props-ui"
npx vite build

# Step 3: Deploy to Vercel
echo ""
echo "▶ Step 3: Deploying to Vercel..."
cd "$DIR/kbo-props-ui/dist"
vercel --yes --prod

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Deploy complete!"
echo "  https://kbo-props.vercel.app"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
