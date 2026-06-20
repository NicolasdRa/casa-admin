import { defineConfig } from "@solidjs/start/config";

// ponytail: better-sqlite3 is native; keep it external so Vite doesn't try to bundle it.
export default defineConfig({
  ssr: true,
  middleware: "./src/middleware.ts",
  vite: {
    ssr: { external: ["better-sqlite3"] },
  },
});
