import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dbPath = fileURLToPath(new URL("../prisma/test.db", import.meta.url));
if (existsSync(dbPath)) unlinkSync(dbPath);

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: "file:./test.db" },
});
