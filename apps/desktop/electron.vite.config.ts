import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Rollup } from "vite";

const bundled = { exclude: ["@venom/contracts", "@venom/identity", "@venom/safety", "zod"] };

function quietAnnotations(warning: Rollup.RollupLog, warn: (warning: Rollup.RollupLog) => void): void {
  if (warning.code !== "INVALID_ANNOTATION") {
    warn(warning);
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundled,
      rollupOptions: {
        onwarn: quietAnnotations,
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundled,
      rollupOptions: {
        onwarn: quietAnnotations,
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
