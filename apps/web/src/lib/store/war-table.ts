"use client";

// War-table client store.
//
// Holds decoded thread messages and discovered DM conversations. The hooks
// (useWarTable, useDmInbox) seed this from the SDK WarTableClient (readThread /
// subscribeThread / discoverDmThreads) and upsert live messages into it.
//
// Ordering is by the 12-byte chain coordinate id (slot | txDisc | log_index).
// We compare it as a hex string so the lexicographic order matches the on-chain
// numeric order (big-endian) without re-parsing the integer fields. txDisc is
// the leading 3 bytes of the transaction signature, a per-tx discriminator the
// SDK derives identically on every read path, so two messages posted in the
// same slot in different transactions get distinct ids instead of colliding.
// Within a single slot, order is by txDisc (signature-arbitrary), then logIndex.
//
// Tombstone fold: a kind=4 (Tombstone) message names a parentId; ingesting it
// marks that parent message tombstoned and clears its body. A tombstone whose
// parent has not arrived yet is remembered so the fold still applies once the
// parent is ingested.
//
// Reaction fold: a kind=5 (Reaction) message names the reacted-to parentId and
// carries the emoji as its body. Reactions are never bubbles; they are grouped
// per parent and aggregated onto the parent message's reactions[] summary.
// Un-react is a kind=4 tombstone whose parent is the reactor's OWN reaction
// message id (not the reacted-to message), so the tombstone fold also scans the
// reaction records.
//
// Pin fold: a kind=6 (Pin) message names the pinned message id as its parentId,
// or the all-zero id to unpin. The current pin is the highest-id (latest)
// non-tombstoned kind=6; its parentId is the pinned target (ZERO_ID = none).
// Pin/reaction messages are never inserted as bubbles.

import { create } from "zustand";
import { WtKind } from "novus-mundus-sdk";

export interface WtMessage {
  // 12-byte ordering coordinate, hex-encoded. This is the message identity and
  // the sort key.
  id: string;
  // base58 thread PDA this message belongs to.
  threadPda: string;
  // base58 signing wallet that posted the message.
  senderWallet: string;
  kind: WtKind;
  // advisory unix-seconds timestamp carried in the body (display only; ordering
  // uses id, not this).
  createdAt: number;
  // 12-byte parent id, hex-encoded. All-zero hex when this is a root message.
  parentId: string;
  // decoded UTF-8 text. Empty string when locked or tombstoned.
  body: string;
  // true when the body could not be decrypted (no key for this version).
  locked: boolean;
  // true when a later Tombstone hid this message.
  tombstoned: boolean;
  // true for an optimistic local echo that has not yet been confirmed on chain.
  // Such a message carries a temporary id (sorts last) and is reconciled away
  // when the real, chain-confirmed copy arrives.
  pending?: boolean;
  // Folded reaction summary: one entry per distinct emoji, in first-seen order.
  // Recomputed by the store fold whenever a reaction record for this message
  // changes. mine is NOT set by the store (the store is wallet-agnostic); the
  // renderer marks mine against the connected wallet from reactorWallets.
  reactions?: ReactionChip[];
}

// One distinct emoji's folded reaction summary on a parent message. count is the
// number of live (non-tombstoned) reactions of this emoji; reactorWallets are
// the base58 reactor wallets in first-seen order. The renderer derives `mine`
// and the un-react target id from reactorWallets vs the connected wallet plus
// the per-(parent,emoji) reactor-to-reaction-id map exposed by the hook.
export interface ReactionChip {
  emoji: string;
  count: number;
  reactorWallets: string[];
  // Only set on the seed path (from the SDK fold given myWallet): the hex id of
  // MY reaction message for this emoji, the un-react tombstone target. Live
  // reactions resolve this from reactionRecords instead. The renderer derives
  // `mine` from reactorWallets vs the connected wallet, not from this field.
  myReactionId?: string;
}

// One raw reaction record, grouped under the reacted-to (parent) message hex id.
// id is the reaction message's own id (the un-react tombstone target); sender is
// the reactor wallet; tombstoned flips when the un-react tombstone lands.
export interface ReactionRecord {
  id: string;
  emoji: string;
  sender: string;
  tombstoned: boolean;
  // true for an optimistic local echo carrying a temp id; reconciled away when
  // the real chain reaction for the same (sender, emoji) lands.
  pending?: boolean;
}

export interface DmConvo {
  // base58 DM pair thread PDA.
  threadPda: string;
  // base58 PlayerAccount PDA of the other participant.
  peerPlayerPda: string;
  // hex-encoded id of the most recent message in the conversation.
  lastMessageId: string;
  // short preview text for the inbox row.
  lastPreview: string;
}

interface ThreadEntry {
  messages: WtMessage[];
  loading: boolean;
  // ids of tombstone parents seen before the parent message itself arrived; the
  // fold is applied retroactively when the parent is later upserted.
  pendingTombstones: Set<string>;
  // Current pin target hex (the pinned message id), or ZERO_ID for none.
  pinnedId: string;
  // Highest kind=6 (Pin) message id seen, used to resolve the current pin. Out
  // of order pin arrivals resolve to the latest by id (hex string compare,
  // matching the on-chain numeric order).
  maxPinId: string;
  // true when the current maxPinId/pinnedId came from an optimistic pin echo
  // (temp id). A real chain pin always overrides a pending one regardless of id
  // ordering, since the temp "z" id sorts above any real hex id.
  pinPending: boolean;
  // Raw reaction records grouped by the reacted-to (parent) message hex id. The
  // reactions[] summary on each parent WtMessage is recomputed from this.
  reactionRecords: Map<string, ReactionRecord[]>;
}

// All-zero hex id: a root message's parent, an unpin target, and the "no pin"
// sentinel.
export const ZERO_ID = "000000000000000000000000";

function emptyThread(): ThreadEntry {
  return {
    messages: [],
    loading: false,
    pendingTombstones: new Set(),
    pinnedId: ZERO_ID,
    maxPinId: ZERO_ID,
    pinPending: false,
    reactionRecords: new Map(),
  };
}

// Recompute a parent message's reactions[] summary from its raw records: live
// (non-tombstoned) records grouped by emoji in first-seen order. Returns an
// empty array when the parent has no live reactions.
function summarizeReactions(records: ReactionRecord[] | undefined): ReactionChip[] {
  if (!records || records.length === 0) return [];
  const byEmoji = new Map<string, ReactionChip>();
  for (const r of records) {
    if (r.tombstoned) continue;
    const chip = byEmoji.get(r.emoji);
    if (chip) {
      chip.count += 1;
      chip.reactorWallets.push(r.sender);
    } else {
      byEmoji.set(r.emoji, { emoji: r.emoji, count: 1, reactorWallets: [r.sender] });
    }
  }
  return [...byEmoji.values()];
}

// Insert (or replace) a message keeping the list sorted ascending by id. Ids are
// fixed-width hex so a plain string compare reproduces the byte order, which
// reproduces the numeric (slot, tx_index, log_index) order.
function insertSorted(list: WtMessage[], msg: WtMessage): WtMessage[] {
  const next = list.filter((m) => m.id !== msg.id);
  let lo = 0;
  let hi = next.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (next[mid]!.id < msg.id) lo = mid + 1;
    else hi = mid;
  }
  next.splice(lo, 0, msg);
  return next;
}

// A pending optimistic echo and its real chain-confirmed copy share sender,
// kind and body but not id. When the real copy lands we drop the matching
// pending so the two never both render.
function matchesPending(pending: WtMessage, real: WtMessage): boolean {
  return (
    pending.pending === true &&
    pending.senderWallet === real.senderWallet &&
    pending.kind === real.kind &&
    pending.parentId === real.parentId &&
    pending.body === real.body
  );
}

// Fold one message into a thread entry: reconcile any optimistic pending it
// confirms, apply the tombstone/reaction/pin folds, and (for visible kinds)
// insert it in id order. This is the single merge path shared by live upserts,
// the initial seed, the periodic reconcile, and optimistic echoes.
//
// Reaction (kind=5) and pin (kind=6) messages are NEVER inserted as bubbles;
// they are folded onto their parent (reactions) or resolve the thread pin
// (pins). Tombstone (kind=4) is extended to un-react (when its parent is a
// reaction message) and to clear the current pin (when its parent is the pin
// message itself).
function ingest(prev: ThreadEntry, msg: WtMessage): ThreadEntry {
  const pendingTombstones = new Set(prev.pendingTombstones);

  // Status (kind=1) is the Public-scope presence ping: empty payload, never a
  // chat bubble. Drop it before any fold so it cannot land in the message list
  // (presence is read off chain signatures, not the store).
  if (msg.kind === WtKind.Status) return prev;

  // A real (non-pending) message confirms at most one optimistic echo; drop it.
  // This applies to every kind, including reactions/pins/tombstones, which all
  // have a matching pending echo when posted locally.
  let messages = msg.pending ? prev.messages : prev.messages.filter((m) => !matchesPending(m, msg));

  // Reaction: record it under its parent and recompute that parent's chips. Not
  // a bubble. If the parent has not arrived yet, the record is retained keyed by
  // parentId and the summary applies when the parent later lands.
  if (msg.kind === WtKind.Reaction) {
    const reactionRecords = new Map(prev.reactionRecords);
    let records = (reactionRecords.get(msg.parentId) ?? []).slice();
    // A real reaction confirms its optimistic echo: drop the pending record for
    // the same (sender, emoji) so the chip does not double-count. A pending echo
    // carries a temp id (the "z" prefix), distinct from the real chain id.
    if (msg.pending !== true) {
      records = records.filter(
        (r) => !(r.pending === true && r.sender === msg.senderWallet && r.emoji === msg.body),
      );
    }
    // If an un-react tombstone for this reaction arrived first, it lands here as
    // already-tombstoned (out-of-order un-react).
    const tombstoned = pendingTombstones.has(msg.id);
    // Dedup by reaction message id so a reconcile re-read does not double-count.
    if (!records.some((r) => r.id === msg.id)) {
      records.push({
        id: msg.id,
        emoji: msg.body,
        sender: msg.senderWallet,
        tombstoned,
        pending: msg.pending === true,
      });
    }
    reactionRecords.set(msg.parentId, records);
    return {
      ...prev,
      messages: applyReactions(messages, msg.parentId, records),
      pendingTombstones,
      reactionRecords,
    };
  }

  // Pin: resolve the current pin from the highest-id non-tombstoned kind=6. A
  // lower-id pin is ignored; a zero-parent pin is an unpin. Not a bubble. A real
  // chain pin always overrides a pending echo (the temp "z" id sorts above any
  // real hex id, so an id compare alone would wrongly keep the stale echo).
  if (msg.kind === WtKind.Pin) {
    const overridesPending = msg.pending !== true && prev.pinPending;
    if (overridesPending || msg.id > prev.maxPinId) {
      return {
        ...prev,
        messages,
        pendingTombstones,
        maxPinId: msg.id,
        pinnedId: msg.parentId,
        pinPending: msg.pending === true,
      };
    }
    return { ...prev, messages, pendingTombstones };
  }

  // Tombstone: hides a chat message (a bubble), un-reacts a reaction, or clears
  // the pin, depending on what its parent id points at.
  if (msg.kind === WtKind.Tombstone && msg.parentId !== ZERO_ID) {
    // Pin clear: the tombstone targets the live pin message itself. Pin/reaction
    // tombstones are never bubbles; only their fold effect applies.
    if (msg.parentId === prev.maxPinId) {
      return { ...prev, messages, pendingTombstones, pinnedId: ZERO_ID };
    }

    // Un-react: the tombstone targets one of the reaction message ids. Scan the
    // reaction records; if found, mark it tombstoned, recompute the parent chip,
    // and do NOT insert the tombstone as a bubble.
    const reactionRecords = new Map(prev.reactionRecords);
    for (const [parentKey, recs] of reactionRecords) {
      const idx = recs.findIndex((r) => r.id === msg.parentId);
      if (idx === -1) continue;
      const next = recs.slice();
      next[idx] = { ...next[idx]!, tombstoned: true };
      reactionRecords.set(parentKey, next);
      return {
        ...prev,
        messages: applyReactions(messages, parentKey, next),
        pendingTombstones,
        reactionRecords,
      };
    }

    // Chat message: fold the tombstone onto the present parent bubble and keep
    // the tombstone bubble (the renderer hides it), matching the existing
    // chat-delete behavior and the SDK fold's bubble list.
    const parentIdx = messages.findIndex((m) => m.id === msg.parentId);
    if (parentIdx !== -1) {
      messages = messages.slice();
      messages[parentIdx] = { ...messages[parentIdx]!, body: "", tombstoned: true };
      return { ...prev, messages: insertSorted(messages, msg), pendingTombstones };
    }

    // Parent not present yet: this is either a chat-delete whose victim has not
    // arrived or an un-react whose reaction has not arrived. Remember it so the
    // fold applies when the parent lands (the reaction-ingest and the
    // pending-target branches below both honor pendingTombstones). Insert the
    // tombstone as a bubble for the chat-delete case, matching existing
    // behavior; if the parent turns out to be a reaction it is reconciled on
    // arrival and this bubble carries an empty body the renderer hides.
    pendingTombstones.add(msg.parentId);
    return { ...prev, messages: insertSorted(messages, msg), pendingTombstones };
  }

  // A non-reaction, non-pin message that lands as a pending tombstone target is
  // folded immediately. Reactions are handled above; a pending tombstone for a
  // reaction id is reconciled when the reaction record is ingested.
  let incoming = pendingTombstones.has(msg.id)
    ? { ...msg, body: "", tombstoned: true }
    : msg;

  // A chat message that just arrived may already carry reaction records (the
  // reactions landed before the parent). Stamp its folded chips on insert.
  const existingRecords = prev.reactionRecords.get(msg.id);
  if (existingRecords) {
    incoming = { ...incoming, reactions: summarizeReactions(existingRecords) };
  }

  return {
    ...prev,
    messages: insertSorted(messages, incoming),
    pendingTombstones,
  };
}

// Reconstruct the store's raw reactionRecords from a SDK-folded seed list. The
// SDK fold drops the kind=5 messages and keeps only the aggregated reactions[]
// per bubble, so we rebuild one record per reactor wallet to keep counts and
// reactor lists exact for later live recomputes. The real reaction message id
// is only recoverable for MY reactions (the SDK passes it through as
// myReactionId); since the un-react target for a seeded chip is read off
// chip.myReactionId by the hook, other reactors get a deterministic synthetic
// id, and my record carries the real id when the chip exposes one.
function seedReactionRecords(seed: WtMessage[]): Map<string, ReactionRecord[]> {
  const records = new Map<string, ReactionRecord[]>();
  for (const m of seed) {
    if (!m.reactions || m.reactions.length === 0) continue;
    const recs: ReactionRecord[] = [];
    for (const chip of m.reactions) {
      let myIdAssigned = false;
      for (let i = 0; i < chip.reactorWallets.length; i++) {
        const sender = chip.reactorWallets[i]!;
        // Give the real id to one record per emoji when the SDK exposed mine.
        // The hook resolves un-react off chip.myReactionId directly, so the
        // record id only needs to be stable and unique for dedup.
        let id = `seed:${m.id}:${chip.emoji}:${sender}:${i}`;
        if (!myIdAssigned && chip.myReactionId !== undefined) {
          id = chip.myReactionId;
          myIdAssigned = true;
        }
        recs.push({ id, emoji: chip.emoji, sender, tombstoned: false });
      }
    }
    records.set(m.id, recs);
  }
  return records;
}

// Recompute and write back a parent message's reactions[] from its records. If
// the parent is not in the list yet (reaction arrived first), returns the list
// unchanged; ingest stamps the chips when the parent later lands.
function applyReactions(
  list: WtMessage[],
  parentId: string,
  records: ReactionRecord[],
): WtMessage[] {
  const idx = list.findIndex((m) => m.id === parentId);
  if (idx === -1) return list;
  const next = list.slice();
  next[idx] = { ...next[idx]!, reactions: summarizeReactions(records) };
  return next;
}

export interface WtState {
  // keyed by base58 thread PDA.
  threads: Map<string, ThreadEntry>;
  // keyed by base58 thread PDA.
  dmConversations: Map<string, DmConvo>;

  // Upsert a single message into its thread, applying the tombstone fold and
  // reconciling any optimistic pending it confirms.
  upsertMessage: (msg: WtMessage) => void;
  // Ingest a batch of RAW messages (the same fold as upsertMessage, in one
  // store update) and clear loading. Used by the seed and the scroll-up
  // load-older page; insertSorted keeps order so older pages slot in at the
  // front automatically.
  ingestMessages: (threadPda: string, messages: WtMessage[]) => void;
  // Insert an optimistic local echo (pending). Reconciled away by the real copy.
  addPendingMessage: (msg: WtMessage) => void;
  // Remove an optimistic echo by id (e.g. when the send failed).
  removeMessage: (threadPda: string, id: string) => void;
  // Replace a thread's whole message list (initial readThread seed). pinnedId is
  // the SDK-resolved thread pin target hex (ZERO_ID = none); the seed list is
  // SDK-folded so it carries no kind=5/6 bubbles.
  setThreadMessages: (threadPda: string, messages: WtMessage[], pinnedId?: string) => void;
  // Merge a freshly-read batch into a thread without dropping local pendings
  // (the periodic catch-up reconcile and reconnect path). pinnedId, when given,
  // is the SDK-resolved pin from the same reconcile read.
  mergeThreadMessages: (
    threadPda: string,
    messages: WtMessage[],
    pinnedId?: string,
  ) => void;
  setThreadLoading: (threadPda: string, loading: boolean) => void;
  // Read a thread's current message list (empty array when unseen).
  getThreadMessages: (threadPda: string) => WtMessage[];
  // Read a thread's current pin target hex (ZERO_ID when none/unseen).
  getThreadPin: (threadPda: string) => string;

  upsertDmConvo: (convo: DmConvo) => void;
  setDmConversations: (convos: DmConvo[]) => void;
  // Drop a thread's cached messages (e.g. on unmount cleanup).
  clearThread: (threadPda: string) => void;
}

export const useWarTableStore = create<WtState>((set, get) => ({
  threads: new Map(),
  dmConversations: new Map(),

  upsertMessage: (msg) =>
    set((s) => {
      const threads = new Map(s.threads);
      const prev = threads.get(msg.threadPda) ?? emptyThread();
      threads.set(msg.threadPda, ingest(prev, msg));
      return { threads };
    }),

  ingestMessages: (threadPda, messages) =>
    set((s) => {
      const threads = new Map(s.threads);
      let entry = threads.get(threadPda) ?? emptyThread();
      for (const m of messages) entry = ingest(entry, m);
      threads.set(threadPda, { ...entry, loading: false });
      return { threads };
    }),

  addPendingMessage: (msg) =>
    set((s) => {
      const threads = new Map(s.threads);
      const prev = threads.get(msg.threadPda) ?? emptyThread();
      // Route the echo through the shared fold so an optimistic reaction (5),
      // pin (6), or delete (4) folds immediately (chip appears, pin flips, the
      // target hides) instead of rendering as a stray bubble. ingest honors the
      // pending flag and skips the pending-reconcile drop for pending input.
      threads.set(msg.threadPda, ingest(prev, { ...msg, pending: true }));
      return { threads };
    }),

  removeMessage: (threadPda, id) =>
    set((s) => {
      const prev = s.threads.get(threadPda);
      if (!prev) return s;
      const threads = new Map(s.threads);

      // Roll back a failed optimistic reaction echo: a pending reaction record
      // carries the temp id, so drop it and recompute the affected parent chip.
      let reactionRecords = prev.reactionRecords;
      let messages = prev.messages.filter((m) => m.id !== id);
      for (const [parentKey, recs] of prev.reactionRecords) {
        if (!recs.some((r) => r.id === id)) continue;
        if (reactionRecords === prev.reactionRecords) reactionRecords = new Map(prev.reactionRecords);
        const next = recs.filter((r) => r.id !== id);
        reactionRecords.set(parentKey, next);
        messages = applyReactions(messages, parentKey, next);
      }

      // Roll back a failed optimistic pin echo: the pending pin set maxPinId to
      // the temp id. Revert to no pin; the next reconcile re-resolves the real
      // pin. A failed un-react/delete is not rolled back here (its temp id is
      // not retained); the next reconcile corrects it.
      let pinnedId = prev.pinnedId;
      let maxPinId = prev.maxPinId;
      let pinPending = prev.pinPending;
      if (prev.pinPending && prev.maxPinId === id) {
        pinnedId = ZERO_ID;
        maxPinId = ZERO_ID;
        pinPending = false;
      }

      threads.set(threadPda, { ...prev, messages, reactionRecords, pinnedId, maxPinId, pinPending });
      return { threads };
    }),

  setThreadMessages: (threadPda, incoming, pinnedId = ZERO_ID) =>
    set((s) => {
      const threads = new Map(s.threads);
      const prev = threads.get(threadPda) ?? emptyThread();

      // The seed comes from the SDK fold: it carries no kind=5/6 bubbles and
      // each bubble already has its reactions[] summary. Reconstruct the store's
      // reactionRecords from those summaries so the LIVE (raw subscribeThread)
      // path can keep folding on top, and so un-react resolves my reaction id.
      const reactionRecords = seedReactionRecords(incoming);

      // The SDK fold leaks un-react and pin-clear tombstones as empty kind=4
      // bubbles (it only drops kind=5/6). Strip any kind=4 whose victim is not a
      // present chat bubble; those are un-react/pin tombstones, not chat deletes.
      // Status (kind=1) presence pings are never bubbles either.
      const bubbleIds = new Set(incoming.map((m) => m.id));
      const visible = incoming.filter(
        (m) =>
          m.kind !== WtKind.Status &&
          (m.kind !== WtKind.Tombstone || bubbleIds.has(m.parentId)),
      );

      // Fold pending tombstones into the fresh list and sort deterministically.
      const messages = [...visible]
        .map((m) =>
          prev.pendingTombstones.has(m.id) ? { ...m, body: "", tombstoned: true } : m,
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      threads.set(threadPda, {
        messages,
        loading: false,
        pendingTombstones: prev.pendingTombstones,
        pinnedId,
        // The seed already resolved the pin; treat any later live pin as newer
        // by leaving maxPinId at the floor so a real kind=6 always wins.
        maxPinId: ZERO_ID,
        pinPending: false,
        reactionRecords,
      });
      return { threads };
    }),

  mergeThreadMessages: (threadPda, incoming, pinnedId) =>
    set((s) => {
      const threads = new Map(s.threads);
      let entry = threads.get(threadPda) ?? emptyThread();

      // The reconcile read is SDK-folded (no kind=5/6 bubbles) but, like the
      // seed, leaks un-react/pin-clear tombstones as empty kind=4 bubbles. Strip
      // any kind=4 whose victim is not a present chat bubble in this batch or
      // the current list, so a leaked tombstone never lands as a stray bubble.
      const liveIds = new Set(entry.messages.map((m) => m.id));
      for (const m of incoming) liveIds.add(m.id);
      const visible = incoming.filter(
        (m) => m.kind !== WtKind.Tombstone || liveIds.has(m.parentId),
      );

      // Fold each freshly-read message through the shared ingest path so new
      // messages are added and pendings reconciled, without clobbering live
      // upserts or local pendings the way a full replace would.
      for (const m of visible) entry = ingest(entry, m);

      // The reconcile read is authoritative for reactions and the pin: the SDK
      // fold already aggregated any reaction/pin messages dropped from the
      // bubble list (including ones subscribeThread missed). Re-merge the folded
      // reaction records and re-resolve the pin so a missed live reaction/pin is
      // caught here. Live records the reconcile has not seen yet are preserved
      // by unioning rather than replacing.
      const reactionRecords = new Map(entry.reactionRecords);
      for (const m of incoming) {
        if (!m.reactions || m.reactions.length === 0) continue;
        const seeded = seedReactionRecords([m]).get(m.id);
        if (!seeded) continue;
        const existing = reactionRecords.get(m.id) ?? [];
        const merged = existing.slice();
        for (const rec of seeded) {
          const dupIdx = merged.findIndex(
            (r) => r.id === rec.id || (r.sender === rec.sender && r.emoji === rec.emoji),
          );
          if (dupIdx === -1) {
            merged.push(rec);
          } else if (merged[dupIdx]!.pending === true) {
            // The reconcile confirms a still-pending echo: replace it with the
            // real (non-pending) seeded record so the un-react target is real.
            merged[dupIdx] = rec;
          }
        }
        reactionRecords.set(m.id, merged);
      }
      let messages = entry.messages;
      for (const m of incoming) {
        if (m.reactions === undefined) continue;
        const idx = messages.findIndex((x) => x.id === m.id);
        if (idx === -1) continue;
        if (messages === entry.messages) messages = messages.slice();
        messages[idx] = { ...messages[idx]!, reactions: summarizeReactions(reactionRecords.get(m.id)) };
      }

      entry = {
        ...entry,
        messages,
        reactionRecords,
        loading: false,
        // A non-undefined reconcile pin is authoritative (the SDK fold saw the
        // full pin history): override and clear pinPending. ZERO_ID means the
        // reconcile saw no pin (or an unpin). Leave maxPinId at the floor so a
        // later live kind=6 still wins by id.
        pinnedId: pinnedId === undefined ? entry.pinnedId : pinnedId,
        maxPinId: pinnedId === undefined ? entry.maxPinId : ZERO_ID,
        pinPending: pinnedId === undefined ? entry.pinPending : false,
      };
      threads.set(threadPda, entry);
      return { threads };
    }),

  setThreadLoading: (threadPda, loading) =>
    set((s) => {
      const threads = new Map(s.threads);
      const prev = threads.get(threadPda) ?? emptyThread();
      threads.set(threadPda, { ...prev, loading });
      return { threads };
    }),

  getThreadMessages: (threadPda) => get().threads.get(threadPda)?.messages ?? [],

  getThreadPin: (threadPda) => get().threads.get(threadPda)?.pinnedId ?? ZERO_ID,

  upsertDmConvo: (convo) =>
    set((s) => {
      const dmConversations = new Map(s.dmConversations);
      const prev = dmConversations.get(convo.threadPda);
      // Keep the newest message as the conversation preview.
      if (!prev || convo.lastMessageId >= prev.lastMessageId) {
        dmConversations.set(convo.threadPda, convo);
      }
      return { dmConversations };
    }),

  setDmConversations: (convos) =>
    set(() => {
      const dmConversations = new Map<string, DmConvo>();
      for (const c of convos) dmConversations.set(c.threadPda, c);
      return { dmConversations };
    }),

  clearThread: (threadPda) =>
    set((s) => {
      if (!s.threads.has(threadPda)) return s;
      const threads = new Map(s.threads);
      threads.delete(threadPda);
      return { threads };
    }),
}));
