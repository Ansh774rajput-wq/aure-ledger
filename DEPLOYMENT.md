# Aure Ledger: Production Deployment & Operations Guide (Vercel + Neon Free Tier)

This guide details the deployment architecture, host environment requirements, security configuration, migration protocols, and disaster recovery procedures for **Aure Ledger** running on **100% Free Hosting (₹0 / month)** using **Vercel Hobby** and **Neon Free Tier**.

---

## 1. Zero-Cost Hosting Architecture (Strictly ₹0 / month)

| Component | Provider & Plan | Cost | Specifications & Limits |
| :--- | :--- | :--- | :--- |
| **Application & API** | **Vercel Hobby** | **₹0** | Serverless Next.js 16 (App Router), 60s function timeout, free `*.vercel.app` domain with automated SSL. Non-commercial personal use. |
| **Relational Database** | **Neon Free Tier** | **₹0** | PostgreSQL 17, 0.5 GB (500 MB) storage, 100 CU-hours compute/mo, up to 100 projects, 10 branches, auto-suspend after 5 min idle. No credit card required. |
| **Automated Backups** | **GitHub Actions** | **₹0** | Daily scheduled workflow (`pg_dump -Fc`), 2,000 free runner mins/mo, 90-day encrypted artifact retention. |
| **Total Monthly Cost** | | **₹0.00 / month** | **No credit card, no trials, no custom domain purchases, no billable extras.** |

---

## 2. Core Architectural Safeguards on Serverless + Neon

1. **Prisma Connection Splitting (`DATABASE_URL` vs `DIRECT_URL`)**:
   - **`DATABASE_URL` (Pooled Connection)**: Contains the `-pooler` host suffix. Used by Next.js serverless functions at runtime to pool database connections via PgBouncer.
   - **`DIRECT_URL` (Direct Connection)**: Bypasses PgBouncer directly to Neon compute. Used by Prisma Migrate (`npm run db:migrate`) for DDL schema migrations, which require direct session access.
2. **Neon Scale-to-Zero & Cold-Start Resilience**:
   - Neon Free auto-suspends compute after 5 minutes of inactivity to conserve CU-hours.
   - `src/infrastructure/database.ts` configures a **15,000ms (15s)** connection timeout (`connectionTimeoutMillis`) so that a waking database never causes requests to time out.
3. **Transaction-Level Advisory Locking (`pg_advisory_xact_lock`)**:
   - Financial mutations (disbursements, repayments, settlements, reversals, capital additions) acquire `pg_advisory_xact_lock(67421901::bigint)` inside `db.$transaction()`.
   - Because `pg_advisory_xact_lock` is transaction-scoped, it is **100% compatible with PgBouncer transaction pooling**. The lock is held exclusively on the connection for the transaction duration and released automatically upon `COMMIT` or `ROLLBACK`.
4. **RepeatableRead MVCC Snapshot Safeguard**:
   - Read-only financial statements, exports, and dashboard snapshots run inside explicit `RepeatableRead` transactions. PgBouncer transaction pooling pins the transaction to a single backend connection, guaranteeing consistent point-in-time reads.
5. **Shared PostgreSQL Sign-In Rate Limiter (`SignInRateLimit`)**:
   - Unlike ephemeral in-memory rate limiters that reset between serverless function invocations, Aure Ledger enforces sign-in rate limiting directly in shared PostgreSQL storage (`SignInRateLimit` table).
   - Atomic SQL upsert (`INSERT ... ON CONFLICT ("ip") DO UPDATE`) ensures that concurrent brute-force attempts from multiple serverless instances are incremented and blocked atomically. Max 5 failed attempts per 15-minute sliding window; returns HTTP 429 with `Retry-After`.

---

## 3. Environment Variables Checklist

Configure these variables in your Vercel Project Settings (**Settings** $\rightarrow$ **Environment Variables**):

| Variable | Target | Description | Example |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Production & Preview | Neon pooled connection string (with `-pooler`) | `postgresql://user:pass@ep-cool-fog-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Production & Preview | Neon direct connection string (unpooled) | `postgresql://user:pass@ep-cool-fog-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `APP_PASSWORD` | Production & Preview | Owner sign-in passphrase (min 20 characters) | `[REDACTED_STRONG_PASSPHRASE]` |
| `SESSION_SECRET` | Production & Preview | 64+ char cryptographically random hex string | Generated via `openssl rand -hex 32` |
| `APP_ORIGIN` | Production & Preview | Canonical HTTPS URL of the ledger | `https://your-app.vercel.app` |
| `NODE_ENV` | Production & Preview | Environment flag | `production` |

---

## 4. Staging vs. Production Setup (Both Free & Separated)

To maintain absolute safety without spending money, create two separate Neon projects under your free account (Neon permits up to 100 free projects):

1. **Production Project**: `aure-ledger-prod`
   - Database: `neondb`
   - Connected to Vercel **Production** environment (deploys from `main` branch $\rightarrow$ `https://your-app.vercel.app`).
2. **Staging Project**: `aure-ledger-staging`
   - Database: `neondb`
   - Connected to Vercel **Preview** environment (deploys from `staging` branch $\rightarrow$ `https://your-app-staging.vercel.app`).

Both projects are completely independent, have separate credentials, and start 100% empty.

---

## 5. Step-by-Step Beginner Deployment Guide

### Phase 1: Create Free Accounts (No Credit Card Required)
1. **GitHub**: [github.com/join](https://github.com/join) (stores your private code and runs free backups).
2. **Neon**: [neon.tech](https://neon.tech) (free serverless PostgreSQL 17).
3. **Vercel**: [vercel.com/signup](https://vercel.com/signup) (free Next.js hosting). Select the **Hobby** plan.

### Phase 2: Create Databases in Neon
1. In the Neon Console, click **New Project**.
2. Name it `aure-ledger-prod`. Select your preferred cloud region (e.g., Frankfurt `eu-central-1` or Singapore `ap-southeast-1`). Click **Create project**.
3. In the connection details modal, you will see your connection string.
   - For `DATABASE_URL`: Ensure **Pooled connection** checkbox is checked. Copy the URL.
   - For `DIRECT_URL`: Uncheck the **Pooled connection** checkbox. Copy the direct URL.
4. *(Optional Staging)*: Click **New Project** again. Name it `aure-ledger-staging`. Save its pooled and direct URLs.

### Phase 3: Push Code to Private GitHub Repository
1. In GitHub, click **New repository** $\rightarrow$ set to **Private** $\rightarrow$ name it `aure-ledger`.
2. Push your local codebase:
   ```bash
   git remote add origin https://github.com/<your-username>/aure-ledger.git
   git branch -M main
   git push -u origin main
   ```

### Phase 4: Deploy on Vercel
1. In the Vercel Dashboard, click **Add New...** $\rightarrow$ **Project**.
2. Import your `aure-ledger` repository from GitHub.
3. In **Build and Output Settings**:
   - Framework Preset: `Next.js`
   - Build Command: `npm run build` *(runs `prisma generate && next build`)*
   - Install Command: `npm install`
4. In **Environment Variables**, add the production secrets:
   - `DATABASE_URL`: Your Neon pooled connection string.
   - `DIRECT_URL`: Your Neon direct connection string.
   - `APP_PASSWORD`: Choose a strong owner password.
   - `SESSION_SECRET`: Generate a random hex string (run `openssl rand -hex 32` in terminal).
   - `APP_ORIGIN`: `https://<your-project-name>.vercel.app` (you can verify the exact URL after project creation).
   - `NODE_ENV`: `production`
5. Click **Deploy**. Vercel will compile and deploy your application in ~1 minute.

### Phase 5: Run Schema Migrations and Initialize Empty Ledger
From your local terminal, apply the 8 schema migrations to your Neon database using the direct connection:
```bash
DIRECT_URL="<your_neon_direct_url>" npm run db:migrate
```
Then initialize the empty production ledger:
```bash
DATABASE_URL="<your_neon_direct_url>" npx tsx scripts/init-fresh-production.ts
```
The script confirms that 8 migrations are applied, 0 dummy loans or movements exist, the pool balance is ₹0, and mathematical reconciliation is 100% HEALTHY.

### Phase 6: Inject Real Opening Capital
- Open your live `https://<your-project-name>.vercel.app` address in your browser.
- Sign in with your `APP_PASSWORD`.
- Tap **Add capital** to record your actual starting pool balance and effective date.

---

## 6. Free Automated Backup Workflow & Limitations

Because Vercel serverless functions have no persistent server disk, Aure Ledger includes an automated, serverless-native backup workflow via **GitHub Actions** ([`.github/workflows/backup.yml`](file:///.github/workflows/backup.yml)).

### How It Works:
1. Every day at 02:00 UTC (07:30 IST), GitHub Actions launches an Ubuntu runner.
2. The runner connects to Neon using `DATABASE_URL` stored in GitHub repository secrets.
3. Executes `pg_dump -Fc` with transactional consistency.
4. Uploads the backup dump as an encrypted GitHub Actions artifact retained for **90 days**.

### Setting Up the Free GitHub Backup:
1. In your GitHub repository, go to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**.
2. Click **New repository secret**.
3. Name: `DATABASE_URL`
4. Value: Your Neon direct or pooled connection string. Click **Add secret**.
5. To test immediately: Go to the **Actions** tab in GitHub $\rightarrow$ select **Scheduled Database Backup (Neon Free)** $\rightarrow$ click **Run workflow**.

### Scheduling & Retention Limitations:
- **Scheduling**: GitHub Actions cron triggers run within a best-effort 5–15 minute window of the scheduled time.
- **Artifact Retention**: Artifacts are automatically deleted after **90 days** (maximum free retention on GitHub). To retain annual backups permanently, download key archives locally or connect free Cloudflare R2 (10 GB free).
- **60-Day Inactivity Rule**: GitHub automatically disables scheduled workflows if the repository has zero commit activity for 60 days. If paused, GitHub sends an email notification with a 1-click button to resume.
- **Neon PITR Window**: Neon Free includes **24-hour Point-in-Time Restore**. For restorations older than 24 hours, rely on the GitHub Actions `.dump` artifacts.

### Manual Local Backup (Anytime):
Download a local `.dump` directly to your Mac:
```bash
DATABASE_URL="<your_neon_url>" ./scripts/backup-db.sh
```
This produces an owner-only (`chmod 600`) archive in `./backups/`.
