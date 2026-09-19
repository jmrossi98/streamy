/**
 * Guards the "three edits" rule in .github/workflows/deploy.yml.
 *
 * Adding a variable to the deploy takes three edits, not one: the deploy step's
 * `env:` block, the `envs:` list (appleboy/ssh-action only forwards what is
 * named there), and the `printf` that writes .env. The workflow says so at the
 * top, and the failure mode when someone misses one is silent -- the variable
 * arrives empty, the app reports that integration as unconfigured, and nothing
 * in the logs says why.
 *
 * It is not hypothetical. On 2026-09-19 fourteen variables were empty on the
 * live server for exactly this reason, found only by diffing the running .env
 * against the repository's secrets by hand.
 *
 * Two legitimate patterns this must NOT flag, both of which an earlier draft
 * got wrong and reported as bugs in a workflow that was correct:
 *
 *   - Renames. `"AWS_ACCESS_KEY_ID=${ALERT_AWS_ACCESS_KEY_ID}"` writes one name
 *     into .env from a differently-named secret, so the thing to check is the
 *     SOURCE inside ${...}, never the destination.
 *   - Forwards used by the script rather than written to .env. VPN_ENABLED
 *     decides a compose profile in a shell conditional and never belongs in the
 *     file.
 *
 * It deliberately does NOT check that a GitHub secret exists for each variable:
 * that needs a token this job should not have, and an unset secret is a
 * legitimate state for an optional integration. What it catches is the
 * mechanical mistake.
 */
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

/**
 * Source variables the printf interpolates, i.e. the SRC in "DEST=${SRC}".
 * Keyed by source so a rename is checked against the name actually forwarded.
 */
const printfSources = new Map();
for (const m of workflow.matchAll(/"(\w+)=\$\{(\w+)\}"/g)) {
  printfSources.set(m[2], m[1]);
}

/** The comma-separated envs: list that ssh-action forwards. */
const envsLine = workflow.match(/^\s*envs:\s*(.+)$/m);
const envsVars = new Set(
  envsLine ? envsLine[1].split(",").map((v) => v.trim()).filter(Boolean) : []
);

/** `NAME: ${{ secrets.X }}` / `${{ env.X }}` mappings in the deploy step. */
const envBlockVars = new Set(
  [...workflow.matchAll(/^\s+(\w+):\s*\$\{\{\s*(?:secrets|env)\./gm)].map((m) => m[1])
);

/** Computed by the workflow itself rather than forwarded from a secret. */
const computed = new Set(["DOCKER_IMAGE"]);

const problems = [];

for (const src of printfSources.keys()) {
  if (computed.has(src)) continue;
  if (!envsVars.has(src)) {
    problems.push(`${src}: interpolated by the printf but missing from the envs: list — it will arrive EMPTY`);
  }
  if (!envBlockVars.has(src)) {
    problems.push(`${src}: interpolated by the printf but has no env: mapping — it will arrive EMPTY`);
  }
}

for (const v of envsVars) {
  if (printfSources.has(v)) continue;
  // Forwarded but not written to .env is fine when the deploy script itself
  // uses it -- checked by looking for a shell reference outside the printf.
  //
  // Plain string search, not a regex: a variable name goes straight into the
  // pattern, and `$` and `{}` are regex metacharacters, so an earlier draft
  // built `${VPN_ENABLED}` as a *pattern* and silently matched nothing --
  // reporting a correct workflow as broken.
  const body = workflow.replace(/"(\w+)=\$\{(\w+)\}"/g, "");
  const usedByScript = body.includes("${" + v + "}") || body.includes("$" + v);
  if (!usedByScript) {
    problems.push(`${v}: forwarded by envs: but never used — the forward does nothing`);
  }
}

if (problems.length > 0) {
  console.error("deploy.yml env wiring is inconsistent:\n");
  for (const p of problems.sort()) console.error(`  - ${p}`);
  console.error(
    `\n${problems.length} problem(s). See the comment at the top of deploy.yml:` +
      ` a variable needs all three of env:, envs: and the printf.`
  );
  process.exit(1);
}

console.log(
  `deploy.yml env wiring OK — ${printfSources.size} variables, consistent across env:, envs: and printf.`
);
