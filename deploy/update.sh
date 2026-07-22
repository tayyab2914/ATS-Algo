#!/usr/bin/env bash
# deploy/update.sh — pull, migrate, rebuild, restart. Run as the `ats` user:
#
#   sudo -u ats -H /srv/ats-algo/deploy/update.sh
#
# `next build` writes into the same .next/ the running server is reading, so
# there is a short window where the old process serves a half-replaced build.
# The restart at the end closes it; the blip is a few seconds. If you need true
# zero-downtime, build into a versioned directory and flip a symlink instead.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/ats-algo}"
ENV_FILE="${ENV_FILE:-/etc/ats-algo/env}"

cd "$APP_DIR"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Cannot read $ENV_FILE — the build inlines NEXT_PUBLIC_* and migrations need DIRECT_URL." >&2
  exit 1
fi

# Export everything: `next build` inlines NEXT_PUBLIC_* into the client bundle,
# and prisma.config.ts reads DIRECT_URL from process.env.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

echo "==> Fetching"
git pull --ff-only

echo "==> Installing (postinstall runs prisma generate)"
npm ci

echo "==> Applying migrations"
npx prisma migrate deploy

echo "==> Building"
npm run build

echo "==> Restarting"
sudo systemctl restart ats-algo

# Liveness only: any HTTP response means the server bound and is rendering.
# Deliberately no `-f` — this asks "is it up", not "is this route a 200", and
# app/api/health/ is currently an empty directory with no route in it.
for _ in $(seq 1 30); do
  if curl -sS -m 2 http://127.0.0.1:3000/ -o /dev/null; then
    echo "==> Up"
    exit 0
  fi
  sleep 1
done

echo "Server did not answer within 30s — check: journalctl -u ats-algo -n 50" >&2
exit 1
