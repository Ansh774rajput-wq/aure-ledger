import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
} from "../src/infrastructure/rate-limiter";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
    }),
  });
  await db.$connect();
});

afterAll(async () => {
  if (db) await db.$disconnect();
});

beforeEach(async () => {
  if (db) {
    await db.signInRateLimit.deleteMany();
  }
});

describe("Shared PostgreSQL Sign-in Rate Limiter", () => {
  it("allows initial attempt when no records exist", async () => {
    const status = await checkRateLimit("192.168.1.100", db);
    expect(status.allowed).toBe(true);
    expect(status.failedAttempts).toBe(0);
  });

  it("permits up to 4 failed attempts without blocking", async () => {
    const ip = "192.168.1.101";

    for (let i = 1; i <= 4; i++) {
      await recordFailedAttempt(ip, db);
      const status = await checkRateLimit(ip, db);
      expect(status.allowed).toBe(true);
      expect(status.failedAttempts).toBe(i);
    }
  });

  it("blocks and returns retryAfterSeconds on 5th failed attempt", async () => {
    const ip = "192.168.1.102";

    for (let i = 1; i <= 5; i++) {
      await recordFailedAttempt(ip, db);
    }

    const status = await checkRateLimit(ip, db);
    expect(status.allowed).toBe(false);
    expect(status.failedAttempts).toBe(5);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(status.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("enforces atomicity under concurrent failed attempts across serverless instances", async () => {
    const ip = "192.168.1.103";

    // Simulate 10 concurrent requests from the same IP hitting different serverless instances
    await Promise.all(
      Array.from({ length: 10 }).map(() => recordFailedAttempt(ip, db)),
    );

    const record = await db.signInRateLimit.findUnique({ where: { ip } });
    expect(record).toBeDefined();
    // Exactly 10 increments must be recorded atomically without race conditions
    expect(record!.failedAttempts).toBe(10);

    const status = await checkRateLimit(ip, db);
    expect(status.allowed).toBe(false);
  });

  it("clears rate limit state upon successful sign-in", async () => {
    const ip = "192.168.1.104";

    // 3 failed attempts
    await recordFailedAttempt(ip, db);
    await recordFailedAttempt(ip, db);
    await recordFailedAttempt(ip, db);

    let status = await checkRateLimit(ip, db);
    expect(status.failedAttempts).toBe(3);

    // User signs in successfully
    await clearRateLimit(ip, db);

    status = await checkRateLimit(ip, db);
    expect(status.allowed).toBe(true);
    expect(status.failedAttempts).toBe(0);

    const record = await db.signInRateLimit.findUnique({ where: { ip } });
    expect(record).toBeNull();
  });

  it("resets count when the 15-minute sliding window has expired", async () => {
    const ip = "192.168.1.105";

    // Insert an expired rate limit record from 20 minutes ago
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    await db.signInRateLimit.create({
      data: {
        ip,
        failedAttempts: 5,
        windowStart: twentyMinsAgo,
        updatedAt: twentyMinsAgo,
      },
    });

    // Check should see it expired and allow
    const status = await checkRateLimit(ip, db);
    expect(status.allowed).toBe(true);

    // Recording next failed attempt resets window to now and count to 1
    await recordFailedAttempt(ip, db);
    const updated = await db.signInRateLimit.findUnique({ where: { ip } });
    expect(updated!.failedAttempts).toBe(1);
    expect(updated!.windowStart.getTime()).toBeGreaterThan(twentyMinsAgo.getTime());
  });

  it("falls back to in-memory tracking if database is not provided", async () => {
    const fallbackIp = "10.0.0.99";

    // Test in-memory fallback (db = undefined)
    for (let i = 1; i <= 5; i++) {
      await recordFailedAttempt(fallbackIp, undefined);
    }

    const blocked = await checkRateLimit(fallbackIp, undefined);
    expect(blocked.allowed).toBe(false);
    expect(blocked.failedAttempts).toBe(5);

    await clearRateLimit(fallbackIp, undefined);
    const cleared = await checkRateLimit(fallbackIp, undefined);
    expect(cleared.allowed).toBe(true);
  });
});
