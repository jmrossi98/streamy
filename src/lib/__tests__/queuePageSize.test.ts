import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Radarr/Sonarr's queue endpoint returns ten records unless told otherwise.
 * Fourteen reads once relied on that default and each saw only the first ten
 * downloads -- see QUEUE_PAGE_SIZE in radarr.ts. This fails if a new read of
 * the queue list forgets the page size. Deleting one entry by id
 * (/api/v3/queue/<id>) is not a list read and is allowed.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("queue reads", () => {
  it("always pass a page size", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(__dirname, "..", ".."))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          const bare = /\/api\/v3\/queue(?![/\w?])|\/api\/v3\/queue\?(?!.*pageSize)/.test(line);
          if (bare) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
