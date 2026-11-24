import { describe, expect, it } from "vitest";
import { readBeaconRevision, readPrivacyAuthority } from "./privacy";

describe("UKMesh channel authority", () => {
  it("requires the current runtime generation and invalidates on registry rotation", () => {
    const generation = readPrivacyAuthority({
      version: 1, packetArcs: true, heatmap: true, privacyGeneration: 7, refreshAfterSeconds: 30,
    });
    expect(generation).toBe(7);
    const ready = { version: 1, generation: 7, registryVersion: "a".repeat(64) };
    expect(readBeaconRevision(ready, generation!)).toBe(`7:${ready.registryVersion}`);
    expect(readBeaconRevision({ ...ready, registryVersion: "b".repeat(64) }, generation!))
      .not.toBe(readBeaconRevision(ready, generation!));
    expect(readBeaconRevision(ready, 8)).toBeNull();
    expect(readBeaconRevision({ ...ready, registryVersion: "unverified" }, 7)).toBeNull();
    expect(readBeaconRevision({ ...ready, version: 2 }, 7)).toBeNull();
    expect(readPrivacyAuthority({ privacyGeneration: 7 })).toBeNull();
  });
});
