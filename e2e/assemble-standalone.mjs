// `next build`'s standalone output (output: "standalone" in next.config.mjs)
// doesn't include public/ or .next/static -- Next's own docs require copying
// them in by hand for the standalone server to serve them. Run after `next
// build` via `npm run build:e2e`, which the Playwright suite's webServer
// depends on (see playwright.config.ts).
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");
const standalone = path.join(repoRoot, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("`.next/standalone` not found -- run `next build` first.");
  process.exit(1);
}

const targets = [
  { from: path.join(repoRoot, "public"), to: path.join(standalone, "public") },
  { from: path.join(repoRoot, ".next", "static"), to: path.join(standalone, ".next", "static") },
];

for (const { from, to } of targets) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`Copied ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
}
