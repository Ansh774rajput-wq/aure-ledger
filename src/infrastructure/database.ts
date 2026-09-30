import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { lendingDb?: PrismaClient };
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!globalDb.lendingDb)
    globalDb.lendingDb = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: Number(process.env.DB_TIMEOUT_MS || 15000),
      }),
    });
  return globalDb.lendingDb;
}
