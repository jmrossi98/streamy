/**
 * Copies the Ruffle player into public/ before a build.
 *
 * @ruffle-rs/ruffle is the *selfhosted* package: it expects to be served as
 * plain static files rather than run through a bundler, and its own README
 * points bundler users at ruffle-core instead. Going through Next's bundler
 * would mean fighting it over two large .wasm files for no benefit, when the
 * package is already built exactly as it wants to be served.
 *
 * So this copies rather than imports, and the player loads /ruffle/ruffle.js
 * with a plain <script>. Runs before every build (and on install) so the
 * Docker image gets it without the files being committed.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@ruffle-rs", "ruffle");
const dest = join(root, "public", "ruffle");

if (!existsSync(src)) {
  // Not fatal: `npm ci --ignore-scripts` in CI's test job deliberately skips
  // installing for a build it never runs. Failing here would break a test run
  // over a file only the browser needs.
  console.log("[copy-ruffle] @ruffle-rs/ruffle not installed - skipping");
  process.exit(0);
}

await mkdir(dest, { recursive: true });
// Everything except the sourcemaps and licence files, which only bloat the
// image -- the .js and .wasm are what the browser actually needs.
const keep = (name) =>
  !name.endsWith(".map") && !name.startsWith("LICENSE") &&
  name !== "package.json" && name !== "README.md";

const names = (await readdir(src)).filter(keep);
for (const name of names) {
  await cp(join(src, name), join(dest, name), { recursive: true });
}
console.log(`[copy-ruffle] copied ${names.length} file(s) to public/ruffle`);
