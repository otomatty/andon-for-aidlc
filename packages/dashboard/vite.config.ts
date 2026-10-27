import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = path.resolve(import.meta.dirname, "src");
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/components/ui", replacement: path.join(src, "shared/ui") },
      { find: "@/store", replacement: path.join(src, "shared/store") },
      { find: "@/hooks", replacement: path.join(src, "shared/hooks") },
      { find: "@/services", replacement: path.join(src, "shared/services") },
      { find: "@/lib", replacement: path.join(src, "shared/lib") },
      { find: "@/data", replacement: path.join(src, "shared/data") },
      { find: "@/styles", replacement: path.join(src, "shared/styles") },
      { find: "@", replacement: src },
    ],
  },
  base: mode === "webview" ? "./" : "/",
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4173",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            // Only translate the same-origin local dev page. Cross-site requests
            // retain their original Origin and the API's normal rejection.
            if (
              incoming.headers.origin === `http://${incoming.headers.host}` &&
              /^(?:127\.0\.0\.1|localhost):\d+$/.test(incoming.headers.host ?? "")
            )
              outgoing.setHeader("origin", "http://127.0.0.1:4173");
          });
        },
      },
      "/ws": { target: "ws://127.0.0.1:4173", ws: true },
    },
  },
  build: {
    outDir: mode === "webview" ? "../vscode-extension/media/dashboard" : "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
