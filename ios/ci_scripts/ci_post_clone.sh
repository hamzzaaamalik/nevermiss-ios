#!/bin/sh
# Xcode Cloud post-clone build script for NeverMiss.
#
# Xcode Cloud's macOS runner finishes git-cloning the repo, then looks
# for `ios/ci_scripts/ci_post_clone.sh` and runs it. By the time Xcode
# Cloud invokes xcodebuild, we need:
#   - Node + pnpm installed
#   - JS deps fetched
#   - The Vite SPA built into dist/public/
#   - Capacitor's `cap sync ios` run so ios/App/App/public/ has the
#     latest index.html + assets
#   - CocoaPods installed against the latest Capacitor plugin versions
#
# Environment variables Xcode Cloud provides:
#   $CI_PRIMARY_REPOSITORY_PATH  — root of the cloned repo
#   $CI_WORKSPACE                — Xcode workspace
# (See https://developer.apple.com/documentation/xcode/environment-variable-reference)

set -e

echo "🟢 [ci_post_clone] start ($(date))"
echo "📁 CI_PRIMARY_REPOSITORY_PATH = $CI_PRIMARY_REPOSITORY_PATH"

# ─── Repo root ─────────────────────────────────────────────────────────
cd "$CI_PRIMARY_REPOSITORY_PATH"

# ─── Node 20 ───────────────────────────────────────────────────────────
# Xcode Cloud runners ship with Homebrew + recent Node, but we pin to
# v20 LTS for parity with local dev.
echo "📦 Installing Node 20 via Homebrew..."
brew install node@20
brew link --overwrite --force node@20

echo "node: $(node -v)"
echo "npm:  $(npm -v)"

# ─── pnpm ──────────────────────────────────────────────────────────────
echo "📦 Installing pnpm 10..."
npm install -g pnpm@10
echo "pnpm: $(pnpm -v)"

# ─── JS deps ───────────────────────────────────────────────────────────
echo "📦 pnpm install..."
pnpm install --no-frozen-lockfile

# ─── Build the Vite SPA against the live api host ─────────────────────
# Same env vars the local Windows build uses. VITE_API_BASE is what
# tells the SPA to hit https://api.nevermiss.family/api instead of the
# dev /api proxy.
export VITE_API_BASE="https://api.nevermiss.family/api"
export NODE_ENV="production"
export PORT="5173"
export BASE_PATH="/"

echo "🛠️  pnpm build (Vite production)..."
pnpm build

# ─── Sync SPA + Capacitor plugins into the iOS project ────────────────
echo "🔄 npx cap sync ios..."
npx cap sync ios

# ─── CocoaPods ────────────────────────────────────────────────────────
echo "🧱 pod install..."
cd ios/App
pod install --repo-update

echo "✅ [ci_post_clone] done ($(date))"
