import { defineConfig } from "vitest/config";

// base "./" keeps asset paths relative so the build works on GitHub Pages
// sub-paths and on a custom domain alike.
export default defineConfig({
  base: "./",
  // Site tests only; Studio (studio/) has its own package and test run.
  test: { include: ["tests/**/*.test.ts"] },
});
