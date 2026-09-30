-- CreateTable
CREATE TABLE "SignInRateLimit" (
    "ip" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignInRateLimit_pkey" PRIMARY KEY ("ip")
);
