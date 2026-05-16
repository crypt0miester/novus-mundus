import { VersionedTransaction } from "@solana/web3.js";

/**
 * Client helpers for the game_authority co-sign API (`/api/cosign/*`).
 *
 * A co-sign endpoint returns a VersionedTransaction already partial-signed by
 * the game server. Pass it to `useTransact` via `mutateAsync({ versionedTx })`
 * so the connected wallet adds the final signature before submitting.
 */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** POST a co-sign endpoint and return the game-authority-co-signed transaction. */
export async function requestCoSign(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<VersionedTransaction> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    transaction?: string;
    error?: string;
  };
  if (!res.ok || !json.transaction) {
    throw new Error(json.error ?? `co-sign request failed (${res.status})`);
  }
  return VersionedTransaction.deserialize(base64ToBytes(json.transaction));
}

/** GET a co-sign endpoint — used for previews (e.g. the relic offer). */
export async function fetchCoSign<T>(endpoint: string): Promise<T> {
  const res = await fetch(endpoint);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `request failed (${res.status})`);
  }
  return json;
}
