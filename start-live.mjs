import { existsSync } from "node:fs";
import path from "node:path";

// Explicit local opt-in. start-demo.mjs continues to force synthetic mode.
const [major, minor, patch] = process.versions.node.split(".").map(Number);
if (
  major < 22 ||
  (major === 22 && (minor < 22 || (minor === 22 && patch < 2)))
) {
  console.error("Install Node.js 22.22.2 or newer from https://nodejs.org");
  process.exit(1);
}

const candidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  ...[
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map((folder) =>
      path.join(folder, "Google", "Chrome", "Application", "chrome.exe"),
    ),
];
const browser = process.env.CHROMIUM_PATH || candidates.find(existsSync);
if (!browser || !existsSync(browser)) {
  console.error(
    "Install Chrome/Chromium or set CHROMIUM_PATH in .env to its executable.",
  );
  process.exit(1);
}

Object.assign(process.env, {
  ENABLE_LIVE_SCRAPING: "true",
  CHROMIUM_PATH: browser,
  NODE_ENV: "local",
  HOST: "127.0.0.1",
  PORT: process.env.PORT || "3002",
  APP_ORIGIN: `http://localhost:${process.env.PORT || "3002"}`,
});
console.log(`Local bank connections enabled. Open ${process.env.APP_ORIGIN}`);
console.log(
  "Use a personal application login; demo accounts keep using synthetic data.",
);
await import("./server/index.js");
