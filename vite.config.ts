import { defineConfig } from "vite";

// base "./" keeps asset paths relative so the build works on GitHub Pages
// sub-paths and on a custom domain alike.
export default defineConfig({
  base: "./",
});
