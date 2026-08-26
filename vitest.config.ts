import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "@/*" -> "src/*" path alias in tsconfig, so modules that
      // import through it resolve the same way under test as they do in Next.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit tests only: pure logic, no DOM and no network. Keeps the suite in
    // the seconds range so it can gate every deploy without slowing it down.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Fail rather than hang if a test ever reaches for something real.
    testTimeout: 5000,
  },
});
