# Deploying ATS-ALGO to EC2 (no Docker)

A single EC2 instance running `next start` behind nginx, with systemd owning the
process and the schedules, and RDS PostgreSQL in the same availability zone.
This is the only supported deployment target — the app has no platform-specific
code left.

## Infrastructure

| | |
| --- | --- |
| Region / AZ | `eu-central-1` / `eu-central-1a` (app and database co-located) |
| App | `t3.small`, Ubuntu 24.04, Elastic IP `18.197.98.119` |
| Database | RDS PostgreSQL 17, `db.t4g.micro`, encrypted, 7-day backups |
| App security group | `sg-0ca94ca5f2fbd8698` — 80/443 public, 22 from the admin IP |
| DB security group | `sg-04969e05896145a6a` — 5432 from the app's group only |

The database has **no public endpoint**. It is reachable only from the app's
security group, so there is no internet-facing surface to brute-force and no
route in that does not go through the app server first. Deletion protection is
on; removing the instance requires disabling that first, deliberately.

## 1. Instance

- **t3.small minimum, t3.medium recommended.** `next build` OOMs on a 1 GB
  t3.micro. On t3.small add 2 GB of swap first.
- Attach an **Elastic IP**. This becomes the address members whitelist on their
  exchange API keys — if it changes, their keys start rejecting our calls.
- Security group: 443 and 80 open, 22 from your address only.
  **Never open 3000** — the app binds to loopback and only nginx reaches it.

## 2. Base packages (Ubuntu 24.04)

```bash
sudo apt update && sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs           # Next 16 requires Node >= 20.9
sudo useradd -r -m -d /srv/ats-algo -s /bin/bash ats
```

## 3. Environment file

Secrets live at `/etc/ats-algo/env`, outside the repo directory, `0600` and
owned by `ats`. Start from `.env.example` — it has an EC2 section at the bottom
covering everything below.

```bash
sudo install -d -m 0755 /etc/ats-algo
sudo install -o ats -g ats -m 0600 /dev/null /etc/ats-algo/env
sudo -e /etc/ats-algo/env
```

The four that are deployment-specific:

```bash
APP_URL="https://yourdomain.com"        # the server refuses to boot without it
CRON_SECRET="<openssl rand -base64 32>" # authorizeCron fails closed without it
STATIC_EGRESS_IP="<your Elastic IP>"    # what members whitelist on their keys
DATABASE_POOL_MAX="10"
```

`NEXT_PUBLIC_*` are inlined into the client bundle at **build** time, so this
file has to be sourced for the build, not just for the running service.
`update.sh` does that.

## 4. First deploy

`/srv/ats-algo` is the `ats` user's home and already contains skel dotfiles, so
`git clone` into it fails. Initialize in place:

```bash
sudo -u ats -H bash -c '
  set -euo pipefail
  cd /srv/ats-algo
  git init -q -b master
  git remote add origin https://github.com/tayyab2914/ATS-Algo.git
  git fetch -q origin master
  git checkout -q -f -b master FETCH_HEAD
  git branch --set-upstream-to=origin/master master

  set -a; . /etc/ats-algo/env; set +a
  npm ci --include=dev        # postinstall runs prisma generate
  npx prisma migrate deploy   # uses DIRECT_URL via prisma.config.ts
  npm run build
'
```

**`--include=dev` is not optional.** The env file sets `NODE_ENV=production`,
and sourcing it before `npm ci` makes npm skip devDependencies on its own — no
`--omit=dev` needed. The build needs them (tailwind, typescript), and fails with
`Cannot find module '@tailwindcss/postcss'` without it.

## 5. systemd

```bash
sudo install -m 0755 /srv/ats-algo/deploy/ats-cron /usr/local/bin/ats-cron
sudo install -m 0644 /srv/ats-algo/deploy/ats-*.service /etc/systemd/system/
sudo install -m 0644 /srv/ats-algo/deploy/ats-*.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ats-algo
sudo systemctl enable --now ats-reconcile.timer ats-reconcile-deep.timer
```

Check: `systemctl list-timers 'ats-*'` and `journalctl -u ats-reconcile -f`.

`update.sh` restarts the service, so let the `ats` user do that one thing:

```bash
echo 'ats ALL=(root) NOPASSWD: /bin/systemctl restart ats-algo' \
  | sudo install -m 0440 /dev/stdin /etc/sudoers.d/ats-algo
```

### Why timers and not crontab

`Type=oneshot` plus systemd's rule that a unit can't start while it's still
active gives overlap protection for free. At a one-minute reconcile cadence a
slow exchange round-trip would otherwise stack passes on top of each other.

### There is no keep-warm timer

ccxt is imported once at server boot by `instrumentation.ts`, so no member's
order pays the ~679 ms import and nothing needs pinging to stay warm. Boot logs
`[boot] ccxt warm via bitget-only in NNNms` — if you don't see that line, the
warm failed and the first trade will be slow (it still works).

## 6. nginx + TLS

```bash
sudo install -m 0644 /srv/ats-algo/deploy/nginx.conf /etc/nginx/sites-available/ats-algo
sudo sed -i 's/yourdomain.com/<your real domain>/g' /etc/nginx/sites-available/ats-algo
sudo ln -sf /etc/nginx/sites-available/ats-algo /etc/nginx/sites-enabled/ats-algo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your real domain>
```

certbot rewrites the server block in place to add the 443 listener and the
80 → 443 redirect. Run it **after** the file is installed, not before.

## 7. Cutover checklist

- [ ] Stripe: point the webhook at `https://yourdomain.com/api/stripe/webhook`
      and swap `STRIPE_WEBHOOK_SECRET` — the signing secret is per-endpoint, the
      old one will not verify.
- [ ] Tell existing members the whitelist IP changed to the Elastic IP, or their
      IP-restricted exchange keys start failing auth.
- [ ] Confirm `STATIC_EGRESS_IP` matches real egress:
      `sudo -u ats -H npx tsx scripts/verify-egress.ts` (run from `/srv/ats-algo`).
- [ ] DNS A record → Elastic IP.
- [ ] Cancel any static-IP egress proxy subscription (QuotaGuard/Fixie) — the
      Elastic IP replaces it and the app has no proxy support left.

## Routine deploys

```bash
sudo -u ats -H /srv/ats-algo/deploy/update.sh
```

## Notes

- **Database URL.** Keep `DATABASE_URL` on Supabase's transaction pooler (6543);
  `lib/db.ts` documents why. Migrations keep using `DIRECT_URL`.
- **Boot failures.** `instrumentation.ts` throws if `APP_URL` is unset or
  localhost in production, so the unit won't start. That's deliberate — the
  alternative is days of verification emails linking to localhost.
- **Sandboxing.** `ats-algo.service` runs with `ProtectSystem=strict` and only
  `.next` writable. If you add anything that writes elsewhere on disk you'll see
  `EROFS`; add a `ReadWritePaths=` line rather than loosening `ProtectSystem`.
- **Logs.** Everything goes to the journal: `journalctl -u ats-algo -f`.
