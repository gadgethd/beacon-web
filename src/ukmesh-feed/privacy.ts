import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const REQUEST_MS = 3_000;
const RETRY_MS = 5_000;

export function readPrivacyAuthority(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, packetArcs, heatmap, privacyGeneration, refreshAfterSeconds } = value as Record<string, unknown>;
  if (version !== 1 || typeof packetArcs !== "boolean" || typeof heatmap !== "boolean"
    || typeof privacyGeneration !== "number" || !Number.isSafeInteger(privacyGeneration) || privacyGeneration < 1
    || typeof refreshAfterSeconds !== "number" || !Number.isInteger(refreshAfterSeconds)
    || refreshAfterSeconds < 5 || refreshAfterSeconds > 300) return null;
  return privacyGeneration;
}

export function readBeaconRevision(value: unknown, privacyGeneration: number): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, generation, registryVersion } = value as Record<string, unknown>;
  if (version !== 1 || generation !== privacyGeneration || !Number.isSafeInteger(generation) || privacyGeneration < 1
    || typeof registryVersion !== "string" || !/^[0-9a-f]{64}$/.test(registryVersion)) return null;
  return `${privacyGeneration}:${registryVersion}`;
}

export function useBeaconRevision(): string | null | undefined {
  const [revision, setRevision] = useState<string | null>();
  useEffect(() => {
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    function suspend() {
      active?.abort();
      clearTimeout(timer);
    }
    async function refresh() {
      suspend();
      if (document.hidden) return;
      const request = new AbortController();
      active = request;
      let current: string | null = null;
      try {
        const options: RequestInit = {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_MS)]),
        };
        const [runtime, beacon] = await Promise.all([
          fetch("/api/runtime-config", options), fetch("/beacon/readyz", options),
        ]);
        if (runtime.ok && beacon.ok) {
          const authority = readPrivacyAuthority(await runtime.json());
          if (authority !== null) current = readBeaconRevision(await beacon.json(), authority);
        }
      } catch {
        // The public feed needs a current authority to display saved or live messages.
      }
      if (stopped || request.signal.aborted) return;
      setRevision(current);
      timer = setTimeout(() => void refresh(), RETRY_MS);
    }
    function hide() {
      suspend();
      flushSync(() => setRevision(undefined));
    }
    function visibilityChanged() {
      hide();
      if (!document.hidden) void refresh();
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) visibilityChanged();
    }
    void refresh();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      stopped = true;
      suspend();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  return revision;
}
