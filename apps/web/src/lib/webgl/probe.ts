// Shared WebGL2 capability probe.
//
// Mirrors the one-shot probe in `components/world/CityTerrainMap.tsx`: the
// result is cached at module scope so every caller reuses a single context
// allocation. Safari / iOS WKWebView caps the per-document WebGL context
// count (~16) and `WEBGL_lose_context` doesn't immediately free the canvas,
// so repeated probes across mounts would creep toward that cap. One cached
// probe for the whole app avoids it — both the city terrain map and the
// minigame star field import this.

let probeResult: boolean | null = null;

export function canUseWebGL2(): boolean {
  if (typeof window === "undefined") return false;
  if (probeResult != null) return probeResult;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("webgl2");
    ctx?.getExtension("WEBGL_lose_context")?.loseContext();
    probeResult = ctx != null;
    return probeResult;
  } catch {
    probeResult = false;
    return false;
  }
}
