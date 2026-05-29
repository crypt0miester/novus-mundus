// War Table crypto unit tests (TASK T1).
//
// Pure crypto: no LiteSVM, no chain, no network. Pins the KDF formula,
// AEAD round-trip / tamper behaviour, plaintext path, and the exact `wt1`
// wire shape from WAR_TABLE_IMPL_SPEC sections 1 and 4.

import { describe, it, expect } from 'bun:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  WT_MAGIC,
  WT_AAD_LEN,
  WT_HEADER_OVERHEAD,
  WT_NONCE_LEN,
  WT_ID_LEN,
  WT_ID_ZERO,
  WtKind,
  WtScope,
  deriveThreadKey,
  encryptBody,
  decryptBody,
  encodeEnvelope,
  decodeEnvelope,
  encodeMessageId,
  hexToId,
  idToHex,
} from '../../src/crypto/wartable';
import { foldThread, type ReadMessage } from '../../src/wartable';

const K_MASTER = new Uint8Array(32).fill(7);

function randomPubkey(): PublicKey {
  return Keypair.generate().publicKey;
}

function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
}

function u16le(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v & 0xffff, true);
  return b;
}

describe('War Table crypto', () => {
  it('1. KDF determinism and version/pda sensitivity', () => {
    const pda = randomPubkey();
    const k1 = deriveThreadKey(K_MASTER, pda, 3);
    const k2 = deriveThreadKey(K_MASTER, pda, 3);
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
    expect(k1.length).toBe(32);

    const kDiffVersion = deriveThreadKey(K_MASTER, pda, 4);
    expect(Buffer.from(k1).equals(Buffer.from(kDiffVersion))).toBe(false);

    const kDiffPda = deriveThreadKey(K_MASTER, randomPubkey(), 3);
    expect(Buffer.from(k1).equals(Buffer.from(kDiffPda))).toBe(false);

    // Cross-check the formula: HMAC-SHA256(K, b"wt1" | pda | version_le).
    const msg = new Uint8Array(3 + 32 + 4);
    msg.set(WT_MAGIC, 0);
    msg.set(pda.toBytes(), 3);
    msg.set(u32le(3), 35);
    const reference = hmac(sha256, K_MASTER, msg);
    expect(Buffer.from(k1).equals(Buffer.from(reference))).toBe(true);
  });

  it('2. AEAD round-trip', () => {
    const key = deriveThreadKey(K_MASTER, randomPubkey(), 1);
    const nonce = new Uint8Array(WT_NONCE_LEN).fill(9);
    const aad = new Uint8Array(WT_AAD_LEN).fill(3);
    const plaintext = new TextEncoder().encode('rally the house at dawn');

    const ct = encryptBody(key, nonce, plaintext, aad);
    const pt = decryptBody(key, nonce, ct, aad);
    expect(Buffer.from(pt).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('3. AAD tamper causes decrypt failure', () => {
    const key = deriveThreadKey(K_MASTER, randomPubkey(), 1);
    const nonce = new Uint8Array(WT_NONCE_LEN).fill(2);
    const aad1 = new Uint8Array(WT_AAD_LEN).fill(1);
    const aad2 = Uint8Array.from(aad1);
    aad2[0] = aad2[0]! ^ 0x01; // flip one bit
    const plaintext = new TextEncoder().encode('secret march order');

    const ct = encryptBody(key, nonce, plaintext, aad1);
    expect(() => decryptBody(key, nonce, ct, aad2)).toThrow();
  });

  it('4. Nonce uniqueness yields distinct ciphertexts, both decrypt', () => {
    const key = deriveThreadKey(K_MASTER, randomPubkey(), 1);
    const aad = new Uint8Array(WT_AAD_LEN).fill(5);
    const plaintext = new TextEncoder().encode('same message different nonce');
    const nonceA = new Uint8Array(WT_NONCE_LEN).fill(0xaa);
    const nonceB = new Uint8Array(WT_NONCE_LEN).fill(0xbb);

    const ctA = encryptBody(key, nonceA, plaintext, aad);
    const ctB = encryptBody(key, nonceB, plaintext, aad);
    expect(Buffer.from(ctA).equals(Buffer.from(ctB))).toBe(false);

    expect(Buffer.from(decryptBody(key, nonceA, ctA, aad)).equals(Buffer.from(plaintext))).toBe(true);
    expect(Buffer.from(decryptBody(key, nonceB, ctB, aad)).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('5. Plaintext path: encode/decode returns body unchanged, no AEAD', () => {
    const thread = randomPubkey();
    const sender = randomPubkey();
    const plaintext = new TextEncoder().encode('enemy spotted at the gate');
    const raw = encodeEnvelope({
      flags: 0,
      threadPda: thread,
      senderWallet: sender,
      keyVersion: 0,
      bodyNonce: zeros(WT_NONCE_LEN),
      body: plaintext,
    });
    const env = decodeEnvelope(raw);
    expect(env.encrypted).toBe(false);
    expect(Buffer.from(env.body).equals(Buffer.from(plaintext))).toBe(true);
    expect(Buffer.from(env.bodyNonce).equals(Buffer.from(zeros(WT_NONCE_LEN)))).toBe(true);
  });

  it('6. Envelope wire shape matches section 1 offsets', () => {
    const thread = randomPubkey();
    const sender = randomPubkey();
    const flags = 1;
    const keyVersion = 7;
    const nonce = new Uint8Array(WT_NONCE_LEN).fill(0x42);
    const body = new TextEncoder().encode('encrypted-looking payload bytes');
    const raw = encodeEnvelope({ flags, threadPda: thread, senderWallet: sender, keyVersion, bodyNonce: nonce, body });

    expect(Buffer.from(raw.subarray(0, 3)).equals(Buffer.from(WT_MAGIC))).toBe(true);
    expect(raw[3]).toBe(flags);
    expect(Buffer.from(raw.subarray(4, 36)).equals(Buffer.from(thread.toBytes()))).toBe(true);
    expect(Buffer.from(raw.subarray(36, 68)).equals(Buffer.from(sender.toBytes()))).toBe(true);
    expect(Buffer.from(raw.subarray(68, 72)).equals(Buffer.from(u32le(keyVersion)))).toBe(true);
    expect(Buffer.from(raw.subarray(72, 96)).equals(Buffer.from(nonce))).toBe(true);
    expect(Buffer.from(raw.subarray(96, 98)).equals(Buffer.from(u16le(body.length)))).toBe(true);
    expect(raw.length).toBe(WT_HEADER_OVERHEAD + body.length);
  });

  it('7. decodeEnvelope rejects bad magic', () => {
    const raw = encodeEnvelope({
      flags: 0,
      threadPda: randomPubkey(),
      senderWallet: randomPubkey(),
      keyVersion: 0,
      bodyNonce: zeros(WT_NONCE_LEN),
      body: new TextEncoder().encode('hi'),
    });
    raw[0] = raw[0]! ^ 0xff;
    expect(() => decodeEnvelope(raw)).toThrow();
  });

  it('8. AAD equals the envelope header prefix [0..72)', () => {
    const raw = encodeEnvelope({
      flags: 1,
      threadPda: randomPubkey(),
      senderWallet: randomPubkey(),
      keyVersion: 2,
      bodyNonce: new Uint8Array(WT_NONCE_LEN).fill(1),
      body: new TextEncoder().encode('aad check'),
    });
    const env = decodeEnvelope(raw);
    expect(env.aad.length).toBe(WT_AAD_LEN);
    expect(Buffer.from(env.aad).equals(Buffer.from(raw.subarray(0, 72)))).toBe(true);
  });
});

describe('War Table message id codec', () => {
  it('hexToId round-trips against idToHex and idHex', () => {
    const id = encodeMessageId({ slot: 12345n, txIndex: 0, logIndex: 7 });
    const hex = idToHex(id);
    expect(hex.length).toBe(WT_ID_LEN * 2);
    // idToHex must agree with the canonical Buffer hex (the store's idHex).
    expect(hex).toBe(Buffer.from(id).toString('hex'));
    const back = hexToId(hex);
    expect(Buffer.from(back).equals(Buffer.from(id))).toBe(true);
  });

  it('hexToId rejects malformed input at the boundary', () => {
    expect(() => hexToId('00')).toThrow();
    expect(() => hexToId('zz'.repeat(WT_ID_LEN))).toThrow();
  });

  it('WtKind has Reaction=5 and Pin=6', () => {
    expect(WtKind.Reaction).toBe(5);
    expect(WtKind.Pin).toBe(6);
  });
});

// Pure read-model fold tests. Build ReadMessage-shaped inputs directly (no chain,
// no decrypt) and assert the reaction / pin / tombstone folds.
describe('War Table foldThread', () => {
  const THREAD = randomPubkey();
  const ALICE = randomPubkey();
  const BOB = randomPubkey();

  let logCounter = 0;
  function mkId(): Uint8Array {
    logCounter += 1;
    return encodeMessageId({ slot: BigInt(logCounter), txIndex: 0, logIndex: 0 });
  }

  function msg(
    id: Uint8Array,
    kind: WtKind,
    sender: PublicKey,
    payload: string,
    parentId: Uint8Array = WT_ID_ZERO,
  ): ReadMessage {
    return {
      id,
      scope: WtScope.Team,
      senderWallet: sender,
      threadPda: THREAD,
      keyVersion: 0,
      kind,
      createdAt: 0n,
      parentId,
      payload: new TextEncoder().encode(payload),
      decrypted: true,
      txIndexResolved: false,
    };
  }

  it('folds reactions onto the parent and does not return reaction bubbles', () => {
    const parent = mkId();
    const raw = [
      msg(parent, WtKind.Text, ALICE, 'hello'),
      msg(mkId(), WtKind.Reaction, ALICE, '\u{1F525}', parent),
      msg(mkId(), WtKind.Reaction, BOB, '\u{1F525}', parent),
      msg(mkId(), WtKind.Reaction, BOB, '\u{2764}\u{FE0F}', parent),
    ];
    const { messages } = foldThread(raw, { myWallet: ALICE });

    // Only the text bubble survives; reactions are folded, not bubbles.
    expect(messages.length).toBe(1);
    expect(messages.every((m) => m.kind !== WtKind.Reaction)).toBe(true);

    const bubble = messages[0]!;
    expect(bubble.reactions).toBeDefined();
    expect(bubble.reactions!.length).toBe(2);
    const fire = bubble.reactions!.find((r) => r.emoji === '\u{1F525}')!;
    expect(fire.count).toBe(2);
    expect(fire.reactorWallets).toEqual([ALICE.toBase58(), BOB.toBase58()]);
    expect(fire.mine).toBe(true);
    expect(fire.myReactionId).toBeDefined();
    const heart = bubble.reactions!.find((r) => r.emoji === '\u{2764}\u{FE0F}')!;
    expect(heart.count).toBe(1);
    expect(heart.mine).toBe(false);
    expect(heart.myReactionId).toBeUndefined();
  });

  it('un-react: a tombstone of MY reaction id removes only my reaction', () => {
    const parent = mkId();
    const myReactId = mkId();
    const raw = [
      msg(parent, WtKind.Text, ALICE, 'hi'),
      msg(myReactId, WtKind.Reaction, ALICE, '\u{1F44D}', parent),
      msg(mkId(), WtKind.Reaction, BOB, '\u{1F44D}', parent),
      // Tombstone targets the REACTION message id, not the reacted-to message.
      msg(mkId(), WtKind.Tombstone, ALICE, '', myReactId),
    ];
    const { messages } = foldThread(raw, { myWallet: ALICE });
    // The text bubble plus the tombstone bubble (tombstones are kept like the
    // original readThread; the renderer hides them). Reactions are folded out.
    const bubble = messages.find((m) => Buffer.from(m.id).equals(Buffer.from(parent)))!;
    expect(bubble).toBeDefined();
    // Parent text is NOT tombstoned (the tombstone hit a reaction, not the bubble).
    expect(bubble.tombstoned).toBeFalsy();
    expect(bubble.payload.length).toBeGreaterThan(0);
    const up = bubble.reactions!.find((r) => r.emoji === '\u{1F44D}')!;
    expect(up.count).toBe(1);
    expect(up.reactorWallets).toEqual([BOB.toBase58()]);
    expect(up.mine).toBe(false);
  });

  it('un-react that empties an emoji drops the summary entry', () => {
    const parent = mkId();
    const reactId = mkId();
    const raw = [
      msg(parent, WtKind.Text, ALICE, 'hi'),
      msg(reactId, WtKind.Reaction, ALICE, '\u{1F622}', parent),
      msg(mkId(), WtKind.Tombstone, ALICE, '', reactId),
    ];
    const { messages } = foldThread(raw);
    const bubble = messages.find((m) => Buffer.from(m.id).equals(Buffer.from(parent)))!;
    expect(bubble.reactions).toEqual([]);
  });

  it('tombstone of a TEXT message still folds the parent bubble', () => {
    const parent = mkId();
    const raw = [
      msg(parent, WtKind.Text, ALICE, 'delete me'),
      msg(mkId(), WtKind.Tombstone, ALICE, '', parent),
    ];
    const { messages } = foldThread(raw);
    // Tombstone messages are kept as bubbles (original readThread behavior); the
    // folded parent carries tombstoned=true with an empty payload.
    const bubble = messages.find((m) => Buffer.from(m.id).equals(Buffer.from(parent)))!;
    expect(bubble.tombstoned).toBe(true);
    expect(bubble.payload.length).toBe(0);
  });

  it('pin: latest (highest-id) non-tombstoned kind=6 wins', () => {
    const a = mkId();
    const b = mkId();
    const pin1 = mkId();
    const pin2 = mkId();
    const raw = [
      msg(a, WtKind.Text, ALICE, 'first'),
      msg(b, WtKind.Text, BOB, 'second'),
      msg(pin1, WtKind.Pin, ALICE, '', a),
      msg(pin2, WtKind.Pin, BOB, '', b),
    ];
    const { messages, pinnedId } = foldThread(raw);
    // Pins are folded out; only the two text bubbles remain.
    expect(messages.length).toBe(2);
    expect(messages.every((m) => m.kind !== WtKind.Pin)).toBe(true);
    // The later pin (pin2 -> b) wins.
    expect(Buffer.from(pinnedId).equals(Buffer.from(b))).toBe(true);
    // pinnedId is stamped on every returned bubble.
    expect(messages.every((m) => Buffer.from(m.pinnedId!).equals(Buffer.from(b)))).toBe(true);
  });

  it('pin: a zero-parent pin unpins (latest-wins), no tombstone needed', () => {
    const a = mkId();
    const raw = [
      msg(a, WtKind.Text, ALICE, 'msg'),
      msg(mkId(), WtKind.Pin, ALICE, '', a),
      // Later zero-parent pin clears the pin.
      msg(mkId(), WtKind.Pin, ALICE, '', WT_ID_ZERO),
    ];
    const { pinnedId } = foldThread(raw);
    expect(Buffer.from(pinnedId).equals(Buffer.from(WT_ID_ZERO))).toBe(true);
  });

  it('pin: tombstoning the live pin message clears the pin', () => {
    const a = mkId();
    const pinId = mkId();
    const raw = [
      msg(a, WtKind.Text, ALICE, 'msg'),
      msg(pinId, WtKind.Pin, ALICE, '', a),
      msg(mkId(), WtKind.Tombstone, ALICE, '', pinId),
    ];
    const { pinnedId } = foldThread(raw);
    expect(Buffer.from(pinnedId).equals(Buffer.from(WT_ID_ZERO))).toBe(true);
  });

  it('no pin posted yields WT_ID_ZERO', () => {
    const raw = [msg(mkId(), WtKind.Text, ALICE, 'msg')];
    const { pinnedId } = foldThread(raw);
    expect(Buffer.from(pinnedId).equals(Buffer.from(WT_ID_ZERO))).toBe(true);
  });

  it('reactions on a not-yet-arrived parent are dropped from bubbles but harmless', () => {
    // A reaction whose parent id is not present should not synthesize a bubble.
    const orphanParent = mkId();
    const raw = [msg(mkId(), WtKind.Reaction, ALICE, '\u{1F525}', orphanParent)];
    const { messages } = foldThread(raw);
    expect(messages.length).toBe(0);
  });
});
