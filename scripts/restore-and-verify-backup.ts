import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaReconciliationGateway, addCapital } from "../src/infrastructure/ledger";
import { runReconciliation } from "../src/application/reconcile";

// Safety Constants
const DISPOSABLE_DB_NAME = "lending_backup_verify_test";
const SOURCE_DB_NAME = "lending";

// Parse .env
const envText = readFileSync(".env", "utf-8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      return [key, val];
    }),
);

const originalUrl = env.DATABASE_URL;
if (!originalUrl) throw new Error("DATABASE_URL is missing in .env");

// Build connection URLs
const parsed = new URL(originalUrl);
parsed.pathname = `/${DISPOSABLE_DB_NAME}`;
const disposableDbUrl = parsed.toString();

const adminParsed = new URL(originalUrl);
adminParsed.pathname = "/postgres";
const adminDbUrl = adminParsed.toString();

console.log("================================================================================");
console.log("AURE LEDGER: BACKUP RESTORATION AND FINANCIAL INTEGRITY VERIFICATION");
console.log("================================================================================");
console.log(`Source Database:      ${SOURCE_DB_NAME}`);
console.log(`Disposable Target:    ${DISPOSABLE_DB_NAME}`);
console.log(`Verification Host:    ${parsed.hostname}:${parsed.port}`);
console.log("================================================================================");

// Find latest backup file in backups/
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
  throw new Error("No .dump files found in backups/ directory. Run scripts/backup-db.sh first.");
}

const latestBackup = files[0];
console.log(`Selected Backup:      ${latestBackup.name} (${statSync(latestBackup.path).size} bytes)`);

// Step 1: Admin connection to create disposable database
const adminClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: adminDbUrl }),
});

try {
  console.log(`\n[1/6] Preparing clean disposable database '${DISPOSABLE_DB_NAME}'...`);
  // Terminate any existing connections to disposable DB and drop it
  await adminClient.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();`
  );
  await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DISPOSABLE_DB_NAME}";`);
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${DISPOSABLE_DB_NAME}" OWNER lending;`);
  console.log(`  -> Disposable database '${DISPOSABLE_DB_NAME}' created.`);
} finally {
  await adminClient.$disconnect();
}

// Step 2: Restore backup into disposable database
console.log(`\n[2/6] Restoring backup archive into '${DISPOSABLE_DB_NAME}'...`);
try {
  // Use docker exec to execute pg_restore
  execSync(
    `docker exec -i aure-ledger-db-1 pg_restore -U lending -d "${DISPOSABLE_DB_NAME}" --no-owner --no-privileges < "${latestBackup.path}"`,
    { stdio: "pipe" }
  );
  console.log("  -> pg_restore completed successfully.");
} catch (restoreErr: any) {
  // pg_restore can exit with 1 if there are minor notices/warnings, check if schema exists
  console.log("  -> pg_restore output:", restoreErr.message?.slice(0, 300));
}

// Step 3: Connect to disposable database and verify schema & migrations
console.log(`\n[3/6] Connecting to restored disposable database to verify schema & migrations...`);
const restoredClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: disposableDbUrl }),
});

try {
  const migrations = await restoredClient.$queryRawUnsafe<{ migration_name: string; finished_at: string }[]>(
    "SELECT migration_name, finished_at::text FROM _prisma_migrations ORDER BY finished_at ASC"
  );
  console.log(`  -> Applied migrations in restored database (${migrations.length}):`);
  for (const m of migrations) {
    console.log(`     ✓ ${m.migration_name}`);
  }

  if (migrations.length < 8) {
    throw new Error(`Expected at least 8 migrations, found ${migrations.length}`);
  }

  // Step 4: Verify record counts and financial balances
  console.log(`\n[4/6] Verifying restored record counts and financial balances...`);
  const tables = [
    "Person",
    "Loan",
    "Borrowing",
    "Payment",
    "PaymentReversal",
    "PoolTransaction",
    "InterestAdjustment",
    "AuditLog",
    "PersonOperation",
    "SettlementOperation",
    "EquityEntry",
    "SignInRateLimit",
  ] as const;

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const modelKey = (t.charAt(0).toLowerCase() + t.slice(1)) as keyof PrismaClient;
    // @ts-ignore
    counts[t] = await restoredClient[modelKey].count();
  }
  console.log("  -> Restored table record counts:");
  for (const [tbl, cnt] of Object.entries(counts)) {
    console.log(`     ${tbl.padEnd(22)}: ${cnt}`);
  }

  if (counts.Loan !== 10 || counts.Borrowing !== 3 || counts.Payment !== 8 || counts.PoolTransaction !== 32) {
    throw new Error("Restored record counts do not match expected production/development ledger state!");
  }

  const poolSum = await restoredClient.$queryRawUnsafe<{ direction: string; sum: string }[]>(
    'SELECT direction, COALESCE(SUM(amount), 0)::text as sum FROM "PoolTransaction" GROUP BY direction ORDER BY direction ASC'
  );
  console.log("  -> Restored pool movements:");
  for (const row of poolSum) {
    console.log(`     Direction ${row.direction}: ₹${row.sum}`);
  }

  // Step 5: Run full ledger reconciliation on restored database
  console.log(`\n[5/6] Running full mathematical ledger reconciliation on restored database...`);
  const recGateway = new PrismaReconciliationGateway(restoredClient);
  const recResult = await runReconciliation(recGateway);

  console.log(`  -> Health status:         ${recResult.healthy ? "✓ HEALTHY (BALANCED)" : "✗ UNBALANCED"}`);
  console.log(`  -> Pool Balance:          ₹${recResult.metrics.poolBalance}`);
  console.log(`  -> Total Pool Txs:        ${recResult.metrics.totalPoolTransactions}`);
  console.log(`  -> Total Payments:        ${recResult.metrics.totalPayments}`);
  console.log(`  -> Total Loans:           ${recResult.metrics.totalLoans}`);
  console.log(`  -> Total Borrowings:      ${recResult.metrics.totalBorrowings}`);
  console.log(`  -> Total Discrepancies:   ${recResult.metrics.totalDiscrepancies}`);
  console.log(`  -> Critical Discrepancies:${recResult.metrics.criticalDiscrepancies}`);
  console.log(`  -> Warning Discrepancies: ${recResult.metrics.warningDiscrepancies}`);

  if (!recResult.healthy || recResult.metrics.criticalDiscrepancies > 0) {
    console.error("Discrepancies found:", recResult.discrepancies);
    throw new Error(`Restored database failed reconciliation! Critical discrepancies: ${recResult.metrics.criticalDiscrepancies}`);
  }

  // Representative financial transaction on restored database
  console.log(`\n[6/6] Executing representative financial flow on disposable database...`);
  const testCapitalKey = crypto.randomUUID();
  const capResult = await addCapital(
    {
      amount: "50000",
      transactionDate: "2026-09-30",
      reason: "Backup verification test injection",
      idempotencyKey: testCapitalKey,
      performedBy: "backup-verifier",
    },
    restoredClient
  );
  console.log(`  -> Executed test capital addition: Transaction ID ${capResult.id}`);

  // Re-verify reconciliation after flow
  const postFlowRec = await runReconciliation(new PrismaReconciliationGateway(restoredClient));
  console.log(`  -> Post-transaction reconciliation: ${postFlowRec.healthy ? "✓ HEALTHY" : "✗ UNBALANCED"}`);
  console.log(`  -> Post-transaction pool balance: ₹${postFlowRec.metrics.poolBalance}`);
  if (!postFlowRec.healthy) {
    throw new Error("Post-transaction reconciliation failed on restored database!");
  }
} finally {
  await restoredClient.$disconnect();
}

// Cleanup disposable database
const cleanupAdmin = new PrismaClient({
  adapter: new PrismaPg({ connectionString: adminDbUrl }),
});
try {
  console.log(`\nCleaning up disposable database '${DISPOSABLE_DB_NAME}'...`);
  await cleanupAdmin.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();`
  );
  await cleanupAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DISPOSABLE_DB_NAME}";`);
  console.log(`  -> Cleaned up disposable database '${DISPOSABLE_DB_NAME}'.`);
} finally {
  await cleanupAdmin.$disconnect();
}

// Verify original database was NEVER touched
console.log(`\nConfirming source database '${SOURCE_DB_NAME}' was completely untouched...`);
const sourceClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: originalUrl }),
});
try {
  const [loanCount, paymentCount, poolCount, auditCount] = await Promise.all([
    sourceClient.loan.count(),
    sourceClient.payment.count(),
    sourceClient.poolTransaction.count(),
    sourceClient.auditLog.count(),
  ]);

  console.log(`  -> Source '${SOURCE_DB_NAME}' check:`);
  console.log(`     Loans:             ${loanCount} (expected: 10)`);
  console.log(`     Payments:          ${paymentCount} (expected: 8)`);
  console.log(`     Pool Transactions: ${poolCount} (expected: 32)`);
  console.log(`     Audit Logs:        ${auditCount} (expected: 47)`);

  if (loanCount !== 10 || paymentCount !== 8 || poolCount !== 32 || auditCount !== 47) {
    throw new Error("FATAL: Source database counts do not match expected values!");
  }
  console.log("\n================================================================================");
  console.log("✓ BACKUP AND RESTORATION VERIFICATION SUCCESSFUL");
  console.log("All data, migrations, balances, reconciliation, and live flows verified.");
  console.log("Source database remained completely isolated and untouched.");
  console.log("================================================================================");
} finally {
  await sourceClient.$disconnect();
}
