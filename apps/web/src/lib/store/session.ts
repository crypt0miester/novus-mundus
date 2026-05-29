"use client";

// SIWS session state for the client.
//
// The session is a server-side httpOnly cookie (see lib/server/session.ts), so
// the browser cannot read it directly. This store is the single reactive owner
// of the INFERRED session state, used to render the war-table sign-in gate
// without ever auto-prompting:
//   - `SessionProbe` asks GET /api/auth/session (no prompt) whenever the
//     connected wallet settles, and keeps `in` only if the cookie owner matches
//     that wallet, so the gate is right on first paint and a wallet switch
//     re-gates instead of decrypting another wallet's threads;
//   - the war-table key provider flips us to `out` the moment a key fetch 401s
//     (a lapsed or never-established session), again with no prompt;
//   - a successful SIWS handshake (cosign.ts) flips us to `in` with the owner.
// It is deliberately NOT persisted: a stale `in` would outlive the 30-minute
// cookie TTL and suppress the gate while every key fetch silently 401s.

import { create } from "zustand";
import { useEffect, useRef } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";

export type SessionStatus = "unknown" | "in" | "out";

interface SessionState {
  status: SessionStatus;
  // base58 wallet bound to the active session, when known (from the probe or the
  // SIWS POST). A key fetch confirms a session without revealing its owner, so
  // markKeyOk leaves this untouched.
  owner: string | null;
  markSignedIn: (owner: string) => void;
  markKeyOk: () => void;
  markSignedOut: () => void;
}

// Returning the existing state object short-circuits zustand's notify, so a
// redundant mark (e.g. a key fetch confirming an already-`in` session) does not
// churn subscribers or rebuild the war-table client.
export const useSessionStore = create<SessionState>((set) => ({
  status: "unknown",
  owner: null,
  markSignedIn: (owner) =>
    set((s) => (s.status === "in" && s.owner === owner ? s : { ...s, status: "in", owner })),
  markKeyOk: () => set((s) => (s.status === "in" ? s : { ...s, status: "in" })),
  markSignedOut: () =>
    set((s) => (s.status === "out" && s.owner === null ? s : { ...s, status: "out", owner: null })),
}));

interface ProbeResult {
  signedIn: boolean;
  owner: string | null;
}

// Strict-parse the probe response. A malformed body throws rather than coercing
// to signed-out: a broken probe must not silently gate everyone (and the read
// path self-corrects from the next key fetch anyway).
function parseProbe(raw: unknown): ProbeResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("session probe: malformed response");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.signedIn !== "boolean") {
    throw new Error("session probe: missing signedIn");
  }
  if (!obj.signedIn) return { signedIn: false, owner: null };
  if (typeof obj.owner !== "string" || obj.owner.length === 0) {
    throw new Error("session probe: signedIn without owner");
  }
  // Reject a non-pubkey owner at the boundary; throws on a malformed key.
  new PublicKey(obj.owner);
  return { signedIn: true, owner: obj.owner };
}

// Read the cookie owner from the no-prompt probe: the base58 owner of a valid
// session, or null when there is none. Throws on a transport/parse failure, in
// which case the caller leaves status unchanged rather than gating a session it
// could not disprove (a non-empty thread still resolves from its own key fetch).
async function fetchCookieOwner(): Promise<string | null> {
  const res = await fetch("/api/auth/session", { credentials: "include" });
  if (!res.ok) throw new Error(`session probe failed: ${res.status}`);
  const parsed = parseProbe(await res.json());
  return parsed.signedIn ? parsed.owner : null;
}

/**
 * Mount once near the app root. Resolves the session against the CONNECTED
 * wallet and keeps it reconciled. The cookie is owner-bound, so the session is
 * valid here only if its owner equals the connected wallet.
 *
 * Keyed on the wallet identity and gated on `connecting` (the autoConnect-
 * restore window, during which publicKey is briefly null): this avoids signing
 * out a valid session mid-restore, and a wallet SWITCH re-resolves under the new
 * identity instead of being a one-way trip to signed-out. The owner-vs-wallet
 * match lives in the probe itself, so it does not depend on `owner` having been
 * populated (a read can confirm a session via markKeyOk without an owner). Never
 * auto-prompts. Renders nothing.
 */
export function SessionProbe(): null {
  const { publicKey, connecting } = useWallet();
  const wallet = publicKey ? publicKey.toBase58() : null;
  // The previous SETTLED wallet, so a genuine switch can be told apart from the
  // initial probe (which must not flash the gate for a returning signed-in user).
  const prevWallet = useRef<string | null>(null);

  useEffect(() => {
    // Wait for autoConnect to settle; a transient null wallet is not a sign-out.
    if (connecting) return;
    if (wallet === null) {
      // Sign out only on a GENUINE disconnect (a wallet that was connected went
      // away). The initial pre-autoConnect tick is also null-with-connecting-
      // false, but prevWallet is null there, so we leave status untouched and a
      // returning signed-in user sees no gate flash before the wallet restores.
      if (prevWallet.current !== null) {
        useSessionStore.getState().markSignedOut();
        prevWallet.current = null;
      }
      return;
    }
    // A switch to a DIFFERENT wallet: gate synchronously so no read fires under
    // the previous wallet's cookie while the re-probe is in flight. The initial
    // probe (prevWallet null) skips this, so a valid session shows no gate flash.
    if (prevWallet.current !== null && prevWallet.current !== wallet) {
      useSessionStore.getState().markSignedOut();
    }
    prevWallet.current = wallet;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const attempt = (n: number) => {
      fetchCookieOwner()
        .then((cookieOwner) => {
          if (cancelled) return;
          // Keep the session only if the cookie belongs to THIS wallet; a cookie
          // for another wallet (a switch, a stale cookie) gates for a fresh sign-in.
          if (cookieOwner === wallet) {
            useSessionStore.getState().markSignedIn(wallet);
          } else {
            useSessionStore.getState().markSignedOut();
          }
        })
        .catch(() => {
          if (cancelled) return;
          // Ride out a transient blip with a couple of retries so an empty thread
          // (no key fetch to resolve it from) does not hang on the spinner. We do
          // NOT gate on failure: that would prompt a valid session needlessly.
          if (n < 2) retry = setTimeout(() => attempt(n + 1), 800);
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [wallet, connecting]);

  return null;
}
