"use client";

import { useCallback } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";

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

type SignIn = (input?: SolanaSignInInput) => Promise<SolanaSignInOutput>;

/** Run the SIWS handshake and establish the server session cookie. */
async function establishSession(signIn: SignIn): Promise<void> {
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
}

/** Decode a base64 co-signed transaction from a co-sign endpoint response. */
export function deserializeCoSignTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(base64));
}

/** GET a co-sign endpoint — used for ungated previews (e.g. the relic offer). */
export async function fetchCoSign<T>(endpoint: string): Promise<T> {
  const res = await fetch(endpoint);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `request failed (${res.status})`);
  }
  return json;
}

/**
 * POST a session-gated endpoint. On a 401 it runs the SIWS flow once (via
 * `signIn`) and retries; the resulting `Response` is returned undecoded so the
 * caller can parse it however it needs.
 */
async function postWithSiws(
  endpoint: string,
  body: Record<string, unknown>,
  signIn: SignIn | undefined,
): Promise<Response> {
  const post = () =>
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const res = await post();
  if (res.status !== 401) return res;

  if (!signIn) {
    throw new Error(
      "This wallet does not support Sign In With Solana — cannot authorize game actions.",
    );
  }
  await establishSession(signIn);
  return post();
}

/**
 * Hook for the session-gated POST co-sign endpoints. Returns `requestCoSign`,
 * which POSTs the endpoint and, on a 401, runs SIWS once and retries.
 */
export function useCoSign() {
  const { signIn } = useWallet();

  const requestCoSign = useCallback(
    async (
      endpoint: string,
      body: Record<string, unknown> = {},
    ): Promise<VersionedTransaction> => {
      const res = await postWithSiws(endpoint, body, signIn);

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
    async <T>(
      endpoint: string,
      body: Record<string, unknown> = {},
    ): Promise<T> => {
      const res = await postWithSiws(endpoint, body, signIn);

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

  return { requestCoSign, requestJson };
}
