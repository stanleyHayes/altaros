import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * One React, explicitly.
 *
 * The workspace root pins react 19.2.3 (react-native holds it there) while
 * this package resolves 19.2.8 into its own node_modules. `@testing-library/
 * react` lives at the root and imports the root copy, so the test run ends up
 * with two React instances and every hook fails with "Cannot read properties
 * of null (reading 'useContext')" — a message that reads like a bug in the
 * provider and is not.
 *
 * `resolve.dedupe` does not fix it, because the two are genuinely different
 * versions rather than duplicate copies of one. Aliasing to the root copy is
 * what makes the testing library and the code under test share an instance.
 */
const root = (specifier: string) =>
  fileURLToPath(new URL(`../../node_modules/${specifier}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "react/jsx-dev-runtime": root("react/jsx-dev-runtime.js"),
      "react/jsx-runtime": root("react/jsx-runtime.js"),
      "react-dom/client": root("react-dom/client.js"),
      "react-dom": root("react-dom/index.js"),
      react: root("react/index.js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
