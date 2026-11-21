import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/phone/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@desktop": fileURLToPath(new URL("../desktop/src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  build: {
    chunkSizeWarningLimit: 2048,
  },
});
