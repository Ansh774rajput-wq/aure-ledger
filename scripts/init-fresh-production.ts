import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { addCapital, PrismaReconciliationGateway } from "../src/infrastructure/ledger";
import { runReconciliation } from "../src/application/reconcile";

/**
 * Aure Ledger - Fresh Production Initializer
 * Initializes a brand-new production database after `prisma migrate deploy`.
 * Ensures the production ledger starts completely empty (zero dummy loans, zero dummy borrowings, zero test movements).
 *
 * Default: Initializes a 100% empty ledger with ₹0 pool balance and 0 equity entries.
 * Real opening capital is added ONLY after the owner provides its explicit amount and date.
 *
 * Usage (Empty Ledger - Default):
 *   DATABASE_URL="postgresql://user:pass@host:5432/aure_prod" \
 *   npx tsx scripts/init-fresh-production.ts
 *
 * Usage (When owner provides opening capital):
 *   DATABASE_URL="postgresql://user:pass@host:5432/aure_prod" \
 *   INITIAL_CAPITAL="<amount_provided_by_owner>" \
 *   ENTRY_DATE="<YYYY-MM-DD>" \
 *   npx tsx scripts/init-fresh-production.ts
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("FATAL: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const parsed = new URL(databaseUrl);
console.log("================================================================================");
console.log("AURE LEDGER: FRESH PRODUCTION SETUP");
console.log(`Database Host: ${parsed.hostname}`);
console.log(`Database Name: ${parsed.pathname}`);
console.log("================================================================================");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  // Safety Check: Verify tables are empty
  const [loanCount, borrowingCount, paymentCount, poolCount, equityCount] = await Promise.all([
    client.loan.count(),
    client.borrowing.count(),
    client.payment.count(),
    client.poolTransaction.count(),
    client.equityEntry.count(),
  ]);

  if (loanCount > 0 || borrowingCount > 0 || paymentCount > 0 || poolCount > 0 || equityCount > 0) {
    console.error("FATAL: Database is not empty!");
    console.error(`Found: ${loanCount} loans, ${borrowingCount} borrowings, ${paymentCount} payments, ${poolCount} pool movements, ${equityCount} equity entries.`);
    console.error("Fresh production setup requires a completely empty database. Do not copy development records into production.");
    process.exit(1);
  }

  // Check migrations
  const migrations = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at ASC"
  );
  console.log(`Applied migrations count: ${migrations.length}`);
  if (migrations.length < 8) {
    console.error(`FATAL: Incomplete schema! Found only ${migrations.length} migrations. Run 'npm run db:migrate' first.`);
    process.exit(1);
  }

  const initialCapitalStr = process.env.INITIAL_CAPITAL?.trim();
  const entryDate = process.env.ENTRY_DATE?.trim();

  if (initialCapitalStr && Number(initialCapitalStr) > 0) {
    if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      console.error("FATAL: When providing INITIAL_CAPITAL, an explicit ENTRY_DATE (YYYY-MM-DD) provided by the owner is mandatory.");
      process.exit(1);
    }
    console.log(`Injecting verified owner opening equity capital: ₹${initialCapitalStr} on ${entryDate}...`);
    await addCapital(
      {
        amount: initialCapitalStr,
        transactionDate: entryDate,
        reason: "Initial Owner Capital Pool Injection",
        reference: "PROD_INIT_001",
        performedBy: "owner",
        idempotencyKey: crypto.randomUUID(),
      },
      client
    );
    console.log("Initial equity successfully recorded.");
  } else {
    console.log("Fresh production ledger initialized completely empty (₹0 pool balance, 0 equity entries).");
    console.log("Real opening capital will be added through the web UI after the owner provides the exact amount and date.");
  }

  // Run initial reconciliation
  const rec = await runReconciliation(new PrismaReconciliationGateway(client));
  console.log("\nReconciliation Verification:");
  console.log(`  -> Status:       ${rec.healthy ? "✓ HEALTHY (BALANCED)" : "✗ UNBALANCED"}`);
  console.log(`  -> Pool Balance: ₹${rec.metrics.poolBalance}`);
  console.log(`  -> Critical:     ${rec.metrics.criticalDiscrepancies}`);

  if (!rec.healthy) {
    throw new Error("Fresh ledger failed initial mathematical reconciliation check!");
  }

  console.log("\n================================================================================");
  console.log("✓ FRESH PRODUCTION INITIALIZATION COMPLETE");
  console.log("The ledger is ready for owner sign-in and production usage.");
  console.log("================================================================================");
} finally {
  await client.$disconnect();
}
