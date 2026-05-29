"use client";

// useWarTable: drives one war-table thread for a UI surface.
//
// Seeds the store from the SDK WarTableClient.readThread, subscribes for live
// messages, and exposes a `post` that sends an encrypted (or, for Encounter,
// plaintext) message. The SDK postMessage owns the priority-fee ceiling (BC5),
// so this hook just forwards the result and surfaces `congested`.
//
// Key access: encrypted scopes (Team/Rally/Castle/DM) read thread keys from the
// authenticated HttpKeyProvider, which the chain gates per membership and the
// join-epoch. On a 401 (WtAuthRequiredError) we run the SIWS session bootstrap
// once via ensureSession and retry the key fetch a single time.
//
// Encounter scope is plaintext by chain rule (flags bit0 = 0, key_version = 0).
// We MUST NOT fetch any key for it; we hand the SDK a provider that refuses to
// derive keys, which is never exercised because plaintext bodies skip decrypt.

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  WarTableClient,
  HttpKeyProvider,
  WtAuthRequiredError,
  WarTableScope,
  WtKind,
  WT_ID_ZERO,
  hexToId,
  idToHex,
  type ThreadKeyProvider,
  type ReadMessage,
  type PostMessageBody,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { ensureSession } from "@/lib/cosign";
import { notify } from "@/lib/notify";
import {
  useWarTableStore,
  ZERO_ID,
  type WtMessage,
  type ReactionChip,
} from "@/lib/store/war-table";

export interface UseWarTableOptions {
  // base58 PlayerAccount PDA of the DM peer; required for DM scope key access.
  peer?: string;
}

export interface UseWarTableResult {
  messages: WtMessage[];
  isLoading: boolean;
  // true while a scroll-up "load older" page is in flight.
  loadingOlder: boolean;
  // true when older history remains (a page cursor is available).
  hasMore: boolean;
  // Load the next older page (scroll-up). No-op when none remain or one is in flight.
  loadOlder: () => Promise<void>;
  // Send a text/reply/system message on the thread. Returns the tx signature.
  post: (body: PostMessageBody) => Promise<string>;
  // true when the last post clamped the priority fee to the ceiling under a fee
  // spike (the message was still sent at the ceiling).
  congested: boolean;
  // Current thread pin target hex (ZERO_ID = none), resolved by the store fold.
  pinnedId: string;
  // Post a reply (kind=3) quoting the parent message id. Returns the signature.
  replyTo: (parentId: string, text: string) => Promise<string>;
  // Delete a message (kind=4 tombstone of the message id). Own messages only,
  // gated upstream by the renderer.
  deleteMessage: (id: string) => Promise<string>;
  // React to a message (kind=5; parent = target message id, body = emoji).
  react: (parentId: string, emoji: string) => Promise<string>;
  // Un-react (kind=4 tombstone of MY OWN reaction message id, not the target).
  unreact: (myReactionId: string) => Promise<string>;
  // Resolve MY reaction message id for a (message, emoji), the un-react target.
  // Returns null when I have no live reaction of that emoji on the message.
  myReactionId: (parentId: string, emoji: string) => string | null;
  // Pin a message (kind=6; parent = target message id).
  pin: (id: string) => Promise<string>;
  // Unpin (kind=6 with a zero parent). No tombstone is required to unpin.
  unpin: () => Promise<string>;
}

const textDecoder = new TextDecoder();

// Stable empty-list reference for the unseeded-thread case. Returning a fresh
// `[]` from the selector below would mint a new array on every call, and under
// zustand v5 (no useSyncExternalStoreWithSelector memoization) React's snapshot
// consistency check then loops with "getSnapshot should be cached".
const EMPTY_MESSAGES: WtMessage[] = [];

// Map an SDK ReactionSummary list onto the store's ReactionChip shape. The SDK
// computes mine/myReactionId when given myWallet; the store keeps reactorWallets
// (the renderer derives mine) and myReactionId (the seed un-react target).
function toStoreReactions(
  reactions: ReadMessage["reactions"],
): ReactionChip[] | undefined {
  if (!reactions || reactions.length === 0) return undefined;
  return reactions.map((r) => {
    const chip: ReactionChip = {
      emoji: r.emoji,
      count: r.count,
      reactorWallets: r.reactorWallets,
    };
    if (r.myReactionId !== undefined) chip.myReactionId = r.myReactionId;
    return chip;
  });
}

// Map an SDK ReadMessage into the store's display shape. Locked or tombstoned
// messages carry an empty body; the renderer draws the placeholder. Folded
// reaction chips ride along (the SDK readThread/readThreadWithSystem fold has
// already aggregated and dropped the kind=5 messages).
function toStoreMessage(m: ReadMessage): WtMessage {
  const locked = !m.decrypted;
  const body = locked || m.tombstoned ? "" : textDecoder.decode(m.payload);
  const msg: WtMessage = {
    id: idToHex(m.id),
    threadPda: m.threadPda.toBase58(),
    senderWallet: m.senderWallet.toBase58(),
    kind: m.kind,
    createdAt: Number(m.createdAt),
    parentId: idToHex(m.parentId),
    body,
    locked,
    tombstoned: m.tombstoned === true,
  };
  const reactions = toStoreReactions(m.reactions);
  if (reactions) msg.reactions = reactions;
  return msg;
}

// Resolve the thread pin hex from a SDK fold result. readThread/read
// ThreadWithSystem stamp the same thread-wide pinnedId (a Uint8Array, WT_ID_ZERO
// when none) on every returned bubble, so reading it off the first message is
// sufficient; an empty thread has no pin.
function pinHexFrom(read: ReadMessage[]): string {
  const first = read[0];
  if (!first || !first.pinnedId) return ZERO_ID;
  return idToHex(first.pinnedId);
}

// A key provider that delegates to the real HttpKeyProvider but, on a lapsed
// session (401), runs ensureSession once and retries the underlying call a
// single time. Owning the retry here keeps it transparent to every SDK code
// path (read, subscribe, post) rather than scattering it across call sites.
class SessionRetryKeyProvider implements ThreadKeyProvider {
  constructor(
    private readonly inner: ThreadKeyProvider,
    private readonly reauth: () => Promise<void>,
  ) {}

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof WtAuthRequiredError) {
        await this.reauth();
        return call();
      }
      throw err;
    }
  }

  getKey(threadPda: PublicKey, version: number): Promise<Uint8Array> {
    return this.withRetry(() => this.inner.getKey(threadPda, version));
  }

  getCurrentVersion(threadPda: PublicKey): Promise<number> {
    return this.withRetry(() => this.inner.getCurrentVersion(threadPda));
  }
}

// Encounter scope is plaintext: no key derivation is allowed. The SDK never
// calls this for plaintext bodies, so any call is a programming error.
class NoKeyProvider implements ThreadKeyProvider {
  getKey(): Promise<Uint8Array> {
    return Promise.reject(new Error("war table: Encounter scope is plaintext; no key fetch"));
  }
  getCurrentVersion(): Promise<number> {
    return Promise.resolve(0);
  }
}

export function useWarTable(
  threadPda: PublicKey,
  scope: WarTableScope,
  opts: UseWarTableOptions = {},
): UseWarTableResult {
  const client = useNovusMundusClient();
  const { publicKey, signTransaction, signIn } = useWallet();
  const myPlayerPda = useAccountStore((s) => s.myPlayerPda);

  const messages = useWarTableStore(
    (s) => s.threads.get(threadPda.toBase58())?.messages ?? EMPTY_MESSAGES,
  );
  const isLoading = useWarTableStore(
    (s) => s.threads.get(threadPda.toBase58())?.loading ?? false,
  );
  // ZERO_ID is the not-loaded / no-pin default for an absent thread entry, not a
  // required-state shim: the store always resolves a concrete pinnedId.
  const pinnedId = useWarTableStore(
    (s) => s.threads.get(threadPda.toBase58())?.pinnedId ?? ZERO_ID,
  );
  const [congested, setCongested] = useState(false);
  // Scroll-up pagination cursor: undefined = not seeded yet, null = start of
  // history reached, string = the next older page's opaque cursor.
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const peer = opts.peer;
  const threadBase58 = threadPda.toBase58();
  const isEncounter = scope === WarTableScope.Encounter;
  // base58 of the connected wallet, used to populate SDK-side reaction `mine`
  // and `myReactionId` on the seed read. Live reactions resolve mine in the
  // renderer from reactorWallets; this only pre-fills the seed un-react target.
  const myWallet = publicKey ? publicKey.toBase58() : undefined;

  // Build the war-table client for this thread. Encounter scope uses a key
  // provider that refuses to derive keys (plaintext only); every other scope
  // uses the session-gated HTTP key route wrapped with one reauth retry.
  const wtClient = useMemo(() => {
    // Bind the browser fetch, but never touch `window` during SSR; the key
    // route is only ever called client-side from the effect/post paths, so the
    // global `fetch` placeholder on the server is never invoked.
    const fetchFn: typeof fetch =
      typeof window === "undefined" ? fetch : window.fetch.bind(window);
    const keyProvider: ThreadKeyProvider = isEncounter
      ? new NoKeyProvider()
      : new SessionRetryKeyProvider(
          new HttpKeyProvider(fetchFn, "", scope, peer),
          async () => {
            if (!signIn) {
              throw new Error(
                "This wallet does not support Sign In With Solana; cannot read war-table keys.",
              );
            }
            await ensureSession(signIn);
          },
        );
    return new WarTableClient({ connection: client.connection, keyProvider });
    // signIn is captured by the reauth closure; rebuild if it changes identity.
  }, [client.connection, scope, peer, isEncounter, signIn]);

  // Seed the store from the chain history, then keep it live via onLogs. The
  // store actions are stable Zustand setters, so they are read off getState()
  // rather than subscribed (matches the codebase hook convention).
  useEffect(() => {
    let cancelled = false;
    // Reconstruct the thread key from the stable base58 string so the effect's
    // only identity dependency is that string, not a possibly-fresh PublicKey.
    const thread = new PublicKey(threadBase58);
    useWarTableStore.getState().setThreadLoading(threadBase58, true);
    // Fresh thread: forget the previous thread's scroll cursor.
    setOlderCursor(undefined);
    setLoadingOlder(false);

    // Seed the most recent page (RAW, with derived System lines) and keep the
    // cursor for scroll-up. RAW messages flow through the store's ingest fold —
    // the same path live messages use — so reactions/pins/tombstones resolve
    // identically; `mine` is derived in the renderer from reactorWallets.
    wtClient
      .readThreadPageWithSystem(thread, scope, { limit: 60 })
      .then((page) => {
        if (cancelled) return;
        useWarTableStore.getState().ingestMessages(threadBase58, page.messages.map(toStoreMessage));
        setOlderCursor(page.nextCursor);
      })
      .catch(() => {
        if (cancelled) return;
        useWarTableStore.getState().setThreadLoading(threadBase58, false);
      });

    const sub = wtClient.subscribeThread(thread, (msg) => {
      if (cancelled) return;
      // subscribeThread is intentionally raw (one blob at a time, no fold), so
      // reaction/pin/tombstone messages reach the store and ITS fold resolves
      // them. New System lines appear on the next reconcile, not live.
      useWarTableStore.getState().upsertMessage(toStoreMessage(msg));
    });

    // Catch-up reconcile: onLogs can silently drop a notification on a flaky
    // socket, and only the initial read runs on mount. A low-frequency re-read
    // (plus one on tab refocus) merges anything missed, deduped by id, without
    // clobbering local pendings. Scoped to recent signatures to stay cheap.
    const reconcile = () => {
      wtClient
        .readThreadWithSystem(thread, scope, { limit: 50, myWallet })
        .then((read) => {
          if (cancelled) return;
          useWarTableStore
            .getState()
            .mergeThreadMessages(threadBase58, read.map(toStoreMessage), pinHexFrom(read));
        })
        .catch(() => {});
    };
    const interval = setInterval(reconcile, 25_000);
    const onFocus = () => reconcile();
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      sub.unsubscribe();
      clearInterval(interval);
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
    };
  }, [wtClient, threadBase58, scope, myWallet]);

  const post = useCallback(
    async (body: PostMessageBody): Promise<string> => {
      if (!publicKey || !signTransaction) {
        throw new Error("Connect a wallet to post.");
      }
      if (!myPlayerPda) {
        throw new Error("Player not loaded yet.");
      }

      const sender = publicKey;
      const senderPlayer = new PublicKey(myPlayerPda);
      // Gate accounts per scope (canonical account list, spec section 2):
      // Team/Encounter take none (membership resolves from sender_player). DM
      // takes both PlayerAccount PDAs; we have them from senderPlayer + peer.
      // Rally/Castle gate PDAs need rally/castle context the shared prop chain
      // does not carry, so this generic post path supports Team, Encounter and
      // DM; those scopes are the ones routed through ThreadRenderer today.
      let gateAccounts: PublicKey[] = [];
      if (scope === WarTableScope.Dm) {
        if (!peer) {
          throw new Error("DM scope requires a peer player.");
        }
        gateAccounts = [senderPlayer, new PublicKey(peer)];
      }

      // Optimistic echo: show the message instantly under a temporary id that
      // sorts last (the "z" prefix sorts after any hex id). The real chain copy
      // arrives via onLogs and the store reconciles the two by sender/kind/body.
      // On failure we roll the echo back.
      const threadKey = threadPda.toBase58();
      const tempId = `z${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`;
      const echoText =
        typeof body.payload === "string" ? body.payload : new TextDecoder().decode(body.payload);
      useWarTableStore.getState().addPendingMessage({
        id: tempId,
        threadPda: threadKey,
        senderWallet: sender.toBase58(),
        kind: body.kind,
        createdAt: body.createdAt ? Number(body.createdAt) : Math.floor(Date.now() / 1000),
        parentId: body.parentId ? idToHex(body.parentId) : ZERO_ID,
        body: echoText,
        locked: false,
        tombstoned: false,
        pending: true,
      });

      try {
        const result = await wtClient.postMessage(
          threadPda,
          scope,
          gateAccounts,
          sender,
          senderPlayer,
          body,
          (tx: Transaction) => signTransaction(tx),
        );
        setCongested(result.congested);
        // Leave the optimistic echo in place; the chain copy reconciles it.
        return result.signature;
      } catch (err) {
        useWarTableStore.getState().removeMessage(threadKey, tempId);
        // An epoch race: the key the client posted under was rotated by a
        // membership change between read and send, so the chain rejected the
        // key_version. Surface a retry hint rather than a raw program error.
        const message = err instanceof Error ? err.message : String(err);
        if (/KeyVersionMismatch|8307/.test(message)) {
          notify.error({ title: "Membership changed, please retry" });
        } else {
          notify.error({ title: "Could not send message", message });
        }
        throw err;
      }
    },
    [wtClient, threadPda, scope, peer, publicKey, signTransaction, myPlayerPda],
  );

  // Reply (kind=3) quoting the parent. The optimistic echo shows the reply text
  // immediately; MessageBubble already renders the parent quote.
  const replyTo = useCallback(
    (parentId: string, text: string): Promise<string> =>
      post({ kind: WtKind.Reply, payload: text, parentId: hexToId(parentId) }),
    [post],
  );

  // Delete (kind=4 tombstone of the message id). The store fold hides the parent
  // on the optimistic echo and again on the chain copy.
  const deleteMessage = useCallback(
    (id: string): Promise<string> =>
      post({ kind: WtKind.Tombstone, payload: "", parentId: hexToId(id) }),
    [post],
  );

  // React (kind=5; parent = target message id, body = the emoji). The optimistic
  // echo folds onto the parent's chip immediately via the store reaction fold.
  const react = useCallback(
    (parentId: string, emoji: string): Promise<string> =>
      post({ kind: WtKind.Reaction, payload: emoji, parentId: hexToId(parentId) }),
    [post],
  );

  // Un-react (kind=4 tombstone of MY OWN reaction message id, NOT the target
  // message). The store tombstone fold marks the reaction record tombstoned and
  // recomputes the chip.
  const unreact = useCallback(
    (reactionId: string): Promise<string> =>
      post({ kind: WtKind.Tombstone, payload: "", parentId: hexToId(reactionId) }),
    [post],
  );

  // Resolve MY reaction message id for a (message, emoji): the un-react target.
  // Live reactions are found in reactionRecords by my wallet; the seed chip
  // carries myReactionId as a fallback. Returns null when I have no live
  // reaction of that emoji on the message.
  const myReactionId = useCallback(
    (parentId: string, emoji: string): string | null => {
      const entry = useWarTableStore.getState().threads.get(threadBase58);
      if (!entry) return null;
      const recs = entry.reactionRecords.get(parentId);
      if (recs && myWallet !== undefined) {
        const mine = recs.find(
          (r) => !r.tombstoned && r.sender === myWallet && r.emoji === emoji,
        );
        if (mine) return mine.id;
      }
      const parent = entry.messages.find((m) => m.id === parentId);
      const chip = parent?.reactions?.find((c) => c.emoji === emoji);
      return chip?.myReactionId ?? null;
    },
    [threadBase58, myWallet],
  );

  // Pin (kind=6; parent = target message id).
  const pin = useCallback(
    (id: string): Promise<string> =>
      post({ kind: WtKind.Pin, payload: "", parentId: hexToId(id) }),
    [post],
  );

  // Unpin (kind=6 with a zero parent). No tombstone is needed to unpin.
  const unpin = useCallback(
    (): Promise<string> => post({ kind: WtKind.Pin, payload: "", parentId: WT_ID_ZERO }),
    [post],
  );

  // Scroll-up: fetch the next older page and fold it into the thread. The opaque
  // cursor keeps the walk on one fetch path; insertSorted slots older messages
  // in at the front. No-op when no older history remains or one is in flight.
  const loadOlder = useCallback(async () => {
    if (loadingOlder || olderCursor === null || olderCursor === undefined) return;
    setLoadingOlder(true);
    try {
      const thread = new PublicKey(threadBase58);
      const page = await wtClient.readThreadPageWithSystem(thread, scope, { cursor: olderCursor });
      useWarTableStore.getState().ingestMessages(threadBase58, page.messages.map(toStoreMessage));
      setOlderCursor(page.nextCursor);
    } catch {
      // Keep the cursor so a later scroll can retry this same page.
    } finally {
      setLoadingOlder(false);
    }
  }, [wtClient, threadBase58, scope, olderCursor, loadingOlder]);

  // != null is true only for a concrete cursor string (undefined/null both mean
  // "nothing more to load": not-seeded or start-of-history reached).
  const hasMore = olderCursor != null;

  return {
    messages,
    isLoading,
    loadingOlder,
    hasMore,
    loadOlder,
    post,
    congested,
    pinnedId,
    replyTo,
    deleteMessage,
    react,
    unreact,
    myReactionId,
    pin,
    unpin,
  };
}
