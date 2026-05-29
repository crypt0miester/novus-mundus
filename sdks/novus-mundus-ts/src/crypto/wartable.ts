// War Table envelope crypto.
//
// Single source of truth for the on-the-wire `wt1` envelope, the inner body
// format, the thread-key KDF, and the XChaCha20-Poly1305 AEAD used for
// encrypted scopes. Byte layouts mirror WAR_TABLE_IMPL_SPEC sections 1 and 4
// exactly; the chain validator in post.rs and the SDK encoder/decoder must
// agree byte-for-byte.

import { PublicKey } from '@solana/web3.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Envelope constants (section 1).

/** Magic prefix b"wt1" = [0x77, 0x74, 0x31]. */
export const WT_MAGIC: Uint8Array = new Uint8Array([0x77, 0x74, 0x31]);

/** flags bit0: set means the body is XChaCha20-Poly1305 ciphertext. */
export const WT_FLAG_ENCRYPTED = 0x01;

/** Fixed envelope overhead before the body: 98 bytes. */
export const WT_HEADER_OVERHEAD = 98;

// Global maximum UTF-8 byte length of a war-table message's user text. The
// binding ceiling is the 1232-byte Solana transaction size, not CU or log
// truncation: once the text pushes the serialized tx past 1232, web3.js throws
// "Transaction too large" before the instruction ever executes. It is measured
// against the REAL send path, which prepends ComputeBudget unit-price and
// unit-limit instructions (about 52 bytes; postMessage adds the unit price
// whenever the network reports a priority fee, i.e. exactly on a congested
// chain). The budget is tightest for the DM scope (5 accounts, encrypted body
// carries the 16-byte poly1305 tag), whose empirical hard max on that send path
// is 770 bytes. This single global value is 770 minus a 70-byte safety margin
// (a round, comfortable cap), so it is safe for every scope (Team 804, Encounter
// 820 have more room). Measured by the 31-wartable-limits discovery test.
// Limited by BYTES, not characters: a 4-byte emoji costs 4. Reactions/pins/
// tombstones carry tiny or empty payloads and are well under this limit.
export const WT_MAX_TEXT_BYTES = 700;

/** AAD covers magic, flags, thread_pda, sender_wallet, key_version: bytes 0..72. */
export const WT_AAD_LEN = 72;

/** XChaCha20 nonce length. */
export const WT_NONCE_LEN = 24;

/** AEAD key length. */
export const WT_KEY_LEN = 32;

/** Inner body format version. */
export const WT_BODY_VERSION = 0x01;

// Enums.

/** Scope tag, encoded as the first instruction-data byte. */
export enum WtScope {
  Team = 0,
  Rally = 1,
  Castle = 2,
  Encounter = 3,
  Dm = 4,
}

/** Inner-body message kind. */
export enum WtKind {
  Text = 0,
  Pledge = 1,
  System = 2,
  Reply = 3,
  Tombstone = 4,
  // Reaction (kind=5): parent_id = reacted-to message id, payload = the emoji
  // UTF-8 bytes. Folded onto the parent; never shown as a bubble. Un-react is a
  // Tombstone whose parent_id is the reaction message's own id.
  Reaction = 5,
  // Pin (kind=6): parent_id = pinned message id, or WT_ID_ZERO to unpin. The
  // current pin is the highest-id non-tombstoned kind=6 message. Folded; never a
  // bubble. No tombstone needed to unpin (post a zero-parent pin).
  Pin = 6,
}

// Field offsets within the fixed envelope header (section 1).
const OFF_MAGIC = 0;
const OFF_FLAGS = 3;
const OFF_THREAD = 4;
const OFF_SENDER = 36;
const OFF_KEY_VERSION = 68;
const OFF_NONCE = 72;
const OFF_BODY_LEN = 96;
const OFF_BODY = 98;

// Inner body offsets (section 1).
const BODY_OFF_VERSION = 0;
const BODY_OFF_KIND = 1;
const BODY_OFF_CREATED_AT = 2;
const BODY_OFF_PARENT_ID = 10;
const BODY_OFF_PAYLOAD = 22;

/** 12-byte ordering coordinate slot|tx_index|log_index. */
export const WT_ID_LEN = 12;

/** The nil parent id (root message): 12 zero bytes. */
export const WT_ID_ZERO: Uint8Array = new Uint8Array(WT_ID_LEN);

// Envelope encode/decode.

export interface WtEnvelopeInput {
  /** flags byte; bit0 must reflect whether `body` is ciphertext. */
  flags: number;
  /** target thread PDA. */
  threadPda: PublicKey;
  /** signing wallet. */
  senderWallet: PublicKey;
  /** key_version per scope (section 5). */
  keyVersion: number;
  /** 24-byte nonce; all-zero when plaintext. */
  bodyNonce: Uint8Array;
  /** body bytes: ciphertext (with poly1305 tag) when encrypted, else plaintext. */
  body: Uint8Array;
}

export interface WtEnvelope {
  /** the original raw envelope bytes. */
  raw: Uint8Array;
  flags: number;
  encrypted: boolean;
  threadPda: PublicKey;
  senderWallet: PublicKey;
  keyVersion: number;
  bodyNonce: Uint8Array;
  body: Uint8Array;
  /** the AEAD additional-authenticated-data: raw.subarray(0, 72). */
  aad: Uint8Array;
}

function u32le(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, value >>> 0, true);
}

function readU32le(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset, true);
}

function u16le(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint16(offset, value & 0xffff, true);
}

function readU16le(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(offset, true);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Encode a `wt1` envelope per section 1. */
export function encodeEnvelope(input: WtEnvelopeInput): Uint8Array {
  if (input.bodyNonce.length !== WT_NONCE_LEN) {
    throw new Error(`bodyNonce must be ${WT_NONCE_LEN} bytes, got ${input.bodyNonce.length}`);
  }
  if (input.body.length > 0xffff) {
    throw new Error(`body too large: ${input.body.length} > 65535`);
  }
  const bodyLen = input.body.length;
  const out = new Uint8Array(WT_HEADER_OVERHEAD + bodyLen);
  out.set(WT_MAGIC, OFF_MAGIC);
  out[OFF_FLAGS] = input.flags & 0xff;
  out.set(input.threadPda.toBytes(), OFF_THREAD);
  out.set(input.senderWallet.toBytes(), OFF_SENDER);
  u32le(out, OFF_KEY_VERSION, input.keyVersion);
  out.set(input.bodyNonce, OFF_NONCE);
  u16le(out, OFF_BODY_LEN, bodyLen);
  out.set(input.body, OFF_BODY);
  return out;
}

/**
 * Decode and validate a `wt1` envelope per section 1 validation steps.
 * Rejects trailing bytes (parse-boundary strictness). Throws on any violation.
 */
export function decodeEnvelope(bytes: Uint8Array): WtEnvelope {
  if (bytes.length < WT_HEADER_OVERHEAD) {
    throw new Error(`envelope too short: ${bytes.length} < ${WT_HEADER_OVERHEAD}`);
  }
  if (!bytesEqual(bytes.subarray(OFF_MAGIC, OFF_MAGIC + 3), WT_MAGIC)) {
    throw new Error('bad magic: expected wt1');
  }
  const flags = bytes[OFF_FLAGS]!;
  const threadPda = new PublicKey(bytes.subarray(OFF_THREAD, OFF_THREAD + 32));
  const senderWallet = new PublicKey(bytes.subarray(OFF_SENDER, OFF_SENDER + 32));
  const keyVersion = readU32le(bytes, OFF_KEY_VERSION);
  const bodyNonce = bytes.subarray(OFF_NONCE, OFF_NONCE + WT_NONCE_LEN);
  const bodyLen = readU16le(bytes, OFF_BODY_LEN);
  if (bytes.length !== WT_HEADER_OVERHEAD + bodyLen) {
    throw new Error(`body length mismatch: declared ${bodyLen}, actual ${bytes.length - WT_HEADER_OVERHEAD}`);
  }
  const body = bytes.subarray(OFF_BODY, OFF_BODY + bodyLen);
  const aad = bytes.subarray(0, WT_AAD_LEN);
  return {
    raw: bytes,
    flags,
    encrypted: (flags & WT_FLAG_ENCRYPTED) === WT_FLAG_ENCRYPTED,
    threadPda,
    senderWallet,
    keyVersion,
    bodyNonce,
    body,
    aad,
  };
}

// KDF (section 4).

/**
 * Derive the per-thread, per-version AEAD key.
 *
 * K_thread = HMAC-SHA256(K_master, b"wt1" | thread_pda | key_version_u32_le).
 */
export function deriveThreadKey(
  masterSecret: Uint8Array,
  threadPda: PublicKey,
  keyVersion: number,
): Uint8Array {
  const msg = new Uint8Array(3 + 32 + 4);
  msg.set(WT_MAGIC, 0);
  msg.set(threadPda.toBytes(), 3);
  u32le(msg, 35, keyVersion);
  return hmac(sha256, masterSecret, msg);
}

// AEAD.

/** Encrypt `plaintext` under XChaCha20-Poly1305; output includes the 16-byte tag. */
export function encryptBody(
  key: Uint8Array,
  nonce24: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (key.length !== WT_KEY_LEN) {
    throw new Error(`key must be ${WT_KEY_LEN} bytes, got ${key.length}`);
  }
  if (nonce24.length !== WT_NONCE_LEN) {
    throw new Error(`nonce must be ${WT_NONCE_LEN} bytes, got ${nonce24.length}`);
  }
  return xchacha20poly1305(key, nonce24, aad).encrypt(plaintext);
}

/** Decrypt XChaCha20-Poly1305 ciphertext; throws on tag/AAD mismatch. */
export function decryptBody(
  key: Uint8Array,
  nonce24: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (key.length !== WT_KEY_LEN) {
    throw new Error(`key must be ${WT_KEY_LEN} bytes, got ${key.length}`);
  }
  if (nonce24.length !== WT_NONCE_LEN) {
    throw new Error(`nonce must be ${WT_NONCE_LEN} bytes, got ${nonce24.length}`);
  }
  return xchacha20poly1305(key, nonce24, aad).decrypt(ciphertext);
}

// Inner body (section 1).

export interface WtBody {
  /** must be WT_BODY_VERSION on decode. */
  version: number;
  kind: WtKind;
  /** advisory Unix seconds. */
  createdAt: bigint;
  /** 12-byte parent message id; WT_ID_ZERO for a root message. */
  parentId: Uint8Array;
  /** UTF-8 text or binary depending on kind. */
  payload: Uint8Array;
}

/** 12-byte message ordering coordinate. */
export interface WtMessageId {
  slot: bigint;
  txIndex: number;
  logIndex: number;
}

/** Encode the inner body per section 1 body format. */
export function encodeBody(b: WtBody): Uint8Array {
  if (b.parentId.length !== WT_ID_LEN) {
    throw new Error(`parentId must be ${WT_ID_LEN} bytes, got ${b.parentId.length}`);
  }
  const out = new Uint8Array(BODY_OFF_PAYLOAD + b.payload.length);
  out[BODY_OFF_VERSION] = b.version & 0xff;
  out[BODY_OFF_KIND] = b.kind & 0xff;
  new DataView(out.buffer).setBigInt64(BODY_OFF_CREATED_AT, b.createdAt, true);
  out.set(b.parentId, BODY_OFF_PARENT_ID);
  out.set(b.payload, BODY_OFF_PAYLOAD);
  return out;
}

/** Decode the inner body; throws on unknown version or short buffer. */
export function decodeBody(buf: Uint8Array): WtBody {
  if (buf.length < BODY_OFF_PAYLOAD) {
    throw new Error(`body too short: ${buf.length} < ${BODY_OFF_PAYLOAD}`);
  }
  const version = buf[BODY_OFF_VERSION]!;
  if (version !== WT_BODY_VERSION) {
    throw new Error(`unknown body version ${version}`);
  }
  const kind = buf[BODY_OFF_KIND]! as WtKind;
  const createdAt = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getBigInt64(
    BODY_OFF_CREATED_AT,
    true,
  );
  const parentId = buf.subarray(BODY_OFF_PARENT_ID, BODY_OFF_PARENT_ID + WT_ID_LEN);
  const payload = buf.subarray(BODY_OFF_PAYLOAD);
  return { version, kind, createdAt, parentId, payload };
}

// Encode a 12-byte message id: slot u64 BE | log_index u32 BE.
// Big-endian on purpose so byte order == hex-string order == chronological
// (slot, then logIndex) order. Every comparator relies on this: the SDK
// compareId byte scan and the web store's plain hex-string compare both assume
// lexicographic order equals chronological order, which only holds big-endian.
// tx_index is not resolvable from logs (always 0), so it is not stored; the
// 12 bytes are slot(8) + logIndex(4).
export function encodeMessageId(id: WtMessageId): Uint8Array {
  const out = new Uint8Array(WT_ID_LEN);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, id.slot, false);
  view.setUint32(8, id.logIndex >>> 0, false);
  return out;
}

// Decode a 12-byte message id. tx_index is not stored (always 0).
export function decodeMessageId(buf: Uint8Array): WtMessageId {
  if (buf.length < WT_ID_LEN) {
    throw new Error(`message id too short: ${buf.length} < ${WT_ID_LEN}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    slot: view.getBigUint64(0, false),
    txIndex: 0,
    logIndex: view.getUint32(8, false),
  };
}

/**
 * Convert a fixed-width 24-char hex message id back to its 12 raw bytes. The
 * inverse of the web idHex; required because reply/delete/react/pin targets
 * originate as store hex ids but `post` needs the 12-byte parentId. Throws on a
 * malformed (non-24-char or non-hex) input so a bad id is rejected at the
 * boundary rather than silently producing a zeroed parent.
 */
export function hexToId(hex: string): Uint8Array {
  if (hex.length !== WT_ID_LEN * 2) {
    throw new Error(`message id hex must be ${WT_ID_LEN * 2} chars, got ${hex.length}`);
  }
  const out = new Uint8Array(WT_ID_LEN);
  for (let i = 0; i < WT_ID_LEN; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`message id hex has a non-hex byte at ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/** Hex-encode a 12-byte message id (fixed-width 24 chars). Inverse of hexToId. */
export function idToHex(id: Uint8Array): string {
  if (id.length !== WT_ID_LEN) {
    throw new Error(`message id must be ${WT_ID_LEN} bytes, got ${id.length}`);
  }
  let out = '';
  for (let i = 0; i < WT_ID_LEN; i++) {
    out += id[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Derive a client-side read-cache key from a transaction signature.
 * For local decrypt caching only; never used as an AEAD key.
 */
export function deriveSessionCacheKey(signature: Uint8Array): Uint8Array {
  return sha256(signature);
}
