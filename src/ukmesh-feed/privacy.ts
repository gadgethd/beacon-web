import { useEffect, useState } from "react";

const REQUEST_MS = 3_000;
const RETRY_MS = 5_000;

export function readPrivacyAuthority(value: unknown): { generation: number; refreshMs: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, packetArcs, heatmap, privacyGeneration, refreshAfterSeconds } = value as Record<string, unknown>;
  if (version !== 1 || typeof packetArcs !== "boolean" || typeof heatmap !== "boolean"
    || typeof privacyGeneration !== "number" || !Number.isSafeInteger(privacyGeneration) || privacyGeneration < 1
    || typeof refreshAfterSeconds !== "number" || !Number.isInteger(refreshAfterSeconds)
    || refreshAfterSeconds < 5 || refreshAfterSeconds > 300) return null;
  return { generation: privacyGeneration, refreshMs: refreshAfterSeconds * 1_000 };
}

export function usePrivacyGeneration(retry: number): number | null | undefined {
  const [generation, setGeneration] = useState<number | null>();
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
      let current: ReturnType<typeof readPrivacyAuthority> = null;
      try {
        const response = await fetch("/api/runtime-config", {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_MS)]),
        });
        if (response.ok) current = readPrivacyAuthority(await response.json());
      } catch {
        // The public feed needs a current authority to display saved or live messages.
      }
      if (stopped || request.signal.aborted) return;
      setGeneration(current?.generation ?? null);
      timer = setTimeout(() => void refresh(), current?.refreshMs ?? RETRY_MS);
    }
    function visibilityChanged() {
      suspend();
      setGeneration(undefined);
      if (!document.hidden) void refresh();
    }
    setGeneration(undefined);
    void refresh();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopped = true;
      suspend();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [retry]);
  return generation;
}
