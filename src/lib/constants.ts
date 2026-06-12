function configuredEnv(value: string | undefined, placeholder: string): string | undefined {
  return value && value !== placeholder ? value : undefined;
}

function defaultWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8080/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export const API_BASE = configuredEnv(import.meta.env.VITE_API_BASE, "__VITE_API_BASE__") ?? "/api/v1";
export const WS_URL = configuredEnv(import.meta.env.VITE_WS_URL, "__VITE_WS_URL__") ?? defaultWsUrl();

export const LIVE_BUFFER_CAP = 500;
export const MAX_INFINITE_PAGES = 20;
export const DEFAULT_PAGE_SIZE = 50;

export const SCROLL_TOP_THRESHOLD_PX = 100;
export const SCROLL_BOTTOM_THRESHOLD_PX = 500;

export const WS_PING_INTERVAL_MS = 30_000;
export const WS_RECONNECT_BASE_MS = 1000;
export const WS_RECONNECT_MAX_MS = 30_000;
export const WS_RECONNECT_JITTER = 0.25;

// app tab names, in display order; the ?tab URL param is validated against this list
export const TABS = ["Packets", "Channels", "Map", "Nodes", "Observers", "Routes", "Traces", "Stats"] as const;
