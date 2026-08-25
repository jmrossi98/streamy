import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only: pure logic, no DOM and no network. Keeps the suite in
    // the seconds range so it can gate every deploy without slowing it down.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Fail rather than hang if a test ever reaches for something real.
    testTimeout: 5000,
  },
});
