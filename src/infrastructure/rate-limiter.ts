import { PrismaClient } from "../generated/prisma/client";

export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_FAILED_ATTEMPTS = 5;

export interface RateLimitStatus {
  allowed: boolean;
  retryAfterSeconds?: number;
  failedAttempts?: number;
}

// In-memory fallback if database is temporarily unavailable during cold start
const inMemoryFallback = new Map<string, { failedAttempts: number; windowStart: number }>();

function pruneInMemoryFallback() {
  const now = Date.now();
  if (inMemoryFallback.size > 500) {
    for (const [ip, entry] of inMemoryFallback.entries()) {
      if (now - entry.windowStart > WINDOW_MS) inMemoryFallback.delete(ip);
    }
  }
}

/**
 * Checks whether an IP address is currently rate-limited.
 * Enforced against shared PostgreSQL storage across serverless/multi-container instances.
 */
export async function checkRateLimit(
  ip: string,
  db?: PrismaClient,
): Promise<RateLimitStatus> {
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - WINDOW_MS);

  if (db) {
    try {
      const record = await db.signInRateLimit.findUnique({
        where: { ip },
      });

      if (!record) {
        return { allowed: true, failedAttempts: 0 };
      }

      // If the sliding window has passed, the record is expired
      if (record.windowStart < windowThreshold) {
        return { allowed: true, failedAttempts: 0 };
      }

      if (record.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const expiresAt = record.windowStart.getTime() + WINDOW_MS;
        const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000));
        return {
          allowed: false,
          retryAfterSeconds,
          failedAttempts: record.failedAttempts,
        };
      }

      return { allowed: true, failedAttempts: record.failedAttempts };
    } catch (err) {
      console.warn("Database rate-limit check failed, using in-memory fallback:", err);
    }
  }

  // Fallback to in-memory check
  pruneInMemoryFallback();
  const mem = inMemoryFallback.get(ip);
  if (mem) {
    if (Date.now() - mem.windowStart > WINDOW_MS) {
      inMemoryFallback.delete(ip);
      return { allowed: true, failedAttempts: 0 };
    }
    if (mem.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((mem.windowStart + WINDOW_MS - Date.now()) / 1000));
      return { allowed: false, retryAfterSeconds, failedAttempts: mem.failedAttempts };
    }
    return { allowed: true, failedAttempts: mem.failedAttempts };
  }

  return { allowed: true, failedAttempts: 0 };
}

/**
 * Atomically increments failed sign-in attempts for an IP.
 * Uses atomic PostgreSQL upsert (INSERT ... ON CONFLICT DO UPDATE) to guarantee
 * consistent enforcement across concurrent serverless function instances.
 */
export async function recordFailedAttempt(
  ip: string,
  db?: PrismaClient,
): Promise<void> {
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - WINDOW_MS);

  if (db) {
    try {
      await db.$executeRaw`
        INSERT INTO "SignInRateLimit" ("ip", "failedAttempts", "windowStart", "updatedAt")
        VALUES (${ip}, 1, ${now}, ${now})
        ON CONFLICT ("ip") DO UPDATE
        SET "failedAttempts" = CASE
          WHEN "SignInRateLimit"."windowStart" < ${windowThreshold} THEN 1
          ELSE "SignInRateLimit"."failedAttempts" + 1
        END,
        "windowStart" = CASE
          WHEN "SignInRateLimit"."windowStart" < ${windowThreshold} THEN ${now}
          ELSE "SignInRateLimit"."windowStart"
        END,
        "updatedAt" = ${now}
      `;
      return;
    } catch (err) {
      console.warn("Database failed-attempt record failed, using in-memory fallback:", err);
    }
  }

  // Fallback to in-memory record
  const current = inMemoryFallback.get(ip);
  const nowMs = Date.now();
  if (!current || nowMs - current.windowStart > WINDOW_MS) {
    inMemoryFallback.set(ip, { failedAttempts: 1, windowStart: nowMs });
  } else {
    current.failedAttempts += 1;
  }
}

/**
 * Clears rate limiting state for an IP address upon successful sign-in.
 */
export async function clearRateLimit(
  ip: string,
  db?: PrismaClient,
): Promise<void> {
  if (db) {
    try {
      await db.signInRateLimit.deleteMany({
        where: { ip },
      });
    } catch (err) {
      console.warn("Database clear rate-limit failed, continuing:", err);
    }
  }
  inMemoryFallback.delete(ip);
}
