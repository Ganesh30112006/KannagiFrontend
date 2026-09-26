// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Server-only settings (BACKEND_URL, INTERNAL_API_KEY) for `npm run dev`, read from .env / .env.local.
// They are not VITE_-prefixed, so Vite never puts them in the browser bundle.
// In production they come from the real environment (Vercel's Environment Variables, or
// deploy/supervisor.mjs passing them from the root .env).
for (const [key, value] of Object.entries(loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), ""))) {
  process.env[key] ??= value;
}

// Built on Vercel (it sets VERCEL=1): a Vercel function (.vercel/output), in Singapore next to the API
// on Render and the Neon database, with up to 60 seconds per request so a free Render API waking from
// sleep (up to a minute) still gets an answer. Vercel serves and compresses the static files itself.
// Anywhere else: a standalone Node server (.output/server/index.mjs) that can be packaged and run anywhere.
// compressPublicAssets: gzip + brotli copies of every static file, made once at build time and
// served to browsers that accept them (much smaller downloads, no per-request CPU).
// (Passed as a variable: the wrapper's type lists only a few Nitro options, but it forwards them all.)
const nitro = process.env["VERCEL"]
  ? { preset: "vercel", vercel: { functions: { regions: ["sin1"], maxDuration: 60 } } }
  : { preset: "node-server", compressPublicAssets: true };

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro,
  vite: {
    build: { sourcemap: false }, // don't ship readable source to browsers
  },
});
