// ESLint 9 flat config. eslint-config-next 16 ships flat config natively, so
// it's imported directly -- bridging it through FlatCompat double-wraps it and
// fails with a circular-structure error.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      // New in eslint-config-next 16 (react-hooks v6), and it fires on eight
      // pre-existing call sites that predate this upgrade. Downgraded to a
      // warning rather than fixed here, for two reasons: reworking effects is
      // a refactor that shouldn't ride along inside a framework upgrade, and
      // some of the reports are for a pattern that has no alternative --
      // reading a browser API such as window size can only happen after
      // mount, so setting state from an effect is the correct implementation
      // rather than a mistake. Left visible so it stays on the list.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "prisma/migrations/**"],
  },
];
