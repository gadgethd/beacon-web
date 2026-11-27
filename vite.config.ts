/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  const ukmeshFeed = mode === "ukmesh-feed";
  // A shared DEV launcher can supply an empty directory instead of a deployment .env.
  const envDir = process.env.BEACON_DEV_ENV_DIR ?? process.cwd();
  const env = loadEnv(mode, envDir, "VITE_");
  // set VITE_DEV_PROXY to point at a running beacon-server instance
  const proxyTarget = env.VITE_DEV_PROXY;

  return {
    envDir,
    ...(ukmeshFeed ? {
      base: "/beacon-feed/",
      build: { rollupOptions: { input: fileURLToPath(new URL("./ukmesh-feed.html", import.meta.url)) } },
    } : mode === "companion" ? {
      build: { rollupOptions: { input: ["index.html", "channels.html"] } },
    } : {}),
    plugins: [react(), tailwindcss(), {
      name: "ukmesh-local-theme",
      transformIndexHtml: mode === "companion"
        ? () => [{ tag: "link", attrs: { rel: "stylesheet", href: "/ukmesh-theme/tokens.css" }, injectTo: "head-prepend" }]
        : undefined,
    }],
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
