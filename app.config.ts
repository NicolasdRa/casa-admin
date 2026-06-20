import { defineConfig } from "@solidjs/start/config";

// ponytail: better-sqlite3 is native; keep it external so Vite doesn't try to bundle it.
export default defineConfig({
  ssr: true,
  middleware: "./src/middleware.ts",
  // sharp ships its libvips binary in a sibling @img/* package Nitro won't bundle correctly;
  // keep it external so the built server loads it from node_modules at runtime.
  server: {
    externals: { external: ["sharp"] },
  },
  vite: {
    ssr: { external: ["better-sqlite3", "sharp"] },
  },
});
