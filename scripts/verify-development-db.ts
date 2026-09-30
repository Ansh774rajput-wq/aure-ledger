import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured in .env");
}

const parsedUrl = new URL(databaseUrl);
console.log("=== Environment Verification ===");
console.log("Database Host:", parsedUrl.hostname);
console.log("Database Port:", parsedUrl.port);
console.log("Database Path:", parsedUrl.pathname);
console.log("Database Username:", parsedUrl.username);
console.log("Password redacted: [REDACTED]");

const client = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  }),
});

try {
  // Query server version and inet server addr to confirm Docker PG
  const versionRes = await client.$queryRawUnsafe<{ version: string }[]>("SELECT version()");
  console.log("PostgreSQL Version:", versionRes[0]?.version);

  const connRes = await client.$queryRawUnsafe<{ inet_server_addr: string | null; inet_server_port: number | null; current_database: string; current_user: string }[]>(
    "SELECT inet_server_addr()::text as inet_server_addr, inet_server_port() as inet_server_port, current_database(), current_user"
  );
  console.log("Connection Info:", JSON.stringify(connRes[0], null, 2));

  // Query migrations
  const migrations = await client.$queryRawUnsafe<{ migration_name: string; finished_at: string }[]>(
    "SELECT migration_name, finished_at::text FROM _prisma_migrations ORDER BY finished_at ASC"
  );
  console.log("Applied Migrations Count:", migrations.length);
  for (const m of migrations) {
    console.log(` - ${m.migration_name} (finished: ${m.finished_at})`);
  }

  // Row counts for all tables
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
  ] as const;

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const modelKey = (t.charAt(0).toLowerCase() + t.slice(1)) as keyof PrismaClient;
    // @ts-ignore
    counts[t] = await client[modelKey].count();
  }

  console.log("=== Development Database Row Counts ===");
  console.log(JSON.stringify(counts, null, 2));

  // Also query pool balance from PoolTransaction
  const poolSum = await client.$queryRawUnsafe<{ direction: string; sum: string }[]>(
    'SELECT direction, COALESCE(SUM(amount), 0)::text as sum FROM "PoolTransaction" GROUP BY direction'
  );
  console.log("Pool transaction sums by direction:", poolSum);
} finally {
  await client.$disconnect();
}
