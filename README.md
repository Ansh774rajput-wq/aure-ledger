# Aure Ledger

A mobile-first personal Loan Management System. This is a fresh Next.js / TypeScript / PostgreSQL / Prisma modular monolith.

**First slice implemented, not production-certified:** the financial domain, schema, migration, capital/people prerequisites, and atomic loan-disbursement code are present. PostgreSQL could not run in the authoring container. Real persistence, FK behavior, locking, audit rollback, and transaction rollback remain unverified. Read DEVELOPMENT_STATUS.md before using real money.

## What works now

- Explore a clearly labeled, read-only sample ledger without a database.
- Mobile bottom navigation; dashboard, searchable borrower loans, loan details, people, accounting conventions and feature-scope views.
- Owner authentication via signed HttpOnly cookies; same-origin mutation checks.
- Once PostgreSQL is available: add capital, add/reuse people with borrower/lender roles, and disburse loans through implemented server endpoints. These write flows still need the real database gate below.
- Loan agreement preserves principal, rate, explicit interest method, dates and original agreed interest.
- `adonis's creation` appears quietly at the bottom of More → Aure Ledger.

## Reproduce locally (Node 24 LTS and Docker Compose)

Run inside this directory:

```bash
npm ci
node scripts/configure-local.mjs
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm test
npm run dev
```

Open http://localhost:3000. The private `.env` contains the generated `APP_PASSWORD`; use it to sign in. The setup script preserves an existing `.env`. Never share it. Docker credentials in compose.yaml and .env.example are local development defaults, not production secrets. The database port binds only to localhost.

If PostgreSQL is provided externally, use `.env.example` as the template and configure DATABASE_URL, APP_PASSWORD, SESSION_SECRET (at least 32 random characters), and APP_ORIGIN. Set TEST_DATABASE_URL separately. Do not use the production database for integration tests.

## Real PostgreSQL verification gate

Create a separate, disposable test database whose name ends in `_test`:

```bash
docker compose exec db createdb -U lending lending_test
npm run test:integration
```

`createdb` is a one-time setup command; an already-existing database does not need recreating. The integration harness applies the real migration to TEST_DATABASE_URL, truncates all app tables between cases, installs test-only triggers, and removes those triggers on completion. This is intentionally destructive to the test database. The harness refuses a database whose name does not end in `_test`.

Ten real tests cover: matching disbursement writes; nonexistent-borrower FK rejection; a forced second-write failure with an insert witness; audit rollback; idempotent replay; key/payload conflict; concurrent insufficient-funds protection; duplicate UTR warning; immutable history; chronological cash posting. These did not execute in the authoring environment. There is no mock or in-memory database fallback.

## Other commands

```bash
npm test                 # domain, application and authentication tests
npm run typecheck        # TypeScript
npm run build            # generate real Prisma client + production Next build
npm start                # serve production build on localhost:3000
npx playwright install chromium
npm run test:e2e          # desktop + Android-sized browser checks
npx prisma validate      # schema syntax validation
```

Browser tests include explicitly labeled mocked-API form tests. They are UI tests, not PostgreSQL integration proof. For a preinstalled Chromium binary, set PLAYWRIGHT_CHROMIUM_EXECUTABLE to its absolute path.

## First live workflow, after the database gate passes

1. Sign in, then **Add own capital** with amount, effective date and reason.
2. **Add a person** with a borrower role. Reuse an existing person to add a second role.
3. **Disburse loan** with borrower, whole-rupee principal, rate, explicit interest method and dates.
4. Review the original agreed interest, then confirm. The operation creates the loan, pool movement and audit record together.
5. If a response is unconfirmed, keep the form open and use **Check the same submission**. Its key and payload remain fixed. Do not start a fresh submission merely because a response was lost.

The ledger uses the Asia/Kolkata calendar date and PostgreSQL DATE values for cash/contract dates. It does not post future cash movements or cash dates before the latest pool movement. Amounts posted in this slice are whole rupees. Domain Money supports two decimal places; official interest uses half-up rounding to ₹1.

## Structure

| Path | Responsibility |
|---|---|
| src/domain/finance.ts | Decimal money, dates, interest, allocation, closure and adjustments |
| src/application/disburse.ts | Complete input validation before the financial gateway |
| src/infrastructure/database.ts | Real generated Prisma client with PostgreSQL adapter |
| src/infrastructure/ledger.ts | Transactions, pool balance, locking, idempotency, audits, prerequisite commands |
| src/infrastructure/auth.ts | Owner session and same-origin guards |
| src/app/api/ | Protected reads, command dispatch and sessions |
| src/components/ | Mobile UI and clearly labeled sample data |
| prisma/ | Core schema, generated initial SQL and explicit SQL constraints |
| tests/ | Unit/application/auth, real PostgreSQL harness, browser tests |
| scripts/configure-local.mjs | Non-destructive local environment setup |
| docs/ | Screenshots and captured verification results |

## Scope and operating limits

Borrowings, payments, adjustments and equity withdrawals have schema foundations, but only own-capital additions, people/roles and loan disbursement are exposed as write flows. Repayments, borrowing posting, early-close posting, reversals, reports, notifications, PWA installation, backups and restore are not implemented. Until payment posting is added, the dashboard reports original principal of ACTIVE contracts and zero interest received; update its aggregation in the same slice as payment posting.

This is a single-owner, single-ledger app. The sign-in throttle is in process and is not sufficient for public multi-instance deployment. Use HTTPS and a least-privilege runtime DB role before deployment. Do not expose the local development server to the internet. No public site or hosted database was deployed during this execution.

Source-of-truth documents: PROJECT_CONTEXT.md, REQUIREMENTS.md, ARCHITECTURE.md, DOMAIN_RULES.md, DECISIONS.md, DEVELOPMENT_STATUS.md and HANDOFF.md. DELIVERY_REPORT.md is the execution report; FILE_MANIFEST.txt lists every delivered file.
