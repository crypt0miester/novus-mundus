// HTTP thread-key provider.
//
// The browser never holds K_master; it asks an authenticated key route which
// enforces per-scope membership and the join-gate before handing back the keys
// the caller is allowed to read. Keys are cached in-process by (thread,version).

import type { PublicKey } from '@solana/web3.js';
import type { ThreadKeyProvider } from './index';
import { WtKeyForbiddenError, WtAuthRequiredError } from './index';
import type { WtScope } from '../crypto/wartable';

interface KeyRouteResponse {
  current_version: number;
  keys: { version: number; k_base64: string }[];
}

function base64ToBytes(b64: string): Uint8Array {
  // Browser-safe base64 decode without Buffer.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class HttpKeyProvider implements ThreadKeyProvider {
  private cache = new Map<string, Uint8Array>();

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly baseUrl: string,
    private readonly scopeHint?: WtScope,
    /** Optional peer player PDA (base58), required for DM scope. */
    private readonly peer?: string,
  ) {}

  private buildUrl(threadPda: PublicKey, fromVersion: number): string {
    const params = new URLSearchParams();
    if (this.scopeHint !== undefined) params.set('scope', String(this.scopeHint));
    params.set('from_version', String(fromVersion));
    if (this.peer !== undefined) params.set('peer', this.peer);
    return `${this.baseUrl}/api/wt/key/${threadPda.toBase58()}?${params.toString()}`;
  }

  private async request(threadPda: PublicKey, fromVersion: number): Promise<KeyRouteResponse> {
    const res = await this.fetchFn(this.buildUrl(threadPda, fromVersion), {
      credentials: 'include',
    });
    if (res.status === 401) throw new WtAuthRequiredError();
    if (res.status === 403) throw new WtKeyForbiddenError(fromVersion);
    if (!res.ok) throw new Error(`war table key route failed: ${res.status}`);
    return (await res.json()) as KeyRouteResponse;
  }

  async getKey(threadPda: PublicKey, version: number): Promise<Uint8Array> {
    const cacheKey = `${threadPda.toBase58()}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const body = await this.request(threadPda, version);
    for (const entry of body.keys) {
      this.cache.set(`${threadPda.toBase58()}:${entry.version}`, base64ToBytes(entry.k_base64));
    }
    const found = this.cache.get(cacheKey);
    if (!found) throw new WtKeyForbiddenError(version);
    return found;
  }

  async getCurrentVersion(threadPda: PublicKey): Promise<number> {
    const body = await this.request(threadPda, 0);
    for (const entry of body.keys) {
      this.cache.set(`${threadPda.toBase58()}:${entry.version}`, base64ToBytes(entry.k_base64));
    }
    return body.current_version;
  }
}
