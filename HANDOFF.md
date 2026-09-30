# Handoff: Aure Ledger

## Current Phase and Task

Phase 7: **Release Preparation for Android / HTTPS Production Use** is **COMPLETE**.
The application is fully prepared for the owner to use on Android via an HTTPS URL, independently of the developer's Mac. Local preparation, security hardening, dependency vulnerability elimination, offline safeguards, idempotency preservation across lost connections, backup/restore procedures, and automated regression suites are certified.

Next agent task: Await user creation of free hosting accounts (Vercel Hobby + Neon Free Tier, strictly ₹0 / month), deploy staging HTTPS test environment, provide owner-specified opening capital amount and date, and perform physical real-device testing on the owner's Android phone.

---

## Completed Phase 7 Work & Architecture

### 1. Production Security & Safeguards Hardening
- **Strict HTTPS Origin Enforcement**:
  - `sameOrigin()` in `src/infrastructure/auth.ts` strictly enforces `https://` matching `APP_ORIGIN` in production. Local loopback convenience (`localhost`, `127.0.0.1`) is disabled in production.
- **RepeatableRead MVCC Snapshot Safeguard**:
  - `snapshot()` in `src/infrastructure/ledger.ts` executes point-in-time reads across all balances, loans, borrowings, and movements under an explicit `RepeatableRead` transaction.
  - Verified with real PostgreSQL integration test proving concurrent transactions cannot produce mixed before/after states.
- **Shared PostgreSQL Sign-in Rate Limiting Across Serverless Instances**:
  - `src/infrastructure/rate-limiter.ts` implements a multi-instance rate limiter backed by the `SignInRateLimit` PostgreSQL table using atomic SQL upsert (`INSERT ... ON CONFLICT ("ip") DO UPDATE`).
  - Limits failed sign-ins to maximum 5 attempts per 15-minute sliding window per IP. Concurrent serverless requests increment the counter atomically without race conditions. Failed attempts return HTTP 429 with `Retry-After`. Successful logins automatically clear the record. Resilient in-memory fallback activates if the database is unreachable.
- **Private Financial Caching Prevention**:
  - `PRIVATE_HEADERS` (`Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`) are applied to all private endpoints.
  - Verified via browser test: `window.caches` contains strictly zero `/api/*` endpoints.
- **Secure Cookie Flags & Credentials Rotation**:
  - Session cookies enforce `HttpOnly`, `SameSite=Strict`, `Path=/`, 8-hour expiry, and `Secure` flag on HTTPS origins.
  - Credentials rotated locally in `.env` (file mode `0600`) with cryptographically secure random bytes. Stale sessions invalidated.
- **Dependency Audit Resolution**:
  - Investigated the 4 HIGH dependency findings in `deepmerge-ts` and `mysql2`. Traced dependency paths through `@prisma/config` and `prisma`.
  - Applied package overrides: `"deepmerge-ts": "^8.0.2"`, `"mysql2": "^3.24.5"`.
  - `npm audit` reports `found 0 vulnerabilities`. Verified clean build and execution with Prisma 7.

### 2. Android PWA & Offline / Uncertain Safeguards
- **Web App Manifest & Icons**:
  - `public/manifest.json` configured for `standalone` display with `#111315` theme and background colors.
  - High-resolution icons generated: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, and `icon.svg`.
- **Branded Offline Fallback**:
  - `public/offline.html` displays a charcoal-and-gold offline screen explaining that financial submissions require a live server connection.
  - Preserves exact signature: `"adonis's creation"`.
- **Offline Financial Submissions Blocked**:
  - `src/components/ledger-app.tsx` inspects `navigator.onLine` on all financial submissions (repayment, disbursement, borrowing, capital, reversal, early settlement).
  - Submissions while offline are blocked immediately with a clear alert; no background writes or queues are created. Verified in Playwright.
- **Idempotency Key Preservation Across Network Loss**:
  - When the server commits a transaction but the connection drops before the browser receives confirmation, `submission.current.input` and `reversalSubmission.current.input` are preserved.
  - The UI displays an unconfirmed submission notice and a retry button ("Check the same submission" / "Retry Reversal") while disabling form inputs.
  - Verified with 3 end-to-end Playwright tests: retried repayments, early settlements, and reversals send the identical `idempotencyKey` and create zero duplicate records or movements in PostgreSQL.

### 3. PostgreSQL Backup & Disaster Recovery Architecture
- **Serverless GitHub Actions Backups (`.github/workflows/backup.yml`)**:
  - Zero persistent server disk required: connects directly to Neon, runs `pg_dump -Fc` using PostgreSQL 17 client, and uploads encrypted backup artifact.
  - Automatically triggered daily at 02:00 UTC (07:30 IST) and on manual 1-click `workflow_dispatch`.
  - Backups retained offsite for 90 days on GitHub's free tier (2,000 free runner minutes/month; daily backup uses ~15 minutes/month = <1%).
- **Manual Snapshots (`scripts/backup-db.sh`)**:
  - Creates custom-format transactional dump (`pg_dump -Fc`) with `chmod 600` permissions.
- **Scheduled Automated Backups (`scripts/scheduled-backup.sh`)**:
  - Automated script suitable for cron (`0 2 * * *`).
  - Automatically prunes local snapshots older than `RETENTION_DAYS` (default: 30 days).
  - Traps failures and dispatches alert payload to `ALERT_WEBHOOK_URL`.
  - Supports offsite cloud storage transfer (S3 / Cloudflare R2 / Backblaze B2) when configured.
- **Disposable Restore Verification (`scripts/restore-and-verify-backup.ts`)**:
  - Restores backup archive into an isolated disposable test database.
  - Verifies 8 schema migrations, 11 table counts, pool balances, full mathematical reconciliation, and executes a live test mutation.
  - Tears down disposable database cleanly; source database remains 100% untouched.

### 4. Production Setup & Data Decisions
- **Path A: Fresh Production Database (Recommended Default)**:
  - `scripts/init-fresh-production.ts`: Starts with a 100% empty ledger (0 loans, 0 borrowings, 0 pool movements).
  - Default ₹5,00,000 opening capital and fixed sample dates removed.
  - Real opening capital is injected only after the owner provides its explicit amount and date.
  - Verified on a disposable database: initializes empty and reconciles 100% healthy.
- **Path B: Reviewed Historical Migration (`scripts/migrate-reviewed-data.ts`)**:
  - For use only if the owner confirms development records represent genuine historical transactions.

---

## Certified Test Evidence

- **Unit Suite**: **188 passed / 0 failed / 0 skipped** across 11 test files (`npm test`), including `tests/rate-limiter.test.ts`.
- **PostgreSQL Integration Suite**: **92 passed / 0 failed / 0 skipped** (`npm run test:integration`), including RepeatableRead snapshot isolation regression test.
- **Playwright Browser Suite**: **54 passed / 0 failed / 0 skipped** (`npm run test:e2e`) across Desktop Chrome (1440x1000) and Mobile Pixel 7 (390x844) viewports:
  - `ledger.spec.ts`: 16 passed
  - `phase6-screenshots.spec.ts`: 4 passed
  - `phase6.spec.ts`: 8 passed
  - `phase7-offline-uncertain.spec.ts`: 10 passed (offline block, lost response retry for repayment/settlement/reversal, service-worker cache audit)
  - `repayment-submission.spec.ts`: 6 passed
  - `screenshots.spec.ts`: 4 passed
  - `settlement-submission.spec.ts`: 6 passed
- **TypeScript**: Passed with 0 errors (`npm run typecheck`).
- **Production Build**: Passed with code 0 (`npm run build` using Next.js 16 Turbopack).
- **Dependency Audit**: `found 0 vulnerabilities` (`npm audit`).
- **Backup & Disposable Restore**: Passed with code 0 (`scripts/restore-and-verify-backup.ts`).
- **Empty Production Initialization**: Verified with code 0 on disposable database.

---

## Remaining Release Blockers (Awaiting Deployment & Owner Input)

1. **Owner-Provided Opening Capital & Date**:
   - The production database will initialize empty. The owner must provide the exact opening capital amount (₹) and transaction date to inject via the web UI or initializer script.
2. **Hosting Account & Resource Provisioning**:
   - Deployment to independent ₹0 free tiers (Vercel Hobby + Neon Free Tier, strictly ₹0 / month). Awaiting owner or developer creation of free accounts.
3. **Physical Device Testing**:
   - Real-device testing on the owner's Android phone (standalone PWA install, numeric keypad, offline airplane mode test) and developer's iPhone (Safari Dynamic Island / notch safe area) remains pending until deployed to the HTTPS URL.
4. **Offsite Backup Storage Credentials `[Optional]`**:
   - Automated cloud transfer in `scripts/scheduled-backup.sh` awaits S3 / Cloudflare R2 bucket credentials (`S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Note that serverless GitHub Actions offsite backups are already fully functional at ₹0 without external bucket storage.
