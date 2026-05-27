// Main-thread Promise wrapper around bake.worker.ts. Lazy singleton —
// the Worker is constructed on first use so SSR doesn't trip over the
// browser-only `new Worker(...)` constructor.
//
// Cancellation semantics: `bake()` returns `{ promise, cancel }`. The
// cancel function resolves the Promise with `null` and forgets the
// pending entry — the Worker keeps running its in-flight job to
// completion but the result is dropped on receive. Callers check for
// null and bail. This avoids worker.terminate() churn at the cost of
// letting one stale bake finish in the background; bounded waste for
// our usage (a handful of city switches, never thousands).

import type { BakeRequest, BakeResponse } from "./bake.worker";
import type { BiomeKnobs } from "novus-mundus-sdk";

interface PendingJob {
  resolve: (data: Uint8Array | null) => void;
  reject: (err: Error) => void;
}

class BakeWorkerClient {
  private worker: Worker | null = null;
  private nextJobId = 1;
  private pending = new Map<number, PendingJob>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./bake.worker.ts", import.meta.url), {
      type: "module",
    });
    w.addEventListener("message", (e: MessageEvent<BakeResponse>) => {
      const { jobId, data } = e.data;
      const p = this.pending.get(jobId);
      if (!p) return; // cancelled or unknown
      this.pending.delete(jobId);
      p.resolve(data);
    });
    w.addEventListener("error", (e) => {
      // A worker-level error fails every pending job — there's no way
      // to attribute it to one. Better to surface than to hang the UI.
      // Drop the dead worker reference so the next bake reconstructs;
      // leaving it set would route every future postMessage at a corpse
      // and silently hang the high-res swap for the whole session.
      const err = new Error(`bake worker error: ${e.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (this.worker === w) this.worker = null;
      try {
        w.terminate();
      } catch {
        // Best-effort: if the worker is already dead, terminate is a no-op.
      }
    });
    this.worker = w;
    return w;
  }

  bake(req: Omit<BakeRequest, "jobId">): {
    promise: Promise<Uint8Array | null>;
    cancel: () => void;
  } {
    const w = this.ensureWorker();
    const jobId = this.nextJobId++;
    const promise = new Promise<Uint8Array | null>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      const msg: BakeRequest = { ...req, jobId };
      // Wrap postMessage so a synchronous throw (e.g. DataCloneError on
      // a future non-cloneable field) doesn't leak the pending entry —
      // remove it from the map and propagate the error to the caller.
      try {
        w.postMessage(msg);
      } catch (err) {
        this.pending.delete(jobId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    const cancel = () => {
      const p = this.pending.get(jobId);
      if (!p) return;
      this.pending.delete(jobId);
      p.resolve(null);
    };
    return { promise, cancel };
  }
}

let instance: BakeWorkerClient | null = null;

export function getBakeWorker(): BakeWorkerClient {
  if (!instance) instance = new BakeWorkerClient();
  return instance;
}

export type { BakeRequest, BakeResponse };
export type { BiomeKnobs };
