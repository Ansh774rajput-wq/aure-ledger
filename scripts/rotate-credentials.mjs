import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(".env", "utf-8");
const newPassword = randomBytes(18).toString("base64url");
const newSecret = randomBytes(48).toString("hex");

const updated = envText
  .replace(/^APP_PASSWORD=.*$/m, `APP_PASSWORD="${newPassword}"`)
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${newSecret}"`);

writeFileSync(".env", updated, { mode: 0o600 });
console.log("APP_PASSWORD and SESSION_SECRET rotated successfully in .env. Old sessions invalidated.");
