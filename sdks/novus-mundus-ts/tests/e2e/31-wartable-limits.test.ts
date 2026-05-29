// War Table message-length discovery (TASK: empirical text-byte ceiling).
//
// For each scope (DM encrypted, Team encrypted, Encounter plaintext) this binary-
// searches the largest ASCII text payload N (bytes == chars) such that the post
// BOTH sends successfully through LiteSVM AND reads back byte-identical via the
// SDK decode + decrypt path. A build/serialize/send failure OR a garbled readback
// counts as "too big". The binding factor is the 1232-byte Solana transaction cap:
// once tx.serialize() exceeds it, web3.js throws before the SVM ever sees it.
//
// This test documents the empirical limits with console.logs and asserts the
// discovered hard maxima leave room above the adopted WT_MAX_TEXT_BYTES.

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';

import {
  EncounterRarity,
  createSpawnEncounterInstruction,
  deriveEncounterPda,
  deriveDmThreadPda,
  deriveTeamPda,
  WtKind,
  WtScope,
  WT_FLAG_ENCRYPTED,
  WT_NONCE_LEN,
  WT_ID_ZERO,
  WT_MAX_TEXT_BYTES,
  deriveThreadKey,
  encryptBody,
  decryptBody,
  encodeEnvelope,
  decodeEnvelope,
  encodeBody,
  decodeBody,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createPostTeamMessageInstruction,
  createPostDmMessageInstruction,
  createPostEncounterMessageInstruction,
  WarTableClient,
  LocalHmacKeyProvider,
} from '../../src/index';

import { type TestContext, beforeAllTests, CITIES } from '../fixtures/setup';
import { PlayerFactory, type TestPlayer } from '../fixtures/players';
import { sendTransaction } from '../utils/transactions';
import { fetchTeam, fetchCity } from '../utils/accounts';
import { FailedTransactionMetadata } from '../fixtures/svm';

setDefaultTimeout(300_000);

const K_MASTER = new Uint8Array(32).fill(7);
const GRID_PRECISION = 10000;

describe('War Table message-length limits', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let teamCounter = 0;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  function uniqueTeamId(): number {
    teamCounter += 1;
    return (Date.now() % 1_000_000) * 100 + teamCounter;
  }

  // Build an encrypted envelope (Team / DM) for a (thread, version) pair, exactly
  // like the SDK buildPostInstruction does for encrypted scopes.
  function buildEncryptedEnvelope(
    thread: PublicKey,
    sender: PublicKey,
    keyVersion: number,
    payload: string,
  ): Uint8Array {
    const bodyBytes = encodeBody({
      version: 0x01,
      kind: WtKind.Text,
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      parentId: WT_ID_ZERO,
      payload: new TextEncoder().encode(payload),
    });
    const key = deriveThreadKey(K_MASTER, thread, keyVersion);
    const nonce = new Uint8Array(WT_NONCE_LEN);
    crypto.getRandomValues(nonce);
    const aad = new Uint8Array(72);
    aad.set([0x77, 0x74, 0x31], 0);
    aad[3] = WT_FLAG_ENCRYPTED;
    aad.set(thread.toBytes(), 4);
    aad.set(sender.toBytes(), 36);
    new DataView(aad.buffer).setUint32(68, keyVersion >>> 0, true);
    const ciphertext = encryptBody(key, nonce, bodyBytes, aad);
    return encodeEnvelope({
      flags: WT_FLAG_ENCRYPTED,
      threadPda: thread,
      senderWallet: sender,
      keyVersion,
      bodyNonce: nonce,
      body: ciphertext,
    });
  }

  // Build a plaintext envelope (Encounter scope).
  function buildPlaintextEnvelope(thread: PublicKey, sender: PublicKey, payload: string): Uint8Array {
    const bodyBytes = encodeBody({
      version: 0x01,
      kind: WtKind.Text,
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      parentId: WT_ID_ZERO,
      payload: new TextEncoder().encode(payload),
    });
    return encodeEnvelope({
      flags: 0,
      threadPda: thread,
      senderWallet: sender,
      keyVersion: 0,
      bodyNonce: new Uint8Array(WT_NONCE_LEN),
      body: bodyBytes,
    });
  }

  // Recover wt1 envelopes from log lines.
  function wt1Blobs(logs: string[]): Uint8Array[] {
    const out: Uint8Array[] = [];
    const prefix = 'Program data: ';
    for (const line of logs) {
      if (!line.startsWith(prefix)) continue;
      const b64 = line.slice(prefix.length).trim();
      try {
        const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
        if (bytes.length >= 3 && bytes[0] === 0x77 && bytes[1] === 0x74 && bytes[2] === 0x31) {
          out.push(bytes);
        }
      } catch {
        // skip
      }
    }
    return out;
  }

  // The outcome of one attempt at a given payload length.
  interface AttemptResult {
    ok: boolean;
    // failure mode for max+1 reporting.
    mode?: string;
  }

  // Attempt one post at the given payload, where buildIx maps an ASCII text
  // payload to a fully-formed post instruction. Returns ok=true only when the tx
  // serializes, the SVM accepts it, and the readback payload is byte-identical.
  // ANY failure (serialize throw / send failure / truncated or garbled readback)
  // yields ok=false with a descriptive mode string. Advances the slot + expires
  // the blockhash afterward so repeated identical attempts get unique signatures.
  function attempt(
    signer: Keypair,
    thread: PublicKey,
    keyVersion: number,
    encrypted: boolean,
    payload: string,
    buildIx: (envelope: Uint8Array) => { ix: ReturnType<typeof createPostTeamMessageInstruction> },
  ): AttemptResult {
    const expectedBytes = new TextEncoder().encode(payload);

    let envelope: Uint8Array;
    try {
      envelope = encrypted
        ? buildEncryptedEnvelope(thread, signer.publicKey, keyVersion, payload)
        : buildPlaintextEnvelope(thread, signer.publicKey, payload);
    } catch (e) {
      return { ok: false, mode: `envelope encode threw: ${(e as Error).message}` };
    }

    const { ix } = buildIx(envelope);
    // Mirror the production postMessage send path, which prepends ComputeBudget
    // instructions: a unit price whenever the network reports a priority fee
    // (the congested-chain case), plus a unit limit. They add about 52 bytes to
    // the serialized tx, so measuring a bare single-instruction tx overstates the
    // real text budget. Include both so the discovered ceiling matches what users
    // actually send.
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }))
      .add(ix);
    tx.recentBlockhash = ctx.svm.latestBlockhash();
    tx.feePayer = signer.publicKey;

    // web3.js enforces the 1232-byte tx cap while serializing the message; this
    // happens inside tx.sign() (it serializes to produce the signed payload) and
    // again in tx.serialize(). A too-large tx throws here before the SVM is ever
    // touched. This is the binding factor: tx size, not CU or log truncation.
    try {
      tx.sign(signer);
      tx.serialize();
    } catch (e) {
      // Advance state so the next attempt is fresh.
      ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
      ctx.svm.expireBlockhash();
      return { ok: false, mode: `tx.serialize threw: ${(e as Error).message}` };
    }

    const result = ctx.svm.sendTransaction(tx);
    if (result instanceof FailedTransactionMetadata) {
      ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
      ctx.svm.expireBlockhash();
      return { ok: false, mode: `svm send failed: ${result.toString().slice(0, 160)}` };
    }

    const logs = result.logs();
    ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
    ctx.svm.expireBlockhash();

    const blobs = wt1Blobs(logs);
    if (blobs.length !== 1) {
      return { ok: false, mode: `expected 1 wt1 blob, got ${blobs.length} (log truncation?)` };
    }

    // Decode + decrypt exactly like the SDK read path and require a byte-identical
    // payload. A truncated/garbled readback counts as "too big".
    let readBytes: Uint8Array;
    try {
      const env = decodeEnvelope(blobs[0]!);
      const bodyBytes = env.encrypted
        ? decryptBody(deriveThreadKey(K_MASTER, thread, keyVersion), env.bodyNonce, env.body, env.aad)
        : env.body;
      readBytes = decodeBody(bodyBytes).payload;
    } catch (e) {
      return { ok: false, mode: `readback decode/decrypt threw: ${(e as Error).message}` };
    }

    if (readBytes.length !== expectedBytes.length) {
      return { ok: false, mode: `readback length ${readBytes.length} != sent ${expectedBytes.length}` };
    }
    for (let i = 0; i < expectedBytes.length; i++) {
      if (readBytes[i] !== expectedBytes[i]) {
        return { ok: false, mode: `readback byte mismatch at ${i}` };
      }
    }
    return { ok: true };
  }

  // Binary-search the largest N in [0, hi] for which `run(N)` succeeds. Returns
  // both the max N and the failure mode observed at max+1.
  function discoverMax(
    label: string,
    hi: number,
    run: (n: number) => AttemptResult,
  ): { max: number; failMode: string } {
    // Sanity: N=0 must succeed (empty payload is always representable).
    const zero = run(0);
    expect(zero.ok).toBe(true);

    let lo = 0;
    let high = hi;
    // Confirm hi fails so the search has a real boundary; if it somehow passes,
    // the answer is hi.
    const top = run(hi);
    if (top.ok) {
      console.log(`[${label}] N=${hi} (search ceiling) still OK; max >= ${hi}`);
      return { max: hi, failMode: 'none below ceiling' };
    }

    while (lo < high) {
      const mid = Math.ceil((lo + high) / 2);
      const r = run(mid);
      if (r.ok) lo = mid;
      else high = mid - 1;
    }
    const max = lo;
    // Re-run max+1 to capture a clean failure-mode string for the report.
    const overflow = run(max + 1);
    const failMode = overflow.mode ?? 'unknown';
    return { max, failMode };
  }

  async function createTeamWithMember(): Promise<{ leader: TestPlayer; teamPda: PublicKey; epoch: number }> {
    const leader = await factory.createPlayer({ initialize: true, createEstate: true });
    const member = await factory.createPlayer({ initialize: true, createEstate: true });
    const teamId = uniqueTeamId();
    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: `WTL${teamId}` }),
      ),
      [leader.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamInviteInstruction({
          inviter: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          inviterSlotIndex: 0,
          inviteePlayer: member.playerPda,
          leaderPlayer: leader.playerPda,
        }),
      ),
      [leader.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamAcceptInviteInstruction({
          owner: member.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          slotIndex: 1,
          inviteRefund: leader.publicKey,
          leaderPlayer: leader.playerPda,
        }),
      ),
      [member.keypair],
    );

    const team = await fetchTeam(ctx.svm, teamPda);
    return { leader, teamPda, epoch: team!.membershipEpoch };
  }

  async function spawnEncounter(cityId: number, gridLatOffset: number): Promise<PublicKey> {
    const city = CITIES[cityId]!;
    const gridLat = Math.round(city.lat * GRID_PRECISION);
    const gridLong = Math.round(city.lon * GRID_PRECISION) + gridLatOffset;
    const cityData = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
    const encounterIndex = cityData!.totalEncountersSpawned.toNumber();
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createSpawnEncounterInstruction(
          {
            gameEngine: ctx.gameEngine,
            payer: ctx.daoAuthority.publicKey,
            playerOwner: ctx.daoAuthority.publicKey,
            cityId,
            gridLat,
            gridLong,
            encounterIndex,
          },
          { encounterType: EncounterRarity.Common },
        ),
      ),
      [ctx.daoAuthority],
    );
    const [encounterPda] = deriveEncounterPda(ctx.gameEngine, cityId, encounterIndex);
    return encounterPda;
  }

  it('discovers the per-scope max text byte length and the binding factor', async () => {
    const SEARCH_HI = 2000;

    // DM (encrypted, 5 accounts -> worst case / smallest budget).
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [dmThread] = deriveDmThreadPda(alice.playerPda, bob.playerPda);
    const dm = discoverMax('DM', SEARCH_HI, (n) =>
      attempt(alice.keypair, dmThread, 1, true, 'a'.repeat(n), (envelope) => ({
        ix: createPostDmMessageInstruction(alice.playerPda, bob.playerPda, alice.publicKey, alice.playerPda, envelope),
      })),
    );

    // Team (encrypted, 3 accounts).
    const { leader, teamPda, epoch } = await createTeamWithMember();
    const team = discoverMax('Team', SEARCH_HI, (n) =>
      attempt(leader.keypair, teamPda, epoch, true, 'a'.repeat(n), (envelope) => ({
        ix: createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope),
      })),
    );

    // Encounter (plaintext, 3 accounts, no 16-byte AEAD tag).
    const encounterPda = await spawnEncounter(7, 3);
    const player = await factory.createPlayer({ initialize: true, createEstate: true });
    const enc = discoverMax('Encounter', SEARCH_HI, (n) =>
      attempt(player.keypair, encounterPda, 0, false, 'a'.repeat(n), (envelope) => ({
        ix: createPostEncounterMessageInstruction(encounterPda, player.publicKey, player.playerPda, envelope),
      })),
    );

    console.log('==== War Table empirical text-byte maxima (ASCII, 1 byte/char) ====');
    console.log(`DM        (encrypted, 5 accounts): max=${dm.max}  fail@${dm.max + 1}: ${dm.failMode}`);
    console.log(`Team      (encrypted, 3 accounts): max=${team.max}  fail@${team.max + 1}: ${team.failMode}`);
    console.log(`Encounter (plaintext, 3 accounts): max=${enc.max}  fail@${enc.max + 1}: ${enc.failMode}`);

    // The binding factor is tx size: max+1 fails at tx.serialize (Transaction too
    // large), NOT at log truncation or CU. Assert the failure mode says so.
    expect(dm.failMode).toContain('serialize');
    expect(team.failMode).toContain('serialize');
    expect(enc.failMode).toContain('serialize');

    // DM is the worst case (most accounts, encrypted): its budget must be the
    // smallest of the three.
    expect(dm.max).toBeLessThanOrEqual(team.max);
    expect(dm.max).toBeLessThan(enc.max);

    // The adopted global limit (smallest = DM, minus a margin, rounded to a clean
    // number) must sit under the DM hard max with at least a 16-byte safety
    // margin. Measured on the real send path (ComputeBudget ixs included), DM max
    // is 770; WT_MAX_TEXT_BYTES=700 leaves a 70-byte margin.
    expect(dm.max).toBeGreaterThanOrEqual(WT_MAX_TEXT_BYTES + 16);
    console.log(`WT_MAX_TEXT_BYTES = ${WT_MAX_TEXT_BYTES} (DM hard max ${dm.max}, margin ${dm.max - WT_MAX_TEXT_BYTES})`);
  });

  // A WarTableClient whose buildPostInstruction guard can run. The byte-ceiling
  // check is the very first thing buildPostInstruction does, before the key
  // provider or connection are touched, so an over-limit payload throws without
  // any I/O. The connection is therefore an unused stub; LocalHmacKeyProvider
  // derives from K_MASTER (only reached on under-limit paths).
  function makeGuardClient(): WarTableClient {
    const keyProvider = new LocalHmacKeyProvider(K_MASTER, async () => 1);
    // Stub connection: never reached for the over-limit throw paths under test.
    const connection = {} as never;
    return new WarTableClient({ connection, keyProvider });
  }

  it('sends a DM at exactly WT_MAX_TEXT_BYTES and reads it back byte-identical', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [dmThread] = deriveDmThreadPda(alice.playerPda, bob.playerPda);

    const payload = 'a'.repeat(WT_MAX_TEXT_BYTES);
    expect(new TextEncoder().encode(payload).length).toBe(WT_MAX_TEXT_BYTES);

    const r = attempt(alice.keypair, dmThread, 1, true, payload, (envelope) => ({
      ix: createPostDmMessageInstruction(alice.playerPda, bob.playerPda, alice.publicKey, alice.playerPda, envelope),
    }));
    // ok is true only when the tx serialized, the SVM accepted it, and the
    // readback decoded+decrypted byte-identical to the sent payload.
    expect(r.ok).toBe(true);
  });

  it('throws from the SDK at WT_MAX_TEXT_BYTES + 1 without sending', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [dmThread] = deriveDmThreadPda(alice.playerPda, bob.playerPda);
    const client = makeGuardClient();

    const overByOne = 'a'.repeat(WT_MAX_TEXT_BYTES + 1);
    expect(new TextEncoder().encode(overByOne).length).toBe(WT_MAX_TEXT_BYTES + 1);

    // buildPostInstruction rejects before any encode/send. The error names the
    // measured byte length and the WT_MAX_TEXT_BYTES limit.
    await expect(
      client.buildPostInstruction(
        { thread: dmThread, sender: alice.publicKey, senderPlayer: alice.playerPda, gateAccounts: [alice.playerPda, bob.playerPda] },
        WtScope.Dm,
        { kind: WtKind.Text, payload: overByOne },
      ),
    ).rejects.toThrow(/over the \d+-byte limit \(WT_MAX_TEXT_BYTES\)/);

    // postMessage routes through buildPostInstruction, so it rejects too, and the
    // stub signer/sender are never reached (the throw precedes any tx work).
    let signTxCalled = false;
    await expect(
      client.postMessage(
        dmThread,
        WtScope.Dm,
        [alice.playerPda, bob.playerPda],
        alice.publicKey,
        alice.playerPda,
        { kind: WtKind.Text, payload: overByOne },
        async (tx) => {
          signTxCalled = true;
          return tx;
        },
      ),
    ).rejects.toThrow(/over the \d+-byte limit \(WT_MAX_TEXT_BYTES\)/);
    expect(signTxCalled).toBe(false);
  });

  it('measures the limit in UTF-8 bytes, not characters (emoji rejected)', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [dmThread] = deriveDmThreadPda(alice.playerPda, bob.playerPda);
    const client = makeGuardClient();

    // A grinning-face emoji is 4 UTF-8 bytes. Repeat enough to land at
    // WT_MAX_TEXT_BYTES + 1 bytes; the character count is far smaller.
    const emoji = '\u{1F600}';
    const emojiBytes = new TextEncoder().encode(emoji).length;
    expect(emojiBytes).toBe(4);

    // ceil so the byte length lands at >= WT_MAX_TEXT_BYTES + 1.
    const count = Math.ceil((WT_MAX_TEXT_BYTES + 1) / emojiBytes);
    const payload = emoji.repeat(count);
    const byteLen = new TextEncoder().encode(payload).length;
    expect(byteLen).toBeGreaterThan(WT_MAX_TEXT_BYTES);
    // Character count (code points) is far below the byte limit, proving the
    // guard counts bytes, not characters.
    expect([...payload].length).toBeLessThan(WT_MAX_TEXT_BYTES);

    await expect(
      client.buildPostInstruction(
        { thread: dmThread, sender: alice.publicKey, senderPlayer: alice.playerPda, gateAccounts: [alice.playerPda, bob.playerPda] },
        WtScope.Dm,
        { kind: WtKind.Text, payload },
      ),
    ).rejects.toThrow(/over the \d+-byte limit \(WT_MAX_TEXT_BYTES\)/);
  });

  it('keeps a >= 16-byte safety margin under the DM hard max', async () => {
    // Self-contained re-discovery of the DM hard max so this assertion does not
    // depend on cross-it() state: binary-search the largest sendable+readable DM
    // payload and assert it clears WT_MAX_TEXT_BYTES by at least the margin.
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [dmThread] = deriveDmThreadPda(alice.playerPda, bob.playerPda);

    const dm = discoverMax('DM-margin', 2000, (n) =>
      attempt(alice.keypair, dmThread, 1, true, 'a'.repeat(n), (envelope) => ({
        ix: createPostDmMessageInstruction(alice.playerPda, bob.playerPda, alice.publicKey, alice.playerPda, envelope),
      })),
    );

    const MARGIN = 16;
    console.log(`DM hard max ${dm.max}; WT_MAX_TEXT_BYTES ${WT_MAX_TEXT_BYTES}; margin ${dm.max - WT_MAX_TEXT_BYTES}`);
    expect(dm.max).toBeGreaterThanOrEqual(WT_MAX_TEXT_BYTES + MARGIN);
  });
});
