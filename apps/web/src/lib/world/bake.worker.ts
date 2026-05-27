// Web Worker that runs the biome → RGBA bake off the main thread.
// Receives a single message per job, posts back the packed pixel
// buffer as a Transferable so the main thread takes ownership without
// a copy.

import { bakeBiomePixels } from "./bakeBiomePixels";
import type { BiomeKnobs } from "novus-mundus-sdk";

export interface BakeRequest {
  jobId: number;
  biomeSeed: number;
  rgu: number;
  knobs: BiomeKnobs;
  texSize: number;
}

export interface BakeResponse {
  jobId: number;
  data: Uint8Array;
  texSize: number;
}

self.addEventListener("message", (e: MessageEvent<BakeRequest>) => {
  const { jobId, biomeSeed, rgu, knobs, texSize } = e.data;
  const data = bakeBiomePixels(biomeSeed, rgu, knobs, texSize);
  const response: BakeResponse = { jobId, data, texSize };
  // Transferable: zero-copy ownership transfer of the underlying
  // ArrayBuffer. The Worker can't touch `data` after this.
  (self as unknown as Worker).postMessage(response, [data.buffer]);
});
