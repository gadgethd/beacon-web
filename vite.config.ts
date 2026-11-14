/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
// The language picker lists every catalog without bundling the ones not in use.
const locales = new URL("./src/i18n/locales/", import.meta.url);
const languageNames = Object.fromEntries(readdirSync(locales).filter((file) => file.endsWith(".json")).sort().map((file) => [
  file.slice(0, -".json".length),
  (JSON.parse(readFileSync(new URL(file, locales), "utf8")) as { name: string }).name,
]));

export default defineConfig(({ mode }) => {
  // A shared DEV launcher can supply an empty directory instead of a deployment .env.
  const envDir = process.env.BEACON_DEV_ENV_DIR ?? process.cwd();
  const env = loadEnv(mode, envDir, "VITE_");
  // set VITE_DEV_PROXY to point at a running beacon-server instance
  const proxyTarget = env.VITE_DEV_PROXY;

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __LANGUAGE_NAMES__: JSON.stringify(languageNames) },
    server: proxyTarget
      ? {
          proxy: {
            "/api": { target: proxyTarget, changeOrigin: true, secure: true },
            "/ws": {
              target: proxyTarget.replace(/^http/, "ws"),
              changeOrigin: true,
              secure: true,
              ws: true,
              headers: { Origin: proxyTarget },
            },
          },
        }
      : undefined,
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
    },
  };
});
