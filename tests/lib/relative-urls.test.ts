import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete window.__BEACON_CONFIG__;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("relative API defaults with runtime configuration", () => {
  it("uses this origin for unconfigured API and WebSocket requests", async () => {
    vi.stubEnv("VITE_API_BASE", undefined);
    vi.stubEnv("VITE_WS_URL", undefined);
    const { API_BASE, WS_URL } = await import("../../src/lib/constants");
    expect(API_BASE).toBe("/api/v1");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    expect(WS_URL).toBe(`${protocol}//${window.location.host}/ws`);
  });

  it("honours explicit runtime endpoints before build settings", async () => {
    vi.stubEnv("VITE_API_BASE", "https://build.example/api/v1");
    window.__BEACON_CONFIG__ = { VITE_API_BASE: "/beacon/api/v1", VITE_WS_URL: "wss://dev.example/ws" };
    const { API_BASE, WS_URL } = await import("../../src/lib/constants");
    expect(API_BASE).toBe("/beacon/api/v1");
    expect(WS_URL).toBe("wss://dev.example/ws");
  });
});
