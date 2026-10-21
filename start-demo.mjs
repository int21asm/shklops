import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const [major, minor, patch] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && (minor < 22 || (minor === 22 && patch < 2)))) {
  console.error("Install Node.js 22.22.2 or newer from https://nodejs.org");
  process.exit(1);
}

// This launcher deliberately starts a local synthetic demo. Real bank scraping
// requires separate setup, credentials, and an explicit server opt-in.
const env = {
  ...process.env,
  PUPPETEER_SKIP_DOWNLOAD: "true",
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  ENABLE_LIVE_SCRAPING: "false",
  NODE_ENV: "demo",
  APP_ORIGIN: "http://localhost:3002",
  PORT: "3002",
  HOST: "127.0.0.1",
};
function run(folder, args) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: path.join(root, folder),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run("vendor/israeli-bank-scrapers", ["ci", "--no-audit", "--no-fund"]);
run("vendor/israeli-bank-scrapers", ["run", "build"]);
run(".", ["ci", "--no-audit", "--no-fund"]);
run(".", ["run", "build"]);
console.log(
  "\nOpen http://localhost:3002 on this computer. Choose the demo button. Keep this terminal open.\n",
);
run(".", ["start"]);
