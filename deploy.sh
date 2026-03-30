#!/bin/bash
# KBO Props — Refresh data, build, and deploy to Vercel
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KBO Props — Refresh & Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Run data pipeline (continue even if some scrapers fail)
echo ""
echo "▶ Step 1: Refreshing data..."
"$DIR/venv/bin/python" "$DIR/refresh.py" "$@" || echo "⚠ Some pipeline steps failed — continuing with cached data"

# Step 2: Build the UI
echo ""
echo "▶ Step 2: Building site..."
cd "$DIR/kbo-props-ui"
npx vite build || { echo "✗ Build failed"; exit 1; }

# Step 3: Deploy to Vercel (link to kbo-props project after each build wipes dist/)
echo ""
echo "▶ Step 3: Deploying to Vercel..."
mkdir -p "$DIR/kbo-props-ui/dist/.vercel"
cat > "$DIR/kbo-props-ui/dist/.vercel/project.json" << 'EOF'
{"projectId":"prj_HgdvsekuqCfqzKYvGAUD6gQi36AW","orgId":"team_NsMEVaPP3l5Ouz0DWr1y9cxU"}
EOF
cd "$DIR/kbo-props-ui/dist"
vercel --yes --prod || { echo "✗ Deploy failed"; exit 1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Deploy complete!"
echo "  https://kbo-props.vercel.app"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
