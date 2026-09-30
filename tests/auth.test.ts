import { afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  authConfigured,
  checkPassword,
  issueSession,
  validSession,
  sameOrigin,
  COOKIE,
} from "../src/infrastructure/auth";
afterEach(() => vi.unstubAllEnvs());
const configured = () => {
  vi.stubEnv("APP_PASSWORD", "test-password-only");
  vi.stubEnv("SESSION_SECRET", "test-secret-longer-than-thirty-two-characters");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
};
it("fails closed with missing authentication settings", () => {
  vi.stubEnv("APP_PASSWORD", "");
  expect(authConfigured()).toBe(false);
  expect(validSession(new NextRequest("http://localhost:3000"))).toBe(false);
});
it("checks the owner password", () => {
  configured();
  expect(checkPassword("test-password-only")).toBe(true);
  expect(checkPassword("wrong")).toBe(false);
});
it("accepts a signed session", () => {
  configured();
  expect(
    validSession(
      new NextRequest("http://localhost:3000", {
        headers: { cookie: `${COOKIE}=${issueSession()}` },
      }),
    ),
  ).toBe(true);
});
it("rejects a tampered session", () => {
  configured();
  const token = issueSession();
  expect(
    validSession(
      new NextRequest("http://localhost:3000", {
        headers: { cookie: `${COOKIE}=${token.slice(0, -1)}z` },
      }),
    ),
  ).toBe(false);
});
it("rejects a expired session", () => {
  configured();
  vi.spyOn(Date, "now").mockReturnValueOnce(0);
  const token = issueSession();
  vi.restoreAllMocks();
  expect(
    validSession(
      new NextRequest("http://localhost:3000", {
        headers: { cookie: `${COOKIE}=${token}` },
      }),
    ),
  ).toBe(false);
});
it("rejects cross-origin requests", () => {
  configured();
  expect(
    sameOrigin(
      new NextRequest("http://localhost:3000", {
        headers: { origin: "https://attacker.example" },
      }),
    ),
  ).toBe(false);
  expect(
    sameOrigin(
      new NextRequest("http://localhost:3000", {
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  ).toBe(true);
  expect(
    sameOrigin(
      new NextRequest("http://localhost:3000", {
        headers: { origin: "http://127.0.0.1:3000" },
      }),
    ),
  ).toBe(true);
});
