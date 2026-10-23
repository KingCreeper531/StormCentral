# Operations

Two scheduled workflows keep an eye on things, so a broken token or a lost
database doesn't go unnoticed.

## Daily health check

`.github/workflows/health.yml` runs `shorts/health.ts` every day at 12:40 UTC
(8:40 AM EDT, 7:40 AM EST), and on demand from **Actions → Health check → Run
workflow**. It checks:

| Check | A problem when |
|---|---|
| Facebook Page token | it's invalid, or it expires (or its data access does) within 10 days |
| YouTube refresh token | Google rejects it |
| Latest YouTube upload | nothing went up in the last 30 hours |
| Claude API key | rejected (a warning only: the Shorts fall back to the plain script) |
| www and app sites | they don't answer 2xx |
| Posting workflows | 3 or more failed runs of the Shorts, breaking news or Facebook workflows in 24 hours (1 or 2 is a warning) |

A problem fails the run, so GitHub sends one email; the run's summary lists
every check and what to do. A check whose secret isn't set is skipped. It uses
the secrets the posting workflows already have; nothing new to add.

## Nightly database backup

`.github/workflows/backup.yml` runs `scripts/backup-db.ts` every day at
07:20 UTC. It writes the whole database (the schema, then every row, as SQL),
gzips it and encrypts it with AES-256-GCM under a key derived from a
passphrase, and keeps it as the run's artifact for 30 days. An artifact
without the passphrase is useless to anyone who gets hold of it.

**Switch it on** with three repository secrets (Settings → Secrets and
variables → Actions):

- `DATABASE_URL` and `DATABASE_AUTH_TOKEN`: the same Turso values the site
  uses (Vercel → the project → Settings → Environment Variables; the Turso
  integration names them `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`).
- `BACKUP_PASSPHRASE`: any long passphrase. Keep a copy somewhere safe (a
  password manager): without it no backup can be opened.

Until they're set the workflow just notes that it has nothing to do.

**Restore:**

1. Download the `database-backup-…` artifact from a run of **Database backup**
   and unzip it.
2. Build the script and decrypt:
   ```bash
   npx esbuild scripts/backup-db.ts --bundle --platform=node --format=esm --external:@libsql/client --outfile=backup-db.mjs
   BACKUP_PASSPHRASE='…' node backup-db.mjs decrypt backup.sql.gz.enc   # writes backup.sql
   ```
3. Load it into an empty database: `turso db shell <database> < backup.sql`,
   or `sqlite3 local.db < backup.sql` for a local copy.
