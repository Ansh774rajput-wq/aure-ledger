# Aure Ledger: Phase 7 Release Checklist & Verification

This document provides the release-readiness status, production data decision paths, automated test evidence, and the physical device testing script for **Aure Ledger**.

---

## 1. Production Data Decision

The development database (`lending`) contains:
- **15 Persons**
- **10 Loans** (active and historical)
- **3 Borrowings**
- **8 Payments**
- **32 Pool Transactions** (Net pool balance: ₹6,28,000.00)
- **47 Audit Logs**

**CRITICAL RULE**: Do not assume these are genuine owner records. Development/test records must **NOT** be copied into production.

### Path A: Fresh Production Database (Recommended Default)
Use this path to deploy a pristine ledger for real-world operations without dummy/test data:
1. Deploy schema migrations to the empty production database:
   ```bash
   DATABASE_URL="postgresql://.../aure_prod" npm run db:migrate
   ```
2. Run the fresh production initialization script (initializes 100% empty ledger with ₹0 pool balance):
   ```bash
   DATABASE_URL="postgresql://.../aure_prod" npx tsx scripts/init-fresh-production.ts
   ```
3. *Adding Real Opening Capital*:
   Real opening capital is added **ONLY** after the owner provides its explicit amount and date:
   - **Via Web UI**: Sign in with owner password on the deployed application, tap **Add Capital**, enter amount and transaction date.
   - **Via Initializer CLI** (optional):
     ```bash
     DATABASE_URL="postgresql://.../aure_prod" \
     INITIAL_CAPITAL="<amount_provided_by_owner>" \
     ENTRY_DATE="<YYYY-MM-DD>" \
     npx tsx scripts/init-fresh-production.ts
     ```
4. Verify that the production ledger initializes with 0 dummy loans, 0 dummy borrowings, 0 dummy movements, and 100% mathematical reconciliation health.

### Path B: Reviewed Historical Data Migration
Use this path ONLY IF the owner inspects the development ledger records and confirms they represent genuine historical transactions:
1. Create a certified backup archive:
   ```bash
   ./scripts/backup-db.sh
   ```
2. Execute the reviewed data migration script:
   ```bash
   CONFIRM_MIGRATE=true TARGET_DATABASE_URL="postgresql://.../aure_prod" \
   npx tsx scripts/migrate-reviewed-data.ts
   ```
3. The script verifies all 10 loans, 3 borrowings, 8 payments, and 32 pool movements, checks mathematical reconciliation, and writes an immutable audit record logging the migration.

---

## 2. Completed Phase 7 Release Verification Checks

| Category | Requirement | Implementation / Evidence | Status |
| :--- | :--- | :--- | :--- |
| **Origin Security** | Production requires configured HTTPS origin | `sameOrigin()` in `src/infrastructure/auth.ts` strictly requires `https://` matching `APP_ORIGIN`; loopback convenience is disabled in `NODE_ENV === "production"`. | **VERIFIED** |
| **Rate Limiting** | Sign-in brute force protection | Shared PostgreSQL rate limiting (`SignInRateLimit` table) via atomic upsert (`INSERT ... ON CONFLICT ("ip") DO UPDATE`) with in-memory fallback. Max 5 failed attempts per 15 min per IP. Enforces rate limits atomically across serverless Vercel instances. | **VERIFIED** |
| **Cache Control** | Prevent private financial caching | `PRIVATE_HEADERS` (`no-store, no-cache, must-revalidate, private, max-age=0`) applied to all private API routes and statements. | **VERIFIED** |
| **Cookie Flags** | Secure session storage | `HttpOnly`, `SameSite=Strict`, `Secure` (in prod), `Path=/`, 8h expiry. Secrets rotated with cryptographically secure random bytes; old sessions invalidated. | **VERIFIED** |
| **Health Check** | Minimal private-safe probe | `GET /api/health` returns HTTP 200 `{ "status": "healthy" }` without leaking passwords, tokens, or database details. | **VERIFIED** |
| **PWA Manifest** | Standalone Android install | `public/manifest.json` configured with standalone mode, theme `#111315`, and high-res icons (192, 512, maskable 512). | **VERIFIED** |
| **Offline Blocking**| Financial writes blocked offline without queues | `ledger-app.tsx` blocks submissions immediately if `!navigator.onLine` without queueing writes. Tested in Playwright (`phase7-offline-uncertain.spec.ts`). | **VERIFIED** |
| **Uncertain Submissions** | Lost response retries reuse key | Repayment, early settlement, and payment reversals reuse original `idempotencyKey` and preserve payload during connection loss. Zero duplicate writes. Verified in Playwright. | **VERIFIED** |
| **SW Cache Audit** | Zero private financial caching in SW | `public/sw.js` passes `/api/*` directly to network. Inspected `window.caches` in Playwright: strictly zero private API endpoints or financial data cached. | **VERIFIED** |
| **Snapshot Isolation** | RepeatableRead MVCC safeguard | Restored `RepeatableRead` on `snapshot()`. Added PostgreSQL integration regression test proving concurrent mutations cannot produce mixed before/after states. | **VERIFIED** |
| **Dependency Audit** | Zero high-severity vulnerabilities | Overrides applied for `deepmerge-ts@^8.0.2` and `mysql2@^3.24.5`. `npm audit` reports `found 0 vulnerabilities`. | **VERIFIED** |
| **Signature** | Creator brand preservation | Exact signature `"adonis's creation"` preserved in UI, footer, offline page, and test suite. | **VERIFIED** |
| **Backups** | Serverless & local backup workflows | `.github/workflows/backup.yml` for scheduled (02:00 UTC daily) and on-demand offsite backups to encrypted GitHub Artifacts (90-day retention, 0 disk required); `scripts/backup-db.sh` for manual local snapshots. | **VERIFIED** |
| **Restore Verification**| Disposable database restore certification | `scripts/restore-and-verify-backup.ts` restored archive into disposable DB, verified 8 migrations, 11 table counts, reconciliation, and live mutation. Source untouched. | **VERIFIED** |
| **Build & Types** | Zero compiler errors | `npm run typecheck` passed (0 errors); `npm run build` compiled clean Turbopack production bundle. | **VERIFIED** |

---

## 3. Physical Real-Device Testing Script

> **IMPORTANT STATUS DISTINCTION**:
> - **Executed**: Automated browser suite (54 tests across Chromium Desktop 1440x1000 and Mobile Pixel 7 390x844 viewports), unit suite (181 tests), and integration suite (92 tests) have all passed locally.
> - **Pending Work**: Physical real-device testing on the owner's Android phone and developer's iPhone remains **pending** until the application is deployed to an independent HTTPS URL.

### A. Owner's Android Device (Google Chrome)
1. **PWA Installation**:
   - Navigate to the HTTPS URL in Google Chrome.
   - Tap the browser menu (⋮) -> **Install app** (or **Add to Home screen**).
   - Verify app icon displays the gold "A" emblem with charcoal background.
   - Tap the Home screen icon; confirm it launches in **standalone mode** (no URL bar or browser chrome).
2. **Theme & Safe Area**:
   - Verify Android status bar and navigation bar match the theme color (`#111315`).
   - Verify typography and charcoal-and-gold styling are sharp and legible on AMOLED screens.
3. **Authentication & Rate Limiting**:
   - Enter an incorrect password 5 times in succession; verify HTTP 429 rate-limiting message appears.
   - Enter the correct owner password; verify immediate login and session cookie persistence.
4. **Touch & Form Experience (360–412px)**:
   - Tap "Disburse loan" and "Record repayment". Verify buttons are easy to tap (min 44px height).
   - Tap amount inputs; verify Android opens the numeric decimal keypad.
   - Verify dialogs can be scrolled smoothly without being obstructed by the soft keyboard.
5. **Network Interruption & Retries**:
   - Open repayment modal on a test loan in staging. Fill in details.
   - Enable **Airplane Mode** on the phone.
   - Tap "Confirm repayment". Verify the app displays a clear offline warning and does **NOT** attempt or queue a write.
   - Disable Airplane Mode.
   - If connection drops mid-flight, verify the app shows "Check the same submission" and reuses the duplicate-protection key without duplicate charges.
6. **Payment Reversal Flow**:
   - Go to Activity tab, select a test payment, tap "Reverse".
   - Confirm warning explanation, enter reason, toggle confirmation, and submit.
   - Verify balances update and the audit log records the compensating movement.
7. **Offline Behavior**:
   - Turn off Wi-Fi and mobile data. Refresh the page.
   - Verify the branded `offline.html` page appears with `"adonis's creation"` and the "Live Connection Required" safeguard notice.
8. **Logout**:
   - Tap "Sign out". Verify session cookie is cleared and app returns to the welcome screen.

### B. Developer's iPhone Device (Safari)
1. **Home Screen Installation**:
   - Open HTTPS URL in Safari.
   - Tap Share (square with arrow) -> **Add to Home Screen**.
   - Launch from Home screen; verify fullscreen display with `viewport-fit=cover`.
2. **Notch & Dynamic Island Safe Area**:
   - Verify top header content is not clipped by the camera notch or Dynamic Island.
   - Verify bottom navigation bar has adequate padding above the iOS home indicator bar.
3. **Visual Inspection**:
   - Verify dark mode contrast and signature `"adonis's creation"`.

---

## 4. Hosting Recommendation & Deployment Next Steps

### Selected Hosting: Vercel Hobby + Neon Free Tier (Strictly ₹0 / Month)

- **Architecture**:
  - **Vercel Hobby Plan**: $0.00 / month (Hobby personal use, Serverless Functions with 60s timeout, automated SSL certificates, free `*.vercel.app` canonical origin).
  - **Neon Free Tier**: $0.00 / month (No credit card required, 0.5 GB storage, 100 CU-hours compute/month, 5 GB network egress, PgBouncer connection pooling on port 6543, direct migrations on port 5432).
  - **GitHub Actions (Backups)**: $0.00 / month (2,000 free runner minutes/month, automated daily `pg_dump` with 90-day artifact retention).
  - **Total Monthly Cost**: **Strictly ₹0.00 / month**.
- **Documentation Sources**:
  - Vercel Pricing & Free Limits: [https://vercel.com/pricing](https://vercel.com/pricing)
  - Neon Free Tier Limits & Features: [https://neon.tech/docs/introduction/plans](https://neon.tech/docs/introduction/plans)
  - Neon Connection Pooling & Prisma: [https://neon.tech/docs/guides/prisma](https://neon.tech/docs/guides/prisma)

### Prisma & Neon Technical Safeguards:
1. **Connection Splitting**:
   - `DATABASE_URL`: Pooled connection string (`...-pooler.region.neon.tech:6543/neondb?sslmode=require&pgbouncer=true`) for fast serverless queries and cold-start resilience.
   - `DIRECT_URL`: Unpooled direct connection string (`...region.neon.tech:5432/neondb?sslmode=require`) in `prisma.config.ts` for schema DDL migrations (`npm run db:migrate`).
2. **Transaction Isolation & Advisory Locks**:
   - Aure Ledger uses transaction-scoped `SELECT pg_advisory_xact_lock(67421901::bigint)` inside Prisma `$transaction`. This is fully compatible with PgBouncer transaction pooling.
   - Financial snapshots preserve point-in-time consistency with explicit `RepeatableRead` isolation.
3. **Multi-Instance Rate Limiting**:
   - Sign-in attempts are tracked atomically in shared PostgreSQL (`SignInRateLimit` table) via `INSERT ... ON CONFLICT ("ip") DO UPDATE` to block brute force attacks across serverless instances.

### Deployment Steps (Independent of Developer Mac):
1. **Push Code to GitHub**:
   - Create a private GitHub repository and push the Aure Ledger codebase.
2. **Create Free Database Projects on Neon**:
   - Sign up at [neon.tech](https://neon.tech) (free, no credit card required).
   - Create two independent projects:
     - `aure-ledger-staging` (for staging verification)
     - `aure-ledger-prod` (for real production)
   - In each project dashboard, copy the **Pooled connection string** (for `DATABASE_URL`) and the **Direct connection string** (for `DIRECT_URL`).
3. **Deploy Schema Migrations to Production**:
   - Run from developer machine targeting the Neon direct connection:
     ```bash
     DIRECT_URL="postgresql://[user]:[password]@[endpoint]:5432/neondb?sslmode=require" npm run db:migrate
     ```
4. **Initialize Empty Production Database**:
   - Initialize the ledger with ₹0 pool balance and 0 dummy records:
     ```bash
     DATABASE_URL="postgresql://[user]:[password]@[endpoint]:5432/neondb?sslmode=require" npx tsx scripts/init-fresh-production.ts
     ```
5. **Deploy Web Application to Vercel**:
   - Sign up at [vercel.com](https://vercel.com) using GitHub account.
   - Import the GitHub repository (Framework Preset: **Next.js**).
   - Configure Environment Variables:
     - `DATABASE_URL`: Neon pooled connection string with `?sslmode=require&pgbouncer=true`
     - `DIRECT_URL`: Neon direct connection string with `?sslmode=require`
     - `APP_PASSWORD`: Strong password chosen by the owner
     - `SESSION_SECRET`: 64-char hex string (`openssl rand -hex 32`)
     - `APP_ORIGIN`: Assigned free Vercel domain (e.g. `https://aure-ledger.vercel.app`)
     - `NODE_ENV`: `production`
   - Click **Deploy**.
6. **Configure Automated Offsite Backups**:
   - In the GitHub repository settings -> **Secrets and variables** -> **Actions**:
     - Add Repository Secret: `DATABASE_URL` (Neon direct connection string).
   - The `.github/workflows/backup.yml` will run daily at 02:00 UTC (07:30 IST) or on manual click, saving compressed dumps with 90-day retention at ₹0.
7. **Perform Physical Real-Device Testing** (Section 3).
