import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    minify: "esbuild",
    outDir: "dist",
    rollupOptions: {
      input: [
        "index.html",
        "tools/sigilSignDetectorLab.html",
        "tools/spellEffectLab.html",
        "tools/strokeTemplateMaker.html",
        "tools/strokeTemplateViewer.html"
      ]
    },
    sourcemap: false
  },
  server: {
    // Forward LLM-judge requests to the Cloudflare Worker running locally
    // via `npm run worker:dev` (wrangler dev on :8787). Matches the
    // same-origin /api/judge contract that production users would see once
    // the Worker is deployed to a Cloudflare zone. Without this proxy the
    // dev server returns 404, the circuit breaker trips after 3 failures,
    // and the user sees "Judge unavailable" with no actionable signal.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: false
      }
    }
  }
});
