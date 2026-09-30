import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env exists; preserved without changes.");
  process.exit(0);
}
const password = randomBytes(18).toString("base64url");
writeFileSync(
  ".env",
  `DATABASE_URL="postgresql://lending:local_password@localhost:5432/lending"\nTEST_DATABASE_URL="postgresql://lending:local_password@localhost:5432/lending_test"\nAPP_PASSWORD="${password}"\nSESSION_SECRET="${randomBytes(48).toString("hex")}"\nAPP_ORIGIN="http://localhost:3000"\n`,
  { mode: 0o600 },
);
console.log(
  "Created private .env with a unique owner password and session secret. Read APP_PASSWORD in .env to sign in. Do not share or commit .env.",
);
