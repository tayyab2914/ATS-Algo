# ATS-ALGO

Next.js 16 (App Router) + Prisma 7 on Supabase Postgres, with an execution
engine that places orders on Bitget through ccxt.

## Local development

```bash
cp .env.example .env.local     # fill in — DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY at minimum
npm install                    # postinstall runs prisma generate
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

The scheduled reconcile pass does not run on its own in dev. Start it in a
second terminal once the server is up:

```bash
npm run cron:local
```

## Deployment

Single EC2 instance, no Docker: `next start` behind nginx, with systemd owning
the process and the schedules. Postgres stays on Supabase.

**[deploy/README.md](deploy/README.md)** is the runbook — instance sizing through
cutover checklist. Routine deploys are `sudo -u ats -H /srv/ats-algo/deploy/update.sh`.

Two things that bite if missed:

- `APP_URL` must be the real public origin. The server refuses to boot without
  it in production ([lib/app-url.ts](lib/app-url.ts)) because every emailed
  verification and reset link is built from it.
- `STATIC_EGRESS_IP` must equal the Elastic IP the box actually egresses from —
  it's what members whitelist on their exchange API keys. Verify with
  `npx tsx scripts/verify-egress.ts` after any infrastructure change.

## Layout

| Path | What's there |
| --- | --- |
| `app/` | Routes, server components, API handlers |
| `lib/execution/` | The order path: dispatch, ccxt client, reconcile, stop ladder |
| `lib/exchanges/` | Per-venue key validation |
| `prisma/` | Schema and migrations |
| `scripts/` | `verify-*` proofs and `e2e-*` walkthroughs (point at `APP_URL`) |
| `deploy/` | systemd units, nginx config, update script, runbook |

## Notes for contributors

This repo tracks a Next.js version newer than most training data — read the
relevant guide under `node_modules/next/dist/docs/` before writing code. See
[AGENTS.md](AGENTS.md).
