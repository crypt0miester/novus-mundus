// High-level War Table client.
//
// Wraps a Connection plus a ThreadKeyProvider into post / read / subscribe /
// discover helpers. The read path keys on the `wt1` magic in `Program data:`
// log lines (the chain emits the raw envelope via sol_log_data with no event
// discriminator), decodes, and best-effort decrypts. Ordering uses the
// 12-byte message id (slot | txDisc | log_index): txDisc is the leading 3 bytes
// of the transaction signature, a stable per-tx discriminator (identical on the
// gTFA and standard read paths) so two posts in the same slot no longer collide.

import {
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  type Connection,
  type TransactionInstruction,
} from '@solana/web3.js';
import { getBase58Encoder, getBase58Decoder } from '@solana/codecs-strings';

// base58 codecs (replace bs58). Note the inverted naming vs the bs58 package:
//   bs58.decode(b58str) -> bytes   ===  base58Encoder.encode(b58str)
//   bs58.encode(bytes)  -> b58str  ===  base58Decoder.decode(bytes)
const base58Encoder = getBase58Encoder();
const base58Decoder = getBase58Decoder();
/** Decode a base58 string to raw bytes (was `bs58.decode`). */
function base58ToBytes(s: string): Uint8Array {
  return new Uint8Array(base58Encoder.encode(s));
}
/** Encode raw bytes as a base58 string (was `bs58.encode`). */
function bytesToBase58(b: Uint8Array): string {
  return base58Decoder.decode(b);
}

import {
  WtScope,
  WtKind,
  WT_FLAG_ENCRYPTED,
  WT_NONCE_LEN,
  WT_ID_ZERO,
  WT_ID_LEN,
  WT_MAX_TEXT_BYTES,
  decodeEnvelope,
  decodeBody,
  encodeBody,
  encodeEnvelope,
  encryptBody,
  decryptBody,
  encodeMessageId,
  hexToId,
  idToHex,
  type WtEnvelope,
  type WtBody,
} from './crypto/wartable';

// Re-export the id codecs so callers (web hook, CLI) import them from the
// high-level wartable module alongside readThread, mirroring how PostMessageBody
// and ReadMessage are surfaced here.
export { hexToId, idToHex };
import type { ThreadKeyProvider } from './keyprovider/index';
import {
  createPostWarTableMessageInstruction,
  type PostWarTableMessageAccounts,
} from './instructions/wartable';
import { parseNovusMundusEvent } from './events/parser';
import type { NovusMundusEvent } from './events/types';

// Default per-CU priority-fee ceiling for war-table posts (non-urgent, must not
// overpay during a siege fee spike). Override per call via
// opts.maxPriorityFeeMicroLamportsPerCu.
export const WT_MAX_PRIORITY_FEE_MICRO_LAMPORTS_PER_CU = 50_000;

const PROGRAM_DATA_PREFIX = 'Program data: ';

export interface WarTableClientOpts {
  connection: Connection;
  keyProvider: ThreadKeyProvider;
  /**
   * How to fetch an address's transactions when reading a thread:
   * - 'auto' (default): try the enhanced `getTransactionsForAddress` (Triton /
   *   Helius — one call instead of getSignaturesForAddress + N getTransaction),
   *   and permanently fall back to the standard sweep for this RPC endpoint if
   *   it answers "method not found".
   * - 'on': require gTFA; surface its errors instead of falling back.
   * - 'off': always use the standard getSignaturesForAddress + getTransaction.
   */
  getTransactionsForAddress?: 'auto' | 'on' | 'off';
}

/** Per-transaction log slice — the only thing the thread readers need. */
interface TxLogs {
  slot: bigint;
  /** Leading 3 bytes of the tx signature — the per-tx id discriminator. */
  txDisc: number;
  logMessages: string[];
}

/**
 * Derive a per-transaction message-id discriminator from a base58 transaction
 * signature: the leading 3 bytes of the 64-byte signature as a u24. Stable
 * across the gTFA and standard read paths and the live onLogs stream (all three
 * see the same signature), and effectively unique among the handful of
 * transactions one thread sees in a single slot, so same-slot posts no longer
 * collide on id. Returns 0 if the signature is unparseable (degrades to the
 * pre-fix same-slot behavior for that one tx only).
 */
export function txDiscFromSignature(signature: string): number {
  try {
    const bytes = base58ToBytes(signature);
    if (bytes.length < 3) return 0;
    return ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) >>> 0;
  } catch {
    return 0;
  }
}

/** How much of an address's history a thread read should pull. */
interface FetchLogsOpts {
  /** Max transactions to fetch when `fetchAll` is false (the page-walked cap). */
  limit: number;
  /** Walk pagination to the end (ignoring `limit`) for the COMPLETE thread. */
  fetchAll: boolean;
}

/** Max transactions per RPC page — the cap of both gTFA and getSignaturesForAddress. */
const RPC_PAGE_LIMIT = 1000;

/** One fetched page: its wt1 logs, the total tx count (for caps), and a cursor. */
interface AddrPage {
  logs: TxLogs[];
  /** Transactions in this page (wt1 or not) — what the limit/cap counts. */
  txCount: number;
  /** Mechanism-tagged cursor for the next OLDER page; null at start of history. */
  nextCursor: string | null;
}

// RPC endpoints observed to lack `getTransactionsForAddress` (answered -32601 /
// 404 / 405). Module-scoped so the probe is paid once per endpoint across every
// WarTableClient instance (the web rebuilds one client per thread), not once
// per thread. Helius/Triton never land here; localnet/standard devnet do.
const GTFA_UNSUPPORTED_ENDPOINTS = new Set<string>();

/** True when an error means the RPC does not implement gTFA at all. */
function isGtfaUnsupported(err: unknown): boolean {
  const code = (err as { code?: number }).code;
  const status = (err as { httpStatus?: number }).httpStatus;
  if (code === -32601) return true; // JSON-RPC "Method not found"
  if (status === 404 || status === 405 || status === 501) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return /method not found|not supported|unsupported|unknown method/.test(msg);
}

/** One getTransactionsForAddress result item (only the fields we read). */
interface GtfaItem {
  slot: number;
  meta?: { logMessages?: string[] | null };
  /** Some providers surface the primary signature directly. */
  signature?: string;
  /**
   * `transactionDetails: 'full'`. With base64 encoding this is
   * `[base64Wire, 'base64']`; with json/jsonParsed it is `{ signatures: [...] }`.
   */
  transaction?: [string, string] | { signatures?: string[] };
}

/**
 * Extract a gTFA item's primary (index-0) transaction signature as base58, so
 * the standard and gTFA paths derive the SAME per-tx id discriminator. Prefers
 * an explicit `signature`, else the parsed `signatures[0]`, else decodes the
 * base64 wire bytes (a 1-byte shortvec count for <128 sigs, then signature 0).
 */
function gtfaSignature(item: GtfaItem): string | null {
  if (typeof item.signature === 'string') return item.signature;
  const tx = item.transaction;
  if (Array.isArray(tx) && typeof tx[0] === 'string') {
    try {
      const raw = Buffer.from(tx[0], 'base64');
      if (raw.length >= 1 + 64) return bytesToBase58(new Uint8Array(raw.subarray(1, 1 + 64)));
    } catch {
      // fall through to the parsed form / null
    }
  } else if (tx && !Array.isArray(tx) && Array.isArray(tx.signatures)) {
    const s = tx.signatures[0];
    if (typeof s === 'string') return s;
  }
  return null;
}

// One distinct emoji's folded reaction summary on a parent message. count is the
// number of live (non-tombstoned) reactions of this emoji; reactorWallets is the
// base58 wallet of each reactor in first-seen order. mine and myReactionId are
// only populated when readThread/foldThread is given a myWallet (the SDK is
// otherwise wallet-agnostic, mirroring why the web store cannot set mine).
export interface ReactionSummary {
  /** the reaction emoji (UTF-8 payload of the kind=5 message). */
  emoji: string;
  /** count of live reactions of this emoji. */
  count: number;
  /** base58 reactor wallets, first-seen order. */
  reactorWallets: string[];
  /** true when myWallet is among reactorWallets (only set when myWallet given). */
  mine: boolean;
  /** hex id of MY reaction message for this emoji, the un-react tombstone target. */
  myReactionId?: string;
}

export interface ReadMessage {
  /** 12-byte ordering id. */
  id: Uint8Array;
  scope: WtScope;
  senderWallet: PublicKey;
  threadPda: PublicKey;
  keyVersion: number;
  kind: WtKind;
  createdAt: bigint;
  parentId: Uint8Array;
  /** decoded payload (decrypted text/binary), or empty if locked. */
  payload: Uint8Array;
  /** true when the body was decrypted (or is plaintext); false when no key. */
  decrypted: boolean;
  /**
   * Always false: the id's within-slot discriminator is derived from the
   * transaction signature, not the on-chain transaction index (which the
   * log/RPC read paths cannot resolve). Same-slot ids no longer collide, but
   * within a slot they order by signature, not true block position. Kept for
   * API stability.
   */
  txIndexResolved: boolean;
  /** true when a Tombstone with this id's parent hid this message. */
  tombstoned?: boolean;
  // Folded reaction summary: one entry per distinct emoji, first-seen order.
  // Present (possibly empty) on every bubble returned by readThread/foldThread.
  // The kind=5 reaction messages that produced it are NOT returned as bubbles.
  reactions?: ReactionSummary[];
  // Thread-wide current pin target, stamped onto every returned bubble so the
  // array-shaped readThread result still surfaces the pin without a separate
  // return type. WT_ID_ZERO means no pin. Resolved as the highest-id
  // non-tombstoned kind=6 message's parentId.
  pinnedId?: Uint8Array;
}

export interface PostMessageBody {
  kind: WtKind;
  /** advisory created-at; defaults to now. */
  createdAt?: bigint;
  /** 12-byte parent id; defaults to root (all zero). */
  parentId?: Uint8Array;
  /** UTF-8 string or raw bytes. */
  payload: string | Uint8Array;
}

export interface PostMessageOpts {
  /** override the per-CU priority-fee ceiling. */
  maxPriorityFeeMicroLamportsPerCu?: number;
  /** extra compute-unit limit instruction. */
  computeUnitLimit?: number;
}

export interface PostMessageResult {
  signature: string;
  /** true when the network median exceeded the ceiling and was clamped. */
  congested: boolean;
  /** the effective per-CU price actually used. */
  priorityFeeMicroLamportsPerCu: number;
}

export interface DmConversation {
  threadPda: PublicKey;
  /** the most recent message id seen for this thread. */
  lastMessageId: Uint8Array;
}

export interface ThreadPage {
  /**
   * RAW decoded messages for this page, ascending by id. Reaction (kind=5), pin
   * (kind=6) and tombstone (kind=4) messages are INCLUDED unfolded — a fold
   * needs the whole thread, so accumulate pages and run `foldThread` (or feed
   * the web store, which folds incrementally) before rendering.
   */
  messages: ReadMessage[];
  /** Opaque cursor for the next OLDER page; null at the start of history. */
  nextCursor: string | null;
}

function payloadToBytes(p: string | Uint8Array): Uint8Array {
  return typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

/** Filter `Program data:` log lines and base64-decode each to raw bytes. */
export function readProgramData(logs: string[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const line of logs) {
    if (line.startsWith(PROGRAM_DATA_PREFIX)) {
      const b64 = line.slice(PROGRAM_DATA_PREFIX.length).trim();
      try {
        out.push(new Uint8Array(Buffer.from(b64, 'base64')));
      } catch {
        // skip malformed lines
      }
    }
  }
  return out;
}

function isWt1(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x77 && bytes[1] === 0x74 && bytes[2] === 0x31;
}

function compareId(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < WT_ID_LEN; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function idHex(id: Uint8Array): string {
  return Buffer.from(id).toString('hex');
}

export interface FoldThreadOpts {
  // When given, ReactionSummary.mine and myReactionId are populated for this
  // wallet (base58). Omitted leaves the SDK wallet-agnostic (mine=false).
  myWallet?: PublicKey | string;
}

export interface FoldedThread {
  // Bubbles to render, ascending by id, with reactions folded onto each parent
  // and reaction/pin messages removed. Tombstoned parents keep their bubble with
  // tombstoned=true and an empty payload.
  messages: ReadMessage[];
  // Current pin target id (WT_ID_ZERO when none): highest-id non-tombstoned
  // kind=6 message's parentId, cleared if that pin message was itself tombstoned.
  pinnedId: Uint8Array;
}

/**
 * Pure read-model fold over the raw decoded messages of one thread.
 *
 * Single source of truth for the reaction / pin / tombstone folds shared by
 * readThread and any caller that already holds the raw message list (tests, the
 * live-reconcile path). Algorithm, in id order so latest-wins is correct:
 *
 *  - Tombstone (kind=4): hides its parent bubble (empty payload, tombstoned),
 *    OR marks a reaction record un-reacted (parent == a reaction message id),
 *    OR clears the current pin (parent == the live pin message id).
 *  - Reaction (kind=5): grouped by reacted-to parent, aggregated per emoji into
 *    ReactionSummary; never returned as a bubble.
 *  - Pin (kind=6): the highest-id live one wins; its parentId is the pin (or
 *    WT_ID_ZERO to unpin); never returned as a bubble.
 *
 * The returned bubbles carry the folded reactions[] and the thread pinnedId on
 * every entry. mine / myReactionId are populated only when opts.myWallet given.
 */
export function foldThread(raw: ReadMessage[], opts: FoldThreadOpts = {}): FoldedThread {
  const myWallet =
    opts.myWallet === undefined
      ? undefined
      : typeof opts.myWallet === 'string'
        ? opts.myWallet
        : opts.myWallet.toBase58();

  // Dedup by id and order by id so latest-wins (pin) and out-of-order arrivals
  // resolve deterministically.
  const byId = new Map<string, ReadMessage>();
  for (const m of raw) byId.set(idHex(m.id), m);
  const ordered = Array.from(byId.values()).sort((a, b) => compareId(a.id, b.id));

  // Index every message id present so a tombstone can tell a reaction/pin target
  // apart from a bubble target.
  const reactionMsgIds = new Set<string>();
  const pinMsgIds = new Set<string>();
  for (const m of ordered) {
    if (m.kind === WtKind.Reaction) reactionMsgIds.add(idHex(m.id));
    else if (m.kind === WtKind.Pin) pinMsgIds.add(idHex(m.id));
  }

  // Raw reaction records grouped by the reacted-to (parent) message hex id.
  interface ReactionRecord {
    id: string;
    emoji: string;
    sender: string;
    tombstoned: boolean;
  }
  const reactionRecords = new Map<string, ReactionRecord[]>();
  const tombstonedBubbleParents = new Set<string>();

  // pin resolution: highest-id live kind=6 wins; track its message id so a
  // later tombstone of that very message clears the pin.
  let pinnedId: Uint8Array = WT_ID_ZERO;
  let pinMsgIdHex = '';
  const tombstonedReactionIds = new Set<string>();
  const tombstonedPinIds = new Set<string>();

  for (const m of ordered) {
    if (m.kind === WtKind.Reaction) {
      const parentHex = idHex(m.parentId);
      const arr = reactionRecords.get(parentHex);
      const rec: ReactionRecord = {
        id: idHex(m.id),
        emoji: new TextDecoder().decode(m.payload),
        sender: m.senderWallet.toBase58(),
        tombstoned: false,
      };
      if (arr) arr.push(rec);
      else reactionRecords.set(parentHex, [rec]);
      continue;
    }
    if (m.kind === WtKind.Pin) {
      // ordered is ascending by id, so the last kind=6 seen is the latest.
      pinnedId = m.parentId;
      pinMsgIdHex = idHex(m.id);
      continue;
    }
    if (m.kind === WtKind.Tombstone) {
      if (compareId(m.parentId, WT_ID_ZERO) === 0) continue;
      const parentHex = idHex(m.parentId);
      if (reactionMsgIds.has(parentHex)) {
        // Un-react: the tombstone targets a reaction message's own id.
        tombstonedReactionIds.add(parentHex);
      } else if (pinMsgIds.has(parentHex)) {
        // Tombstoning a pin message clears the pin if it is the live one.
        tombstonedPinIds.add(parentHex);
      } else {
        tombstonedBubbleParents.add(parentHex);
      }
      continue;
    }
  }

  // Apply reaction un-reacts before aggregating.
  for (const recs of reactionRecords.values()) {
    for (const rec of recs) {
      if (tombstonedReactionIds.has(rec.id)) rec.tombstoned = true;
    }
  }

  // A tombstone of the live pin message clears the pin.
  if (pinMsgIdHex !== '' && tombstonedPinIds.has(pinMsgIdHex)) {
    pinnedId = WT_ID_ZERO;
  }

  // Build the bubble list: drop reaction/pin messages, fold tombstones and
  // reactions onto each surviving bubble, stamp the thread pinnedId.
  const out: ReadMessage[] = [];
  for (const m of ordered) {
    if (m.kind === WtKind.Reaction || m.kind === WtKind.Pin) continue;
    const idHexStr = idHex(m.id);
    const tombstoned = tombstonedBubbleParents.has(idHexStr);
    const recs = reactionRecords.get(idHexStr);
    const reactions = aggregateReactions(recs, myWallet);
    out.push({
      ...m,
      payload: tombstoned ? new Uint8Array(0) : m.payload,
      tombstoned: tombstoned ? true : m.tombstoned,
      reactions,
      pinnedId,
    });
  }

  return { messages: out, pinnedId };
}

// Aggregate the live reaction records for one parent into per-emoji summaries,
// preserving first-seen emoji order. mine / myReactionId set only when myWallet
// is provided.
function aggregateReactions(
  recs: Array<{ id: string; emoji: string; sender: string; tombstoned: boolean }> | undefined,
  myWallet: string | undefined,
): ReactionSummary[] {
  if (!recs || recs.length === 0) return [];
  const order: string[] = [];
  const groups = new Map<string, { reactorWallets: string[]; myReactionId?: string }>();
  for (const rec of recs) {
    if (rec.tombstoned) continue;
    let g = groups.get(rec.emoji);
    if (!g) {
      g = { reactorWallets: [] };
      groups.set(rec.emoji, g);
      order.push(rec.emoji);
    }
    g.reactorWallets.push(rec.sender);
    if (myWallet !== undefined && rec.sender === myWallet && g.myReactionId === undefined) {
      g.myReactionId = rec.id;
    }
  }
  return order.map((emoji) => {
    const g = groups.get(emoji)!;
    const mine = myWallet !== undefined && g.reactorWallets.includes(myWallet);
    const summary: ReactionSummary = {
      emoji,
      count: g.reactorWallets.length,
      reactorWallets: g.reactorWallets,
      mine,
    };
    if (g.myReactionId !== undefined) summary.myReactionId = g.myReactionId;
    return summary;
  });
}

// Match a base58 pubkey field (string or PublicKey) against the thread pubkey.
function eventKeyEquals(field: unknown, thread: PublicKey): boolean {
  if (field instanceof PublicKey) return field.equals(thread);
  if (typeof field === 'string') return field === thread.toBase58();
  return false;
}

// Short base58 prefix for events that carry only a pubkey and no decoded name.
function shortKey(field: unknown): string {
  const s = field instanceof PublicKey ? field.toBase58() : typeof field === 'string' ? field : '';
  return s.length > 8 ? `${s.slice(0, 4)}..${s.slice(-4)}` : s;
}

/**
 * Map an on-chain event to a centered war-table system line, or null when the
 * event is unrelated to this thread or has no system label. Association is by
 * the entity pubkey in the event payload matching the thread PDA (the thread
 * PDA IS the entity PDA for team/rally/castle/encounter). Pure: no I/O.
 *
 * Labels are plain prose (no em-dash, no typed arrows). DM scope is always null
 * (the pair PDA has no game entity behind it).
 */
export function systemLabelFor(
  scope: WtScope,
  thread: PublicKey,
  event: NovusMundusEvent,
): string | null {
  switch (scope) {
    case WtScope.Team: {
      switch (event.name) {
        case 'TeamJoined':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return `${shortKey(event.data.player)} joined the team`;
        case 'MemberKicked':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return `${shortKey(event.data.kicked)} was removed`;
        case 'TeamLeft':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return `${shortKey(event.data.player)} left the team`;
        case 'LeadershipTransferred':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return `Leadership passed to ${shortKey(event.data.newLeader)}`;
        case 'MotdUpdated':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return 'Message of the day updated';
        case 'TeamDisbanded':
          if (!eventKeyEquals(event.data.team, thread)) return null;
          return 'Team disbanded';
        default:
          return null;
      }
    }
    case WtScope.Rally: {
      switch (event.name) {
        case 'RallyCreated':
          if (!eventKeyEquals(event.data.rally, thread)) return null;
          return 'Rally created';
        case 'RallyJoined':
          if (!eventKeyEquals(event.data.rally, thread)) return null;
          return `${shortKey(event.data.player)} joined the rally`;
        case 'RallyExecuted':
          if (!eventKeyEquals(event.data.rally, thread)) return null;
          return 'Rally struck the target';
        case 'RallyCancelled':
          if (!eventKeyEquals(event.data.rally, thread)) return null;
          return 'Rally cancelled';
        case 'RallyClosed':
          if (!eventKeyEquals(event.data.rally, thread)) return null;
          return 'Rally closed';
        default:
          return null;
      }
    }
    case WtScope.Castle: {
      switch (event.name) {
        case 'CastleConquered':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `Castle conquered by ${event.data.newKingName}`;
        case 'CastleDefended':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return 'Castle held';
        case 'CastleClaimed':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `${event.data.kingName} claimed the castle`;
        case 'GarrisonJoined':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `${event.data.contributorName} reinforced the garrison`;
        case 'GarrisonLeft':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `${event.data.contributorName} left the garrison`;
        case 'CastleAttacked':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `Under attack by ${event.data.attackerName}`;
        case 'KingForceRemoved':
          if (!eventKeyEquals(event.data.castle, thread)) return null;
          return `${event.data.removedKingName} was forced out`;
        default:
          return null;
      }
    }
    case WtScope.Encounter: {
      switch (event.name) {
        case 'EncounterDefeated':
          if (!eventKeyEquals(event.data.encounter, thread)) return null;
          return `Encounter defeated by ${event.data.killingBlowName}`;
        case 'EncounterAttacked':
          if (!eventKeyEquals(event.data.encounter, thread)) return null;
          return `${event.data.playerName} struck the encounter`;
        default:
          return null;
      }
    }
    case WtScope.Dm:
    default:
      return null;
  }
}

export class WarTableClient {
  readonly connection: Connection;
  private readonly keyProvider: ThreadKeyProvider;
  private readonly gtfaMode: 'auto' | 'on' | 'off';

  constructor(opts: WarTableClientOpts) {
    this.connection = opts.connection;
    this.keyProvider = opts.keyProvider;
    this.gtfaMode = opts.getTransactionsForAddress ?? 'auto';
  }

  /**
   * Fetch an address's transaction logs, newest-first, for the thread readers.
   *
   * Prefers the enhanced `getTransactionsForAddress` (one round trip) and falls
   * back to `getSignaturesForAddress` + per-signature `getTransaction` on RPCs
   * that lack it. Both paths return the same `{ slot, logMessages }` shape and
   * the SAME ordering (descending), so the message ids derived downstream — and
   * therefore reply/reaction parent references — are identical regardless of
   * which path served the read. gTFA's `transactionIndex` is deliberately NOT
   * used in the id (it would diverge from the standard path, which can't get
   * it); tx_index stays 0 exactly as before.
   */
  private async fetchAddressLogs(address: PublicKey, opts: FetchLogsOpts): Promise<TxLogs[]> {
    const out: TxLogs[] = [];
    let cursor: string | null = null;
    let fetched = 0;
    for (;;) {
      const pageLimit = opts.fetchAll ? RPC_PAGE_LIMIT : Math.min(RPC_PAGE_LIMIT, opts.limit - fetched);
      if (pageLimit <= 0) break;
      const page = await this.fetchAddressPage(address, pageLimit, cursor);
      out.push(...page.logs);
      fetched += page.txCount;
      cursor = page.nextCursor;
      if (!cursor) break;
      if (!opts.fetchAll && fetched >= opts.limit) break;
    }
    return out;
  }

  /**
   * Fetch ONE page of an address's transactions plus a cursor for the next
   * (older) page. The cursor encodes the mechanism — "t:<token>" for gTFA,
   * "s:<signature>" for the standard before-cursor — so a pagination session
   * stays on ONE path even under 'auto'. First page (cursor null) picks the
   * mechanism from the mode; a continuation honors the cursor's mechanism. A
   * null returned cursor means the start of history was reached.
   */
  private async fetchAddressPage(
    address: PublicKey,
    pageLimit: number,
    cursor: string | null,
  ): Promise<AddrPage> {
    if (cursor && cursor.startsWith('t:')) return this.gtfaPage(address, pageLimit, cursor.slice(2));
    if (cursor && cursor.startsWith('s:')) return this.standardPage(address, pageLimit, cursor.slice(2));

    if (this.gtfaMode === 'off') return this.standardPage(address, pageLimit, undefined);
    // 'on' forces gTFA and surfaces its errors — it ignores the unsupported
    // cache (whose whole job is to let 'auto' stop probing a plain RPC).
    if (this.gtfaMode === 'on') return this.gtfaPage(address, pageLimit, undefined);

    // 'auto': use gTFA unless this endpoint already proved it lacks it, and on a
    // "method not found" remember that so we stop probing; any error falls back.
    const endpoint = this.connection.rpcEndpoint;
    if (GTFA_UNSUPPORTED_ENDPOINTS.has(endpoint)) return this.standardPage(address, pageLimit, undefined);
    try {
      return await this.gtfaPage(address, pageLimit, undefined);
    } catch (err) {
      if (isGtfaUnsupported(err)) GTFA_UNSUPPORTED_ENDPOINTS.add(endpoint);
      return this.standardPage(address, pageLimit, undefined);
    }
  }

  /**
   * One gTFA call (Triton / Helius). Returns this page's wt1 logs, its total tx
   * count (for the caller's cap), and a "t:"-tagged cursor for the next page
   * (null when paginationToken comes back null). Throws if the RPC lacks gTFA.
   */
  private async gtfaPage(
    address: PublicKey,
    pageLimit: number,
    paginationToken: string | undefined,
  ): Promise<AddrPage> {
    const config: Record<string, unknown> = {
      transactionDetails: 'full',
      // Descending matches getSignaturesForAddress so foldThread's
      // dedup-by-id (last-wins) resolves identically on both paths.
      sortOrder: 'desc',
      commitment: 'confirmed',
      limit: pageLimit,
      encoding: 'base64',
      maxSupportedTransactionVersion: 0,
    };
    if (paginationToken) config.paginationToken = paginationToken;

    const res = await fetch(this.connection.rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'wt-gtfa',
        method: 'getTransactionsForAddress',
        params: [address.toBase58(), config],
      }),
    });
    if (!res.ok) {
      const err = new Error(`getTransactionsForAddress HTTP ${res.status}`);
      (err as { httpStatus?: number }).httpStatus = res.status;
      throw err;
    }
    const json = (await res.json()) as {
      result?: {
        data?: Array<GtfaItem>;
        paginationToken?: string | null;
      };
      error?: { code?: number; message?: string };
    };
    if (json.error) {
      const err = new Error(json.error.message ?? 'getTransactionsForAddress error');
      (err as { code?: number }).code = json.error.code;
      throw err;
    }

    const data = json.result?.data ?? [];
    const logs: TxLogs[] = [];
    for (const t of data) {
      const logMessages = t.meta?.logMessages;
      if (!logMessages) continue;
      const sig = gtfaSignature(t);
      logs.push({
        slot: BigInt(t.slot),
        txDisc: sig ? txDiscFromSignature(sig) : 0,
        logMessages,
      });
    }
    const token = json.result?.paginationToken;
    return { logs, txCount: data.length, nextCursor: token ? `t:${token}` : null };
  }

  /**
   * One standard page: getSignaturesForAddress(before) + per-sig getTransaction,
   * for RPCs without gTFA (localnet, plain devnet). Newest-first; the
   * "s:"-tagged cursor is the last signature. A short page (fewer than
   * pageLimit) means history is exhausted, so the cursor is null.
   */
  private async standardPage(
    address: PublicKey,
    pageLimit: number,
    before: string | undefined,
  ): Promise<AddrPage> {
    const sigs = await this.connection.getSignaturesForAddress(address, { limit: pageLimit, before });
    const logs: TxLogs[] = [];
    for (const sigInfo of sigs) {
      const tx = await this.connection.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta || !tx.meta.logMessages) continue;
      logs.push({
        slot: BigInt(tx.slot),
        txDisc: txDiscFromSignature(sigInfo.signature),
        logMessages: tx.meta.logMessages,
      });
    }
    const nextCursor =
      sigs.length === pageLimit && sigs.length > 0
        ? `s:${sigs[sigs.length - 1]!.signature}`
        : null;
    return { logs, txCount: sigs.length, nextCursor };
  }

  /**
   * Build the envelope and instruction for a post. Exposed so callers (CLI,
   * tests) can attach the instruction to their own transaction. Enforces the
   * section-5 key_version rule before encoding.
   */
  async buildPostInstruction(
    accounts: PostWarTableMessageAccounts,
    scope: WtScope,
    body: PostMessageBody,
  ): Promise<TransactionInstruction> {
    // Guard the user text against the global byte ceiling before building the
    // envelope, so callers get a clear named error instead of an opaque
    // "Transaction too large" throw from tx.serialize() at send time. Counts
    // UTF-8 bytes (a 4-byte emoji costs 4). Reactions/pins/tombstones carry tiny
    // or empty payloads and never trip this.
    const payloadBytes = payloadToBytes(body.payload);
    if (payloadBytes.length > WT_MAX_TEXT_BYTES) {
      throw new Error(
        `war-table message text is ${payloadBytes.length} bytes, over the ${WT_MAX_TEXT_BYTES}-byte limit (WT_MAX_TEXT_BYTES)`,
      );
    }

    const innerBody: WtBody = {
      version: 0x01,
      kind: body.kind,
      createdAt: body.createdAt ?? BigInt(Math.floor(Date.now() / 1000)),
      parentId: body.parentId ?? WT_ID_ZERO,
      payload: payloadBytes,
    };
    const bodyBytes = encodeBody(innerBody);

    if (scope === WtScope.Encounter || scope === WtScope.Public) {
      // Plaintext path: flags=0, keyVersion=0, zero nonce. Both Encounter and
      // Public are membership-free plaintext scopes.
      const envelope = encodeEnvelope({
        flags: 0,
        threadPda: accounts.thread,
        senderWallet: accounts.sender,
        keyVersion: 0,
        bodyNonce: new Uint8Array(WT_NONCE_LEN),
        body: bodyBytes,
      });
      return createPostWarTableMessageInstruction(accounts, { scope, envelope });
    }

    // Encrypted scopes: resolve version, derive key, encrypt under a 72-byte AAD
    // that is byte-identical to the envelope header the chain validates.
    const keyVersion =
      scope === WtScope.Dm ? 1 : await this.keyProvider.getCurrentVersion(accounts.thread);
    const key = await this.keyProvider.getKey(accounts.thread, keyVersion);
    const nonce = crypto.getRandomValues(new Uint8Array(WT_NONCE_LEN));

    // Single canonical flags value used by BOTH the AAD and encodeEnvelope so
    // they can never diverge. The chain only checks bit0, so a mismatch would
    // otherwise be accepted on-chain yet fail decrypt off-chain.
    const flags = WT_FLAG_ENCRYPTED & 0xff;

    // Construct the AAD directly (same byte layout as envelope[0..72]).
    const aad = new Uint8Array(72);
    aad.set([0x77, 0x74, 0x31], 0);
    aad[3] = flags;
    aad.set(accounts.thread.toBytes(), 4);
    aad.set(accounts.sender.toBytes(), 36);
    new DataView(aad.buffer).setUint32(68, keyVersion >>> 0, true);

    const ciphertext = encryptBody(key, nonce, bodyBytes, aad);
    const envelope = encodeEnvelope({
      flags,
      threadPda: accounts.thread,
      senderWallet: accounts.sender,
      keyVersion,
      bodyNonce: nonce,
      body: ciphertext,
    });
    return createPostWarTableMessageInstruction(accounts, { scope, envelope });
  }

  /**
   * Post a message: builds the envelope+instruction, applies the priority-fee
   * ceiling, signs via the caller's `signTx`, and sends. `signTx` receives the
   * unsigned transaction and must return a fully signed transaction.
   */
  async postMessage(
    thread: PublicKey,
    scope: WtScope,
    gateAccounts: PublicKey[],
    sender: PublicKey,
    senderPlayer: PublicKey,
    body: PostMessageBody,
    signTx: (tx: Transaction) => Promise<Transaction>,
    opts: PostMessageOpts = {},
  ): Promise<PostMessageResult> {
    const ix = await this.buildPostInstruction(
      { thread, sender, senderPlayer, gateAccounts },
      scope,
      body,
    );

    const ceiling = opts.maxPriorityFeeMicroLamportsPerCu ?? WT_MAX_PRIORITY_FEE_MICRO_LAMPORTS_PER_CU;
    const fees = await this.connection.getRecentPrioritizationFees({ lockedWritableAccounts: [thread] });
    const median = medianPriorityFee(fees);
    const congested = median > ceiling;
    const effective = Math.min(median, ceiling);

    const tx = new Transaction();
    if (opts.computeUnitLimit !== undefined) {
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit }));
    }
    if (effective > 0) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: effective }));
    }
    tx.add(ix);
    tx.feePayer = sender;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    const signed = await signTx(tx);
    // web3.js v3: legacy Transaction.serialize() is async.
    const signature = await this.connection.sendRawTransaction(await signed.serialize());

    return {
      signature,
      congested,
      priorityFeeMicroLamportsPerCu: effective,
    };
  }

  /**
   * Read a thread's full message history. Fetches the thread account's
   * transactions via fetchAddressLogs (enhanced getTransactionsForAddress where
   * the RPC supports it, else getSignaturesForAddress + getTransaction).
   * Decodes every wt1 envelope, best-effort decrypts, then applies the shared
   * read-model fold (tombstones, reactions, pin) via foldThread.
   *
   * Reaction (kind=5) and pin (kind=6) messages are folded onto their parents
   * and NOT returned as bubbles. Each returned bubble carries its folded
   * reactions[] and the thread-wide pinnedId (WT_ID_ZERO when none). Pass
   * opts.myWallet to populate ReactionSummary.mine and myReactionId.
   */
  async readThread(
    thread: PublicKey,
    opts: { limit?: number; fetchAll?: boolean; myWallet?: PublicKey | string } = {},
  ): Promise<ReadMessage[]> {
    const txs = await this.fetchAddressLogs(thread, {
      limit: opts.limit ?? 1000,
      fetchAll: opts.fetchAll ?? false,
    });
    const raw: ReadMessage[] = [];

    for (const { slot, txDisc, logMessages } of txs) {
      const blobs = readProgramData(logMessages).filter(isWt1);
      let logIndex = 0;
      for (const blob of blobs) {
        const msg = await this.decodeAndDecrypt(blob, slot, txDisc, logIndex);
        logIndex += 1;
        if (!msg) continue;
        raw.push(msg);
      }
    }

    return foldThread(raw, { myWallet: opts.myWallet }).messages;
  }

  /**
   * Read ONE page of a thread, newest-first, for infinite-scroll-up.
   *
   * Returns RAW decoded messages (reaction/pin/tombstone kinds INCLUDED, NOT
   * folded — a fold needs the whole thread) sorted ascending by id, plus an
   * opaque `nextCursor` for the next OLDER page (null at the start of history).
   * Accumulate pages across scrolls and run `foldThread` (or feed the web store,
   * which folds incrementally) to render. `opts.limit` is the page size
   * (default 50); `opts.cursor` is the previous page's `nextCursor`.
   */
  async readThreadPage(
    thread: PublicKey,
    opts: { limit?: number; cursor?: string | null } = {},
  ): Promise<ThreadPage> {
    const page = await this.fetchAddressPage(thread, opts.limit ?? 50, opts.cursor ?? null);
    const messages: ReadMessage[] = [];
    for (const { slot, txDisc, logMessages } of page.logs) {
      const blobs = readProgramData(logMessages).filter(isWt1);
      let logIndex = 0;
      for (const blob of blobs) {
        const msg = await this.decodeAndDecrypt(blob, slot, txDisc, logIndex);
        logIndex += 1;
        if (msg) messages.push(msg);
      }
    }
    messages.sort((a, b) => compareId(a.id, b.id));
    return { messages, nextCursor: page.nextCursor };
  }

  /**
   * Resolve only the current pin target for a thread without building the full
   * bubble list. Convenience over readThread for callers that just need the pin
   * banner; same fold semantics (highest-id non-tombstoned kind=6, WT_ID_ZERO
   * for none/unpin).
   */
  async readThreadPin(
    thread: PublicKey,
    opts: { limit?: number; fetchAll?: boolean } = {},
  ): Promise<Uint8Array> {
    const txs = await this.fetchAddressLogs(thread, {
      limit: opts.limit ?? 1000,
      fetchAll: opts.fetchAll ?? false,
    });
    const raw: ReadMessage[] = [];
    for (const { slot, txDisc, logMessages } of txs) {
      const blobs = readProgramData(logMessages).filter(isWt1);
      let logIndex = 0;
      for (const blob of blobs) {
        const msg = await this.decodeAndDecrypt(blob, slot, txDisc, logIndex);
        logIndex += 1;
        if (!msg) continue;
        raw.push(msg);
      }
    }
    return foldThread(raw).pinnedId;
  }

  /**
   * Read a thread AND synthesize derived System lines from the entity's on-chain
   * events, merged into the timeline by id. The thread PDA is the entity PDA, so
   * the same txs readThread fetches already carry the Anchor event blobs; this
   * is the zero-extra-RPC path.
   *
   * Load-bearing: ONE logIndex counter per tx increments for EVERY Program data
   * blob regardless of type, so a wt1 message id never collides with an event id
   * in the same tx. System items are kind=System ReadMessages (never posted);
   * reaction/pin folds still apply to the wt1 messages.
   */
  async readThreadWithSystem(
    thread: PublicKey,
    scope: WtScope,
    opts: { limit?: number; fetchAll?: boolean; myWallet?: PublicKey | string } = {},
  ): Promise<ReadMessage[]> {
    const txs = await this.fetchAddressLogs(thread, {
      limit: opts.limit ?? 1000,
      fetchAll: opts.fetchAll ?? false,
    });
    const raw: ReadMessage[] = [];
    const systemItems: ReadMessage[] = [];

    for (const { slot, txDisc, logMessages } of txs) {
      // One ordered blob list, one shared logIndex, per the section-8 risk note.
      const blobs = readProgramData(logMessages);
      let logIndex = 0;
      for (const blob of blobs) {
        const idx = logIndex;
        logIndex += 1;
        if (isWt1(blob)) {
          const msg = await this.decodeAndDecrypt(blob, slot, txDisc, idx);
          if (msg) raw.push(msg);
          continue;
        }
        const event = parseNovusMundusEvent(blob);
        if (!event) continue;
        const label = systemLabelFor(scope, thread, event);
        if (label === null) continue;
        const timestamp = (event.data as { timestamp?: { toString(): string } }).timestamp;
        const createdAt = timestamp === undefined ? 0n : BigInt(timestamp.toString());
        systemItems.push({
          id: encodeMessageId({ slot, txDisc, logIndex: idx }),
          scope,
          senderWallet: thread,
          threadPda: thread,
          keyVersion: 0,
          kind: WtKind.System,
          createdAt,
          parentId: WT_ID_ZERO,
          payload: new TextEncoder().encode(label),
          decrypted: true,
          txIndexResolved: false,
        });
      }
    }

    // Fold wt1 messages, then merge the synthetic System items and re-sort by id
    // so System lines interleave with chat by slot for free.
    const folded = foldThread(raw, { myWallet: opts.myWallet });
    const merged = folded.messages.concat(
      systemItems.map((s) => ({ ...s, pinnedId: folded.pinnedId })),
    );
    return merged.sort((a, b) => compareId(a.id, b.id));
  }

  /**
   * One page of readThreadWithSystem, for infinite-scroll-up: returns RAW
   * (unfolded) wt1 messages PLUS synthesized System bubbles, ascending by id,
   * and the next-older cursor (null at the start of history). Uses the
   * all-program-data logIndex (matching readThreadWithSystem) so a wt1 id never
   * collides with an event id in the same tx. The caller accumulates pages and
   * folds (feed the web store, which folds incrementally via `ingest`).
   */
  async readThreadPageWithSystem(
    thread: PublicKey,
    scope: WtScope,
    opts: { limit?: number; cursor?: string | null } = {},
  ): Promise<ThreadPage> {
    const page = await this.fetchAddressPage(thread, opts.limit ?? 50, opts.cursor ?? null);
    const messages: ReadMessage[] = [];
    for (const { slot, txDisc, logMessages } of page.logs) {
      const blobs = readProgramData(logMessages);
      let logIndex = 0;
      for (const blob of blobs) {
        const idx = logIndex;
        logIndex += 1;
        if (isWt1(blob)) {
          const msg = await this.decodeAndDecrypt(blob, slot, txDisc, idx);
          if (msg) messages.push(msg);
          continue;
        }
        const event = parseNovusMundusEvent(blob);
        if (!event) continue;
        const label = systemLabelFor(scope, thread, event);
        if (label === null) continue;
        const timestamp = (event.data as { timestamp?: { toString(): string } }).timestamp;
        const createdAt = timestamp === undefined ? 0n : BigInt(timestamp.toString());
        messages.push({
          id: encodeMessageId({ slot, txDisc, logIndex: idx }),
          scope,
          senderWallet: thread,
          threadPda: thread,
          keyVersion: 0,
          kind: WtKind.System,
          createdAt,
          parentId: WT_ID_ZERO,
          payload: new TextEncoder().encode(label),
          decrypted: true,
          txIndexResolved: false,
        });
      }
    }
    messages.sort((a, b) => compareId(a.id, b.id));
    return { messages, nextCursor: page.nextCursor };
  }

  /**
   * Subscribe to live thread messages via onLogs. The callback fires for each
   * decoded wt1 message; the id's within-slot discriminator comes from the
   * notification's signature, identical to what the read paths derive, so a live
   * message and its later read-back share one id.
   *
   * Reaction (kind=5), pin (kind=6) and tombstone (kind=4) messages are emitted
   * RAW, one per blob, exactly like text messages: the per-message stream cannot
   * fold (the fold needs the whole thread), so the consumer must run the same
   * fold the store does (mirroring why the fold lives in foldThread, not here).
   */
  subscribeThread(
    thread: PublicKey,
    onMessage: (msg: ReadMessage) => void,
  ): { unsubscribe: () => void } {
    const subId = this.connection.onLogs(
      thread,
      (logs, ctx) => {
        if (logs.err) return;
        const slot = BigInt(ctx.slot);
        const txDisc = txDiscFromSignature(logs.signature);
        const blobs = readProgramData(logs.logs).filter(isWt1);
        let logIndex = 0;
        for (const blob of blobs) {
          const idx = logIndex;
          logIndex += 1;
          void this.decodeAndDecrypt(blob, slot, txDisc, idx).then((msg) => {
            if (msg) onMessage(msg);
          });
        }
      },
      'confirmed',
    );
    return {
      unsubscribe: () => {
        void this.connection.removeOnLogsListener(subId);
      },
    };
  }

  /**
   * Discover the caller's DM conversations. getSignaturesForAddress on the
   * caller's PlayerAccount PDA surfaces every tx that touched it (both DM
   * participants are in the post instruction's account list, so this finds
   * threads where the caller is either side). Filters scope==4 envelopes and
   * groups distinct thread PDAs.
   */
  async discoverDmThreads(
    myPlayerPda: PublicKey,
    opts: { limit?: number; fetchAll?: boolean } = {},
  ): Promise<DmConversation[]> {
    const txs = await this.fetchAddressLogs(myPlayerPda, {
      limit: opts.limit ?? 1000,
      fetchAll: opts.fetchAll ?? false,
    });
    const byThread = new Map<string, DmConversation>();

    for (const { slot, txDisc, logMessages } of txs) {
      const blobs = readProgramData(logMessages).filter(isWt1);
      let logIndex = 0;
      for (const blob of blobs) {
        const idx = logIndex;
        logIndex += 1;
        let env: WtEnvelope;
        try {
          env = decodeEnvelope(blob);
        } catch {
          continue;
        }
        // DM envelopes are encrypted with keyVersion 1; we cannot tell scope
        // from the envelope alone, so group by thread PDA and record the id.
        const id = encodeMessageId({ slot, txDisc, logIndex: idx });
        const key = env.threadPda.toBase58();
        const existing = byThread.get(key);
        if (!existing || compareId(id, existing.lastMessageId) > 0) {
          byThread.set(key, { threadPda: env.threadPda, lastMessageId: id });
        }
      }
    }
    return Array.from(byThread.values());
  }

  // Decode a raw wt1 blob and attempt decryption. Returns null on decode error.
  private async decodeAndDecrypt(
    blob: Uint8Array,
    slot: bigint,
    txDisc: number,
    logIndex: number,
  ): Promise<ReadMessage | null> {
    let env: WtEnvelope;
    try {
      env = decodeEnvelope(blob);
    } catch {
      return null;
    }

    const id = encodeMessageId({ slot, txDisc, logIndex });
    let payload: Uint8Array = new Uint8Array(0);
    let decrypted = false;
    let bodyBytes: Uint8Array | null = null;

    if (!env.encrypted) {
      bodyBytes = env.body;
      decrypted = true;
    } else {
      try {
        const key = await this.keyProvider.getKey(env.threadPda, env.keyVersion);
        bodyBytes = decryptBody(key, env.bodyNonce, env.body, env.aad);
        decrypted = true;
      } catch {
        // key unavailable or decrypt failed: leave locked, not an error.
        bodyBytes = null;
        decrypted = false;
      }
    }

    let kind = WtKind.Text;
    let createdAt = 0n;
    let parentId = WT_ID_ZERO;
    if (bodyBytes) {
      try {
        const body = decodeBody(bodyBytes);
        kind = body.kind;
        createdAt = body.createdAt;
        parentId = body.parentId;
        payload = body.payload;
      } catch {
        decrypted = false;
        payload = new Uint8Array(0);
      }
    }

    return {
      id,
      scope: scopeFromFlags(env),
      senderWallet: env.senderWallet,
      threadPda: env.threadPda,
      keyVersion: env.keyVersion,
      kind,
      createdAt,
      parentId,
      payload,
      decrypted,
      txIndexResolved: false,
    };
  }
}

// The scope is not carried in the envelope (it is an instruction-data byte),
// so infer a best-effort scope for the read model: plaintext => Encounter,
// keyVersion 1 => Dm, otherwise a membership scope (reported as Team as a
// neutral default; the caller already knows the real scope from context).
// Public is also a plaintext scope, so it is indistinguishable from Encounter
// here; reporting Encounter is fine since the caller knows the real scope.
function scopeFromFlags(env: WtEnvelope): WtScope {
  if (!env.encrypted) return WtScope.Encounter;
  if (env.keyVersion === 1) return WtScope.Dm;
  return WtScope.Team;
}

// web3.js v3: getRecentPrioritizationFees returns prioritizationFee as a bigint
// (MicroLamports brand) and slot as bigint. Accept the bigint-bearing shape and
// reduce to a plain number median (per-CU micro-lamport prices are small enough
// to be exact as numbers).
function medianPriorityFee(
  fees: readonly { slot: bigint; prioritizationFee: bigint }[],
): number {
  if (fees.length === 0) return 0;
  const sorted = fees.map((f) => Number(f.prioritizationFee)).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}
