/**
 * AssetLoader.js
 *
 * Progressive asset loader with priority queue, LRU cache, concurrent
 * loading, and cancellation support. Handles GLTF/GLB models (with DRACO
 * compression), textures, and audio buffers.
 *
 * Falls back to procedural geometry from BuildingFactory when GLTF files
 * are unavailable (404 or network error).
 *
 * Three.js 0.170.0 — vanilla ES module.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ASSET_MANIFEST, getAssetPath as resolveManifestPath } from './AssetManifest.js';

// ---------------------------------------------------------------------------
// Asset loading states
// ---------------------------------------------------------------------------

const STATE_IDLE = 'idle';
const STATE_LOADING = 'loading';
const STATE_LOADED = 'loaded';
const STATE_ERROR = 'error';

// ---------------------------------------------------------------------------
// Priority levels
// ---------------------------------------------------------------------------

const PRIORITY_CRITICAL = 0;  // Visible buildings, player-facing
const PRIORITY_HIGH = 1;      // Near-camera assets
const PRIORITY_NORMAL = 2;    // Standard priority
const PRIORITY_LOW = 3;       // Distant decorations, preloads
const PRIORITY_BACKGROUND = 4; // Non-visible prefetches

// ---------------------------------------------------------------------------
// Size estimation helpers
// ---------------------------------------------------------------------------

/**
 * Estimate GPU memory usage of a GLTF scene in bytes.
 * Counts buffer geometry attribute byte lengths + texture image data.
 * @param {THREE.Group} scene
 * @returns {number}
 */
function estimateGLTFSize(scene) {
  let bytes = 0;
  const counted = new Set();

  scene.traverse((child) => {
    // Geometry
    if (child.geometry && !counted.has(child.geometry.uuid)) {
      counted.add(child.geometry.uuid);
      const attrs = child.geometry.attributes;
      for (const key in attrs) {
        const attr = attrs[key];
        if (attr.array) {
          bytes += attr.array.byteLength;
        }
      }
      if (child.geometry.index && child.geometry.index.array) {
        bytes += child.geometry.index.array.byteLength;
      }
    }

    // Textures in materials
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        const texProps = [
          'map', 'normalMap', 'roughnessMap', 'metalnessMap',
          'emissiveMap', 'aoMap', 'alphaMap', 'envMap',
        ];
        for (const prop of texProps) {
          const tex = mat[prop];
          if (tex && tex.image && !counted.has(tex.uuid)) {
            counted.add(tex.uuid);
            const img = tex.image;
            // Width × height × 4 bytes (RGBA) — rough estimate
            const w = img.width || img.naturalWidth || 256;
            const h = img.height || img.naturalHeight || 256;
            bytes += w * h * 4;
          }
        }
      }
    }
  });

  return bytes;
}

/**
 * Estimate GPU memory of a texture.
 * @param {THREE.Texture} texture
 * @returns {number}
 */
function estimateTextureSize(texture) {
  if (!texture || !texture.image) return 0;
  const img = texture.image;
  const w = img.width || img.naturalWidth || 256;
  const h = img.height || img.naturalHeight || 256;
  const channels = 4;
  // Account for mipmaps (~1.33x)
  const mipFactor = texture.generateMipmaps ? 1.33 : 1.0;
  return Math.ceil(w * h * channels * mipFactor);
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

class LRUCache {
  /**
   * @param {number} maxSizeBytes
   */
  constructor(maxSizeBytes) {
    this._maxSize = maxSizeBytes;
    this._currentSize = 0;
    this._hits = 0;
    this._misses = 0;

    // Map<string, { asset, sizeBytes, timestamp }>
    // Order of insertion is maintained; we move-to-end on access.
    this._entries = new Map();
  }

  /**
   * Get a cached asset. Returns null if not found.
   * @param {string} key
   * @returns {object|null}
   */
  get(key) {
    const entry = this._entries.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }

    // Move to end (most recently used)
    this._entries.delete(key);
    entry.timestamp = performance.now();
    this._entries.set(key, entry);

    this._hits++;
    return entry.asset;
  }

  /**
   * Store an asset in the cache.
   * @param {string} key
   * @param {object} asset
   * @param {number} sizeBytes
   */
  set(key, asset, sizeBytes) {
    // If already present, update in place
    if (this._entries.has(key)) {
      const existing = this._entries.get(key);
      this._currentSize -= existing.sizeBytes;
      this._entries.delete(key);
    }

    // Evict LRU entries until we have room
    while (this._currentSize + sizeBytes > this._maxSize && this._entries.size > 0) {
      const oldest = this._entries.keys().next().value;
      this._evict(oldest);
    }

    this._entries.set(key, {
      asset,
      sizeBytes,
      timestamp: performance.now(),
    });
    this._currentSize += sizeBytes;
  }

  /**
   * Check if a key is cached.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._entries.has(key);
  }

  /**
   * Evict a single key.
   * @param {string} key
   */
  _evict(key) {
    const entry = this._entries.get(key);
    if (!entry) return;

    // Dispose Three.js resources
    if (entry.asset) {
      this._disposeAsset(entry.asset);
    }

    this._currentSize -= entry.sizeBytes;
    this._entries.delete(key);
  }

  /**
   * Remove a specific key from the cache.
   * @param {string} key
   */
  remove(key) {
    this._evict(key);
  }

  /**
   * Clear all entries.
   */
  clear() {
    for (const key of [...this._entries.keys()]) {
      this._evict(key);
    }
    this._currentSize = 0;
  }

  /**
   * Get cache statistics.
   * @returns {{ entries: number, sizeEstimateMB: number, hitRate: number }}
   */
  getStats() {
    const total = this._hits + this._misses;
    return {
      entries: this._entries.size,
      sizeEstimateMB: Math.round(this._currentSize / (1024 * 1024) * 100) / 100,
      hitRate: total > 0 ? Math.round(this._hits / total * 1000) / 1000 : 0,
    };
  }

  /**
   * Dispose GPU resources held by a cached asset.
   * @param {object} asset
   */
  _disposeAsset(asset) {
    if (!asset) return;

    // GLTF scene
    if (asset.scene) {
      asset.scene.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            for (const key in mat) {
              const value = mat[key];
              if (value && typeof value.dispose === 'function') {
                value.dispose();
              }
            }
            mat.dispose();
          }
        }
      });
    }

    // Standalone texture
    if (asset instanceof THREE.Texture) {
      asset.dispose();
    }

    // Audio buffer (nothing to dispose, GC handles it)
  }
}

// ---------------------------------------------------------------------------
// Priority Queue (min-heap by priority)
// ---------------------------------------------------------------------------

class PriorityQueue {
  constructor() {
    this._items = [];
  }

  get size() {
    return this._items.length;
  }

  enqueue(item) {
    this._items.push(item);
    this._bubbleUp(this._items.length - 1);
  }

  dequeue() {
    if (this._items.length === 0) return null;
    const top = this._items[0];
    const last = this._items.pop();
    if (this._items.length > 0) {
      this._items[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  remove(predicate) {
    const idx = this._items.findIndex(predicate);
    if (idx === -1) return null;
    const item = this._items[idx];
    const last = this._items.pop();
    if (idx < this._items.length) {
      this._items[idx] = last;
      this._bubbleUp(idx);
      this._sinkDown(idx);
    }
    return item;
  }

  has(predicate) {
    return this._items.some(predicate);
  }

  clear() {
    this._items.length = 0;
  }

  _bubbleUp(idx) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this._items[idx].priority < this._items[parentIdx].priority) {
        [this._items[idx], this._items[parentIdx]] = [this._items[parentIdx], this._items[idx]];
        idx = parentIdx;
      } else {
        break;
      }
    }
  }

  _sinkDown(idx) {
    const len = this._items.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < len && this._items[left].priority < this._items[smallest].priority) {
        smallest = left;
      }
      if (right < len && this._items[right].priority < this._items[smallest].priority) {
        smallest = right;
      }
      if (smallest !== idx) {
        [this._items[idx], this._items[smallest]] = [this._items[smallest], this._items[idx]];
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AssetLoader
// ---------------------------------------------------------------------------

export class AssetLoader {
  /**
   * @param {object} [options]
   * @param {number} [options.maxConcurrent=4]    Max simultaneous loads
   * @param {number} [options.cacheSizeMB=64]     LRU cache budget in MB
   * @param {string} [options.basePath='./src/town/assets/'] Base path for all assets
   * @param {string} [options.dracoDecoderPath]   Path to DRACO decoder WASM
   */
  constructor(options = {}) {
    this._maxConcurrent = options.maxConcurrent ?? 4;
    this._basePath = options.basePath ?? ASSET_MANIFEST.basePath;

    // Cache
    const cacheSizeMB = options.cacheSizeMB ?? 64;
    this._cache = new LRUCache(cacheSizeMB * 1024 * 1024);

    // Loaders
    this._gltfLoader = new GLTFLoader();
    this._dracoLoader = new DRACOLoader();
    this._dracoLoader.setDecoderPath(
      options.dracoDecoderPath ?? 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
    );
    this._gltfLoader.setDRACOLoader(this._dracoLoader);

    this._textureLoader = new THREE.TextureLoader();
    this._audioLoader = new THREE.AudioLoader();

    // Queue
    this._queue = new PriorityQueue();
    this._activeLoads = 0;
    this._processing = false;

    // Per-asset tracking: Map<string, { state, promise, cancel }>
    this._assets = new Map();

    // Abort controllers for cancellation
    this._abortControllers = new Map();
  }

  // -----------------------------------------------------------------------
  // Public: load a single asset
  // -----------------------------------------------------------------------

  /**
   * Load a single asset by category and id.
   * Returns the loaded asset (GLTF result for models, Texture for images).
   *
   * @param {string} assetId   - The asset key (e.g. 'mansion', 'oak', 'grass_diffuse')
   * @param {string} category  - The manifest category
   * @param {object} [options]
   * @param {number} [options.tier]    - Tier index for buildings (0-3)
   * @param {string} [options.theme]   - Theme override
   * @param {string} [options.path]    - Direct path override (bypasses manifest)
   * @returns {Promise<object>} The loaded asset
   */
  async load(assetId, category, options = {}) {
    const cacheKey = this._makeCacheKey(assetId, category, options);

    // Check cache
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    // Check if already loading
    const tracked = this._assets.get(cacheKey);
    if (tracked && tracked.state === STATE_LOADING && tracked.promise) {
      return tracked.promise;
    }

    // Resolve the file path
    const filePath = options.path || this._resolveAssetPath(assetId, category, options);
    const fileType = this._inferFileType(filePath);

    // Create tracking entry
    const entry = { state: STATE_LOADING, promise: null, cancel: null };
    this._assets.set(cacheKey, entry);

    // Create abort controller
    const controller = new AbortController();
    this._abortControllers.set(cacheKey, controller);

    // Load with single retry on transient failures
    const promise = this._loadWithRetry(filePath, fileType, controller.signal, 1)
      .then((asset) => {
        if (controller.signal.aborted) return null;

        entry.state = STATE_LOADED;
        const sizeBytes = this._estimateSize(asset, fileType);
        this._cache.set(cacheKey, asset, sizeBytes);
        this._abortControllers.delete(cacheKey);
        this._assets.delete(cacheKey);
        return asset;
      })
      .catch((err) => {
        if (controller.signal.aborted) return null;

        entry.state = STATE_ERROR;
        this._abortControllers.delete(cacheKey);
        this._assets.delete(cacheKey);
        console.warn(`[AssetLoader] Failed to load ${category}/${assetId}:`, err.message);
        return null;
      });

    entry.promise = promise;
    return promise;
  }

  // -----------------------------------------------------------------------
  // Public: queue-based loading
  // -----------------------------------------------------------------------

  /**
   * Enqueue an asset for deferred loading.
   * @param {string} assetId
   * @param {string} category
   * @param {number} [priority=2]  0 = highest
   * @param {object} [options]
   */
  enqueue(assetId, category, priority = PRIORITY_NORMAL, options = {}) {
    const cacheKey = this._makeCacheKey(assetId, category, options);

    // Skip if cached or already queued
    if (this._cache.has(cacheKey)) return;
    if (this._queue.has((item) => item.cacheKey === cacheKey)) return;

    this._queue.enqueue({
      assetId,
      category,
      priority,
      options,
      cacheKey,
    });
  }

  /**
   * Process the queue, loading assets in priority order.
   * @param {function} [onProgress] - ({ loaded, total, currentAsset }) => void
   * @returns {Promise<void>}
   */
  async processQueue(onProgress) {
    if (this._processing) return;
    this._processing = true;

    const total = this._queue.size;
    let loaded = 0;

    const runNext = async () => {
      while (this._activeLoads < this._maxConcurrent && this._queue.size > 0) {
        const item = this._queue.dequeue();
        if (!item) break;

        // Skip if already cached
        if (this._cache.has(item.cacheKey)) {
          loaded++;
          if (onProgress) onProgress({ loaded, total, currentAsset: item.assetId });
          continue;
        }

        this._activeLoads++;

        this.load(item.assetId, item.category, item.options)
          .then(() => {
            this._activeLoads--;
            loaded++;
            if (onProgress) onProgress({ loaded, total, currentAsset: item.assetId });
            runNext();
          })
          .catch(() => {
            this._activeLoads--;
            loaded++;
            if (onProgress) onProgress({ loaded, total, currentAsset: item.assetId });
            runNext();
          });
      }
    };

    await runNext();

    // Wait for all active loads to complete
    await this._waitForActiveLoads();
    this._processing = false;
  }

  /**
   * Batch-load a set of assets.
   * @param {Array<{ id: string, category: string, priority?: number, options?: object }>} assets
   * @param {function} [onProgress]
   * @returns {Promise<Map<string, object>>} Map of cacheKey -> loaded asset
   */
  async loadBatch(assets, onProgress) {
    // Enqueue all
    for (const item of assets) {
      this.enqueue(item.id, item.category, item.priority ?? PRIORITY_NORMAL, item.options || {});
    }

    // Process
    await this.processQueue(onProgress);

    // Collect results
    const results = new Map();
    for (const item of assets) {
      const cacheKey = this._makeCacheKey(item.id, item.category, item.options || {});
      const cached = this._cache.get(cacheKey);
      if (cached) {
        results.set(cacheKey, cached);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Public: cache management
  // -----------------------------------------------------------------------

  /**
   * Get a cached asset by id.
   * @param {string} assetId
   * @param {string} [category]
   * @param {object} [options]
   * @returns {object|null}
   */
  getCached(assetId, category = '', options = {}) {
    const cacheKey = this._makeCacheKey(assetId, category, options);
    return this._cache.get(cacheKey);
  }

  /**
   * Hint to start loading assets in the background.
   * @param {Array<{ id: string, category: string, options?: object }>} assets
   */
  preload(assets) {
    for (const item of assets) {
      this.enqueue(item.id, item.category, PRIORITY_BACKGROUND, item.options || {});
    }
    // Fire-and-forget queue processing
    this.processQueue().catch(() => {});
  }

  /**
   * Evict a specific asset from cache.
   * @param {string} assetId
   * @param {string} [category]
   * @param {object} [options]
   */
  evict(assetId, category = '', options = {}) {
    const cacheKey = this._makeCacheKey(assetId, category, options);
    this._cache.remove(cacheKey);
    this._assets.delete(cacheKey);
  }

  /**
   * Clear the entire cache.
   */
  clearCache() {
    this._cache.clear();
    this._assets.clear();
  }

  /**
   * Get cache statistics.
   * @returns {{ entries: number, sizeEstimateMB: number, hitRate: number }}
   */
  getCacheStats() {
    return this._cache.getStats();
  }

  // -----------------------------------------------------------------------
  // Public: cancellation
  // -----------------------------------------------------------------------

  /**
   * Cancel a pending load.
   * @param {string} assetId
   * @param {string} [category]
   * @param {object} [options]
   */
  cancel(assetId, category = '', options = {}) {
    const cacheKey = this._makeCacheKey(assetId, category, options);

    // Abort the network request
    const controller = this._abortControllers.get(cacheKey);
    if (controller) {
      controller.abort();
      this._abortControllers.delete(cacheKey);
    }

    // Remove from queue
    this._queue.remove((item) => item.cacheKey === cacheKey);

    // Update tracking state
    const tracked = this._assets.get(cacheKey);
    if (tracked) {
      tracked.state = STATE_IDLE;
    }
  }

  /**
   * Cancel all pending loads.
   */
  cancelAll() {
    // Abort all active loads
    for (const [, controller] of this._abortControllers) {
      controller.abort();
    }
    this._abortControllers.clear();

    // Clear queue
    this._queue.clear();

    // Reset active count
    this._activeLoads = 0;
    this._processing = false;
  }

  // -----------------------------------------------------------------------
  // Public: lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose all resources. Call when the loader is no longer needed.
   */
  dispose() {
    this.cancelAll();
    this.clearCache();
    this._dracoLoader.dispose();
    this._gltfLoader = null;
    this._textureLoader = null;
    this._audioLoader = null;
  }

  // -----------------------------------------------------------------------
  // Internal: path resolution
  // -----------------------------------------------------------------------

  /**
   * Generate a cache key from asset id, category, and options.
   * @returns {string}
   */
  _makeCacheKey(assetId, category, options = {}) {
    let key = `${category}:${assetId}`;
    if (options.tier !== undefined) key += `:t${options.tier}`;
    if (options.theme) key += `:${options.theme}`;
    if (options.path) key += `:${options.path}`;
    return key;
  }

  /**
   * Resolve an asset path from the manifest.
   * @param {string} assetId
   * @param {string} category
   * @param {object} options
   * @returns {string}
   */
  _resolveAssetPath(assetId, category, options) {
    const categoryData = ASSET_MANIFEST[category];
    if (!categoryData) {
      return this._basePath + assetId;
    }

    const entry = categoryData[assetId];
    if (!entry) {
      return this._basePath + assetId;
    }

    // Apply theme override
    if (options.theme) {
      try {
        return resolveManifestPath(category, assetId, options);
      } catch {
        // Fall through to manual resolution
      }
    }

    // Buildings: resolve tier
    if (category === 'buildings' && entry.tiers) {
      const tierNames = ['foundation', 'established', 'grand', 'legendary'];
      const tierIndex = typeof options.tier === 'number'
        ? Math.min(Math.max(options.tier, 0), 3) : 0;
      const tierData = entry.tiers[tierNames[tierIndex]];
      return this._basePath + tierData.model;
    }

    // Texture / audio: use "path" field
    if (entry.path) {
      return this._basePath + entry.path;
    }

    // Everything else: use "model" field
    return this._basePath + entry.model;
  }

  /**
   * Infer file type from path extension.
   * @param {string} path
   * @returns {'gltf'|'texture'|'audio'|'hdr'}
   */
  _inferFileType(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'gltf';
    if (lower.endsWith('.hdr') || lower.endsWith('.exr')) return 'hdr';
    if (lower.endsWith('.ogg') || lower.endsWith('.mp3') || lower.endsWith('.wav')) return 'audio';
    // Default: treat as texture (png, jpg, webp, etc.)
    return 'texture';
  }

  // -----------------------------------------------------------------------
  // Internal: type-specific loading
  // -----------------------------------------------------------------------

  /**
   * Load an asset by its inferred type.
   * @param {string} path
   * @param {'gltf'|'texture'|'audio'|'hdr'} type
   * @param {AbortSignal} signal
   * @returns {Promise<object>}
   */
  _loadByType(path, type, signal) {
    switch (type) {
      case 'gltf':
        return this._loadGLTF(path, signal);
      case 'texture':
        return this._loadTexture(path, signal);
      case 'hdr':
        return this._loadTexture(path, signal);
      case 'audio':
        return this._loadAudio(path, signal);
      default:
        return this._loadTexture(path, signal);
    }
  }

  /**
   * Load an asset with retry logic for transient failures.
   * @param {string} path
   * @param {string} type
   * @param {AbortSignal} signal
   * @param {number} maxRetries - Number of retries (0 = no retry)
   * @returns {Promise<object>}
   */
  async _loadWithRetry(path, type, signal, maxRetries) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await this._loadByType(path, type, signal);
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') throw err;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  /**
   * Load a GLTF/GLB model.
   * @param {string} path
   * @param {AbortSignal} signal
   * @returns {Promise<object>}
   */
  _loadGLTF(path, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const onAbort = () => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this._gltfLoader.load(
        path,
        (gltf) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          resolve({
            scene: gltf.scene,
            animations: gltf.animations || [],
            cameras: gltf.cameras || [],
            asset: gltf.asset,
            _raw: gltf,
          });
        },
        undefined,
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  /**
   * Load a texture image.
   * @param {string} path
   * @param {AbortSignal} signal
   * @returns {Promise<THREE.Texture>}
   */
  _loadTexture(path, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const onAbort = () => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this._textureLoader.load(
        path,
        (texture) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            texture.dispose();
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          resolve(texture);
        },
        undefined,
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  /**
   * Load an audio buffer.
   * @param {string} path
   * @param {AbortSignal} signal
   * @returns {Promise<AudioBuffer>}
   */
  _loadAudio(path, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const onAbort = () => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this._audioLoader.load(
        path,
        (buffer) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          resolve(buffer);
        },
        undefined,
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Internal: size estimation
  // -----------------------------------------------------------------------

  /**
   * Estimate the GPU memory of a loaded asset.
   * @param {object} asset
   * @param {string} type
   * @returns {number} Bytes
   */
  _estimateSize(asset, type) {
    if (!asset) return 0;

    switch (type) {
      case 'gltf':
        return asset.scene ? estimateGLTFSize(asset.scene) : 0;
      case 'texture':
      case 'hdr':
        return asset instanceof THREE.Texture ? estimateTextureSize(asset) : 0;
      case 'audio':
        // AudioBuffer: duration × sampleRate × numberOfChannels × 4 (Float32)
        if (asset && asset.duration) {
          return Math.ceil(asset.duration * asset.sampleRate * asset.numberOfChannels * 4);
        }
        return 0;
      default:
        return 0;
    }
  }

  // -----------------------------------------------------------------------
  // Internal: wait for active loads
  // -----------------------------------------------------------------------

  /**
   * Wait until all currently active loads complete.
   * @returns {Promise<void>}
   */
  _waitForActiveLoads() {
    return new Promise((resolve) => {
      const check = () => {
        if (this._activeLoads <= 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}

// Export priority constants for external use
export {
  PRIORITY_CRITICAL,
  PRIORITY_HIGH,
  PRIORITY_NORMAL,
  PRIORITY_LOW,
  PRIORITY_BACKGROUND,
};
