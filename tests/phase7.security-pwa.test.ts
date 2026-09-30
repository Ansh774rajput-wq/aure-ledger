import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sameOrigin, PRIVATE_HEADERS } from "../src/infrastructure/auth";
import { GET as healthGet } from "../src/app/api/health/route";

describe("Phase 7: Production Security & PWA Verification", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("1. Strict HTTPS Origin Verification", () => {
    it("strictly requires configured HTTPS origin in production and rejects loopback", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.APP_ORIGIN = "https://ledger.example.com";

      // Legitimate configured HTTPS origin
      const validReq = new NextRequest("https://ledger.example.com/api/commands", {
        method: "POST",
        headers: { origin: "https://ledger.example.com" },
      });
      expect(sameOrigin(validReq)).toBe(true);

      // Loopback localhost must NOT be trusted in production
      const loopbackReq1 = new NextRequest("http://localhost:3000/api/commands", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      expect(sameOrigin(loopbackReq1)).toBe(false);

      // Loopback 127.0.0.1 must NOT be trusted in production
      const loopbackReq2 = new NextRequest("http://127.0.0.1:3000/api/commands", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000" },
      });
      expect(sameOrigin(loopbackReq2)).toBe(false);

      // Insecure HTTP to same domain rejected in production
      const insecureReq = new NextRequest("http://ledger.example.com/api/commands", {
        method: "POST",
        headers: { origin: "http://ledger.example.com" },
      });
      expect(sameOrigin(insecureReq)).toBe(false);

      // Malicious origin rejected
      const attackReq = new NextRequest("https://ledger.example.com/api/commands", {
        method: "POST",
        headers: { origin: "https://evil-ledger.com" },
      });
      expect(sameOrigin(attackReq)).toBe(false);
    });

    it("permits loopback convenience only in non-production development mode", () => {
      (process.env as any).NODE_ENV = "development";
      process.env.APP_ORIGIN = "http://localhost:3000";

      const devReq = new NextRequest("http://localhost:3000/api/snapshot", {
        method: "GET",
        headers: { origin: "http://localhost:3000" },
      });
      expect(sameOrigin(devReq)).toBe(true);

      const dev127Req = new NextRequest("http://127.0.0.1:3000/api/snapshot", {
        method: "GET",
        headers: { origin: "http://127.0.0.1:3000" },
      });
      expect(sameOrigin(dev127Req)).toBe(true);
    });
  });

  describe("2. Private Cache-Control Headers", () => {
    it("defines strictly private, non-storable cache headers for financial endpoints", () => {
      expect(PRIVATE_HEADERS["Cache-Control"]).toBe(
        "no-store, no-cache, must-revalidate, private, max-age=0",
      );
      expect(PRIVATE_HEADERS["Pragma"]).toBe("no-cache");
      expect(PRIVATE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    });
  });

  describe("3. Minimal Secret-Safe Health Endpoint", () => {
    it("returns minimal status without leaking passwords, tokens, URLs or financial records", async () => {
      process.env.DATABASE_URL = "postgresql://lending:local_password@localhost:5432/lending_test";
      const res = await healthGet();
      expect([200, 503]).toContain(res.status);

      const body = await res.json();
      expect(["healthy", "unhealthy"]).toContain(body.status);

      // Verify no sensitive keys leaked in response JSON
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain("password");
      expect(jsonStr).not.toContain("postgres");
      expect(jsonStr).not.toContain("secret");
      expect(jsonStr).not.toContain("loan");
      expect(jsonStr).not.toContain("payment");
      expect(jsonStr).not.toContain("token");
    });
  });

  describe("4. PWA Manifest and Offline Architecture", () => {
    const publicDir = join(process.cwd(), "public");

    it("provides valid web app manifest with standalone display and charcoal theme", () => {
      const manifestPath = join(publicDir, "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.name).toBe("Aure Ledger");
      expect(manifest.short_name).toBe("Aure Ledger");
      expect(manifest.display).toBe("standalone");
      expect(manifest.theme_color).toBe("#111315");
      expect(manifest.background_color).toBe("#111315");
      expect(manifest.start_url).toBe("/");

      const iconSrcs = manifest.icons.map((i: any) => i.src);
      expect(iconSrcs).toContain("/icons/icon-192.png");
      expect(iconSrcs).toContain("/icons/icon-512.png");
      expect(iconSrcs).toContain("/icons/icon-maskable-512.png");

      // Verify icon files physically exist on disk
      for (const icon of manifest.icons) {
        const filePath = join(publicDir, icon.src);
        expect(existsSync(filePath)).toBe(true);
      }
    });

    it("provides branded offline page preserving adonis's creation signature and financial safeguard", () => {
      const offlinePath = join(publicDir, "offline.html");
      expect(existsSync(offlinePath)).toBe(true);

      const offlineHtml = readFileSync(offlinePath, "utf-8");
      // Must preserve the exact signature
      expect(offlineHtml).toContain("adonis's creation");
      // Must explain live connection requirement
      expect(offlineHtml).toContain("Live Connection Required");
      expect(offlineHtml).toContain("Financial commands, early settlements, and reversals are strictly prevented while offline");
    });

    it("configures service worker to enforce network-only for financial APIs and cache only safe static assets", () => {
      const swPath = join(publicDir, "sw.js");
      expect(existsSync(swPath)).toBe(true);

      const swContent = readFileSync(swPath, "utf-8");
      // Ensures /api/ requests bypass service worker cache
      expect(swContent).toContain('url.pathname.startsWith("/api/")');
      expect(swContent).toContain("fetch(event.request)");
      // Caches safe static shell only
      expect(swContent).toContain("STATIC_ASSETS");
      expect(swContent).toContain("/offline.html");
    });
  });
});
