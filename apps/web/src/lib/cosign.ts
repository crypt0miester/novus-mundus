"use client";

import { useCallback } from "react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSessionStore } from "@/lib/store/session";

// SIWS types for the Sign-In-With-Solana handshake. The upstream
// `@solana/wallet-standard-features` package is no longer a direct dependency
// after the web3.js v3 migration, so we derive the input/output shapes straight
// from the wallet adapter's own `signIn` method. This keeps `SignIn` exactly
// assignment-compatible with `useWallet().signIn` and avoids re-importing the
// removed package.
type WalletSignIn = NonNullable<ReturnType<typeof useWallet>["signIn"]>;
type SolanaSignInInput = NonNullable<Parameters<WalletSignIn>[0]>;

/**
 * Client helpers for the game_authority co-sign API (`/api/cosign/*`).
 *
 * The POST co-sign endpoints require a Sign-In-With-Solana session — they
 * answer 401 without one. `useCoSign` handles that lazily: on a 401 it runs the
 * SIWS flow (one wallet prompt), then retries. A co-sign endpoint returns a
 * VersionedTransaction already partial-signed by the game server; pass it to
 * `useTransact` via `mutateAsync({ versionedTx })` so the connected wallet adds
 * the final signature before submitting.
 */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Iterable<number>): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type SignIn = WalletSignIn;

// A single in-flight SIWS handshake shared by every caller (the war-table gate
// click, the Send gesture, and the co-sign 401 retry), so concurrent triggers
// pop ONE wallet dialog rather than N. This is required state modeled directly,
// not a shim: the dialog is a genuinely singleton resource.
let inFlightSession: Promise<string> | null = null;

/**
 * Run the SIWS handshake and establish the server session cookie, returning the
 * signed-in owner (base58). Deduped: concurrent callers share one wallet prompt.
 * On success it records the owner in the session store, so any sign-in path
 * (war-table gate, Send, or a co-sign retry) clears the war-table gate.
 */
function establishSession(signIn: SignIn): Promise<string> {
  if (inFlightSession) return inFlightSession;
  inFlightSession = runSiwsHandshake(signIn).finally(() => {
    inFlightSession = null;
  });
  return inFlightSession;
}

async function runSiwsHandshake(signIn: SignIn): Promise<string> {
  const challenge = await fetch("/api/auth/siws");
  const { nonce } = (await challenge.json().catch(() => ({}))) as {
    nonce?: string;
  };
  if (!nonce) throw new Error("Could not start sign-in");

  const input: SolanaSignInInput = {
    domain: window.location.host,
    statement: "Sign in to authorize Novus Mundus game actions.",
    version: "1",
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const output = await signIn(input);

  const res = await fetch("/api/auth/siws", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input,
      output: {
        account: {
          address: output.account.address,
          publicKey: bytesToBase64(output.account.publicKey),
        },
        signedMessage: bytesToBase64(output.signedMessage),
        signature: bytesToBase64(output.signature),
      },
    }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Sign-in failed");
  }
  const { owner } = (await res.json().catch(() => ({}))) as { owner?: string };
  if (!owner) throw new Error("Sign-in succeeded but the server returned no owner");
  // Reject a non-pubkey owner at the boundary, then bind the client session.
  new PublicKey(owner);
  useSessionStore.getState().markSignedIn(owner);
  return owner;
}

/**
 * Establish the SIWS session cookie if one is needed (one wallet prompt).
 *
 * Exposed for the war-table sign-in gate and the Send gesture; both route here,
 * and the shared in-flight promise above guarantees a single prompt even when
 * they fire together.
 */
export async function ensureSession(signIn: SignIn): Promise<void> {
  await establishSession(signIn);
}

/** Decode a base64 co-signed transaction from a co-sign endpoint response. */
export function deserializeCoSignTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(base64));
}

/**
 * Fetch a session-gated endpoint. On a 401 it runs the SIWS flow once (via
 * `signIn`) and retries; the `Response` is returned undecoded so the caller can
 * parse it however it needs. Used by both the POST co-sign endpoints and the
 * GET previews (e.g. the relic offer), which are session-gated too.
 */
async function fetchWithSiws(
  endpoint: string,
  init: RequestInit | undefined,
  signIn: SignIn | undefined,
): Promise<Response> {
  const run = () => fetch(endpoint, init);

  const res = await run();
  if (res.status !== 401) return res;

  if (!signIn) {
    throw new Error(
      "This wallet does not support Sign In With Solana — cannot authorize game actions.",
    );
  }
  await establishSession(signIn);
  return run();
}

function jsonPost(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Hook for the session-gated POST co-sign endpoints. Returns `requestCoSign`,
 * which POSTs the endpoint and, on a 401, runs SIWS once and retries.
 */
export function useCoSign() {
  const { signIn } = useWallet();

  const requestCoSign = useCallback(
    async (endpoint: string, body: Record<string, unknown> = {}): Promise<VersionedTransaction> => {
      const res = await fetchWithSiws(endpoint, jsonPost(body), signIn);

      const json = (await res.json().catch(() => ({}))) as {
        transaction?: string;
        error?: string;
      };
      if (!res.ok || !json.transaction) {
        throw new Error(json.error ?? `co-sign request failed (${res.status})`);
      }
      return VersionedTransaction.deserialize(base64ToBytes(json.transaction));
    },
    [signIn],
  );

  /**
   * Hook variant for session-gated endpoints that return arbitrary JSON (the
   * mini-game `/start` and `/move` routes, the daily-activity co-sign). Same
   * lazy-SIWS handling as `requestCoSign`.
   */
  const requestJson = useCallback(
    async <T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetchWithSiws(endpoint, jsonPost(body), signIn);

      const json = (await res.json().catch(() => ({}))) as T & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `request failed (${res.status})`);
      }
      return json;
    },
    [signIn],
  );

  /**
   * Hook variant for session-gated GET previews (e.g. the dungeon relic offer).
   * Same lazy-SIWS handling as `requestJson`; owner is derived from the session
   * server-side, so no query param is needed.
   */
  const requestGetJson = useCallback(
    async <T>(endpoint: string): Promise<T> => {
      const res = await fetchWithSiws(endpoint, undefined, signIn);

      const json = (await res.json().catch(() => ({}))) as T & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `request failed (${res.status})`);
      }
      return json;
    },
    [signIn],
  );

  return { requestCoSign, requestJson, requestGetJson };
}
