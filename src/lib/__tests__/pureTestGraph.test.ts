import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces the invariant ci.yml states in a comment: the unit tests are pure
 * and never touch the database.
 *
 * CI installs with `npm ci --ignore-scripts` deliberately, to keep the first
 * gate a few seconds rather than a minute -- a slow gate is one people learn
 * to bypass. That means the generated Prisma client does not exist when the
 * unit tests run, so any module reachable by a *static* import from a test
 * file must not reach lib/db.ts. A dynamic `import()` inside a function is
 * fine: it only loads when that code path actually runs.
 *
 * Without this test the failure mode is local-green / CI-red. Adding one
 * ordinary-looking import to a widely-imported module (sonarr.ts, say) breaks
 * a test suite that never mentioned the database, and nothing says so until
 * CI. That cost a merge on 2026-09-26.
 */

const LIB = "src/lib";
const FORBIDDEN = new Set([posix.join(LIB, "db.ts")]);

/**
 * Specifiers whose module actually gets loaded at import time.
 *
 * Three things are deliberately not that:
 *   - `import type { ... }` / `export type { ... }`, erased by the compiler.
 *     (An inline `import { type A, b }` still loads the module, so only a
 *     leading `type` keyword counts.)
 *   - a dynamic `import()`, which runs only when its code path does -- the
 *     whole point of the escape hatch this test leaves open.
 *   - anything `vi.mock`ed by the test, which replaces the module wholesale.
 */
function staticImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  // Anchored to the start of a line: a dynamic import() is a call expression
  // and never appears there, which is exactly the distinction being drawn.
  const re = /^(?:import|export)(\s+type)?[^;]*?from\s+"([^"]+)"/gm;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue; // type-only, erased
    specs.push(m[2]);
  }
  return specs;
}

/** Modules a test file replaces outright, cutting every edge into them. */
function mockedSpecs(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/vi\.mock\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null; // a package, not ours
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    const path = normalize(candidate).split("\\").join("/");
    if (existsSync(path)) return path;
  }
  return null;
}

/** Every module a test file really loads, including itself. */
function reachable(entry: string): Set<string> {
  const cut = new Set(
    mockedSpecs(entry)
      .map((spec) => resolveSpec(spec, entry))
      .filter((path): path is string => path !== null)
  );
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current) || cut.has(current)) continue;
    seen.add(current);
    for (const spec of staticImports(current)) {
      const resolved = resolveSpec(spec, current);
      if (resolved) stack.push(resolved);
    }
  }
  return seen;
}

const testFiles = readdirSync(join(LIB, "__tests__"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => posix.join(LIB, "__tests__", f));

describe("unit tests stay free of the database", () => {
  it("finds the test files", () => {
    // A resolution change that silently matched nothing would make every
    // assertion below vacuously true.
    expect(testFiles.length).toBeGreaterThan(50);
  });

  for (const file of testFiles) {
    it(`${file.split("/").pop()} reaches no database module`, () => {
      const offenders = [...reachable(file)].filter((m) => FORBIDDEN.has(m));
      expect(offenders).toEqual([]);
    });
  }
});
