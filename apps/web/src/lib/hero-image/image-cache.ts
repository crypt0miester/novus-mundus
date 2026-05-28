// Shared mtime-aware image cache for the hero-image compositor.
//
// The compose path (compose.ts, halo/index.ts) loads PNGs off disk many times
// per request. Without a cache that's expensive. The naive Map<path, Image>
// would never reload after re-bakes, forcing `pkill next dev` every time we
// re-export an asset.
//
// This cache keys on (path, mtimeMs) — one fs.stat per lookup (cheap; inode
// metadata only) and the cached Image is invalidated automatically when the
// file changes on disk. Production assets never change after deploy, so
// stable mtimes mean cache hits forever after warmup.

import { loadImage, type Image } from "@napi-rs/canvas";
import { stat } from "node:fs/promises";

interface CacheEntry {
  mtimeMs: number;
  img: Image;
}

const cache = new Map<string, CacheEntry>();

export async function loadImageCached(path: string): Promise<Image> {
  const s = await stat(path);
  const entry = cache.get(path);
  if (entry && entry.mtimeMs === s.mtimeMs) return entry.img;
  const img = await loadImage(path);
  cache.set(path, { mtimeMs: s.mtimeMs, img });
  return img;
}
