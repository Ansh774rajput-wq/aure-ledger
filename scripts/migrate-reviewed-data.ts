import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaReconciliationGateway } from "../src/infrastructure/ledger";
import { runReconciliation } from "../src/application/reconcile";

/**
 * Aure Ledger - Reviewed Historical Data Migration Tool
 * For migrating reviewed development ledger records to a fresh production database.
 * Requires explicit CONFIRM_MIGRATE=true environment variable.
 */

const targetUrl = process.env.TARGET_DATABASE_URL;
if (!targetUrl) {
  console.error("FATAL: TARGET_DATABASE_URL environment variable is required.");
  process.exit(1);
}

if (process.env.CONFIRM_MIGRATE !== "true") {
  console.error("FATAL: Accidental migration protection. You must set CONFIRM_MIGRATE=true.");
  process.exit(1);
}

// Find latest backup
const backupsDir = join(process.cwd(), "backups");
const files = readdirSync(backupsDir)
  .filter((f) => f.endsWith(".dump"))
  .map((f) => ({
    name: f,
    path: join(backupsDir, f),
    mtime: statSync(join(backupsDir, f)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (files.length === 0) {
  console.error("FATAL: No .dump files found in backups/ directory.");
  process.exit(1);
}

const latestBackup = files[0];
const parsed = new URL(targetUrl);

console.log("================================================================================");
console.log("AURE LEDGER: REVIEWED HISTORICAL DATA MIGRATION");
console.log(`Source Backup Archive: ${latestBackup.name}`);
console.log(`Target Database Host:  ${parsed.hostname}`);
console.log(`Target Database Name:  ${parsed.pathname}`);
console.log("================================================================================");

// Step 1: Restore backup into target database using pg_restore
console.log("Restoring backup archive into target production database...");
execSync(
  `pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${targetUrl}" "${latestBackup.path}"`,
  { stdio: "inherit" }
);
console.log("pg_restore complete.");

// Step 2: Connect and verify record counts & reconciliation
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: targetUrl }),
});

try {
  const [loanCount, borrowingCount, paymentCount, poolCount, auditCount] = await Promise.all([
    client.loan.count(),
    client.borrowing.count(),
    client.payment.count(),
    client.poolTransaction.count(),
    client.auditLog.count(),
  ]);

  console.log("\nVerifying Migrated Target Record Counts:");
  console.log(`  -> Loans:             ${loanCount} (expected: 10)`);
  console.log(`  -> Borrowings:        ${borrowingCount} (expected: 3)`);
  console.log(`  -> Payments:          ${paymentCount} (expected: 8)`);
  console.log(`  -> Pool Transactions: ${poolCount} (expected: 32)`);
  console.log(`  -> Audit Logs:        ${auditCount} (expected: >= 47)`);

  if (loanCount !== 10 || borrowingCount !== 3 || paymentCount !== 8 || poolCount !== 32) {
    throw new Error("Target record counts do not match expected source ledger snapshot!");
  }

  // Step 3: Mathematical reconciliation
  const rec = await runReconciliation(new PrismaReconciliationGateway(client));
  console.log("\nMathematical Reconciliation Check:");
  console.log(`  -> Health:        ${rec.healthy ? "✓ HEALTHY" : "✗ UNBALANCED"}`);
  console.log(`  -> Pool Balance:  ₹${rec.metrics.poolBalance}`);
  console.log(`  -> Discrepancies: ${rec.metrics.totalDiscrepancies}`);

  if (!rec.healthy) {
    throw new Error(`Migration verification failed: target database is unbalanced (${rec.metrics.criticalDiscrepancies} critical errors).`);
  }

  // Step 4: Record audit log entry in target
  await client.auditLog.create({
    data: {
      action: "PRODUCTION_MIGRATION",
      entityId: "SYSTEM",
      performedBy: "owner",
      payload: {
        timestamp: new Date().toISOString(),
        sourceBackup: latestBackup.name,
        verifiedCounts: {
          loans: loanCount,
          borrowings: borrowingCount,
          payments: paymentCount,
          poolTransactions: poolCount,
        },
        reconciliationPoolBalance: rec.metrics.poolBalance,
      },
    },
  });

  console.log("\n================================================================================");
  console.log("✓ REVIEWED DATA MIGRATION COMPLETED SUCCESSFULLY");
  console.log("Target database restored, verified, reconciled, and audited.");
  console.log("================================================================================");
} finally {
  await client.$disconnect();
}
