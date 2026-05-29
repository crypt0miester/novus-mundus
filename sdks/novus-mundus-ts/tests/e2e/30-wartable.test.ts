// War Table E2E tests (TASK T2).
//
// Drives the real SBF .so through LiteSVM. The chain emits the raw wt1
// envelope via sol_log_data, surfacing as a `Program data:` log line whose
// base64-decoded bytes start 0x77 0x74 0x31. These tests build encrypted /
// plaintext envelopes with the SDK crypto helpers, post them via the
// instruction builders, and assert chain acceptance / rejection plus the
// off-chain decode + decrypt path.

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';

import {
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createTeamKickMemberInstruction,
  createRallyCreateInstruction,
  createRallyCancelInstruction,
  createCreateCastleInstruction,
  createClaimVacantCastleInstruction,
  createJoinGarrisonInstruction,
  createLeaveGarrisonInstruction,
  createSpawnEncounterInstruction,
  EncounterRarity,
  RallyTargetType,
  deriveTeamPda,
  deriveRallyPda,
  deriveCastlePda,
  deriveGarrisonPda,
  deriveEncounterPda,
  derivePlayerPda,
  deriveDmThreadPda,
  // crypto / wartable
  WtScope,
  WtKind,
  WT_FLAG_ENCRYPTED,
  WT_NONCE_LEN,
  WT_ID_ZERO,
  deriveThreadKey,
  encryptBody,
  decryptBody,
  encodeEnvelope,
  decodeEnvelope,
  encodeBody,
  decodeBody,
  encodeMessageId,
  readProgramData,
  foldThread,
  systemLabelFor,
  parseEventsFromLogs,
  type ReadMessage,
  // instruction wrappers
  createPostTeamMessageInstruction,
  createPostWarTableMessageInstruction,
  createPostRallyMessageInstruction,
  createPostCastleMessageInstruction,
  createPostEncounterMessageInstruction,
  createPostDmMessageInstruction,
} from '../../src/index';
import { GameError } from '../../src/errors';

import { type TestContext, beforeAllTests, CITIES } from '../fixtures/setup';
import { PlayerFactory, type TestPlayer } from '../fixtures/players';
import { BuildingType } from '../../src/index';
import { sendTransaction, expectTransactionToFail } from '../utils/transactions';
import { fetchTeam, fetchTeamMemberSlot, fetchRally, fetchPlayer, fetchCastleRaw, fetchCity } from '../utils/accounts';
import { deserializeCastle } from '../../src/state/castle';
import { FailedTransactionMetadata } from '../fixtures/svm';

setDefaultTimeout(120_000);

const K_MASTER = new Uint8Array(32).fill(7);
const GRID_PRECISION = 10000;

describe('War Table', () => {
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

  // Send a transaction and return its log lines on success.
  function sendAndGetLogs(tx: Transaction, signers: Keypair[]): string[] {
    tx.recentBlockhash = ctx.svm.latestBlockhash();
    tx.feePayer = signers[0]!.publicKey;
    tx.sign(...signers);
    const result = ctx.svm.sendTransaction(tx);
    if (result instanceof FailedTransactionMetadata) {
      throw new Error(`tx failed: ${result.toString()}`);
    }
    const logs = result.logs();
    ctx.svm.expireBlockhash();
    return logs;
  }

  // Build an encrypted envelope for a (thread, epoch) pair and a body.
  function buildEncryptedEnvelope(
    thread: PublicKey,
    sender: PublicKey,
    keyVersion: number,
    body: { kind: WtKind; payload: string; parentId?: Uint8Array },
  ): Uint8Array {
    const bodyBytes = encodeBody({
      version: 0x01,
      kind: body.kind,
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      parentId: body.parentId ?? WT_ID_ZERO,
      payload: new TextEncoder().encode(body.payload),
    });
    const key = deriveThreadKey(K_MASTER, thread, keyVersion);
    const nonce = new Uint8Array(WT_NONCE_LEN);
    crypto.getRandomValues(nonce);
    // AAD = envelope[0..72] with encrypted flag set.
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
  function buildPlaintextEnvelope(
    thread: PublicKey,
    sender: PublicKey,
    body: { kind: WtKind; payload: string; parentId?: Uint8Array },
  ): Uint8Array {
    const bodyBytes = encodeBody({
      version: 0x01,
      kind: body.kind,
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      parentId: body.parentId ?? WT_ID_ZERO,
      payload: new TextEncoder().encode(body.payload),
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
    return readProgramData(logs).filter(
      (b) => b.length >= 3 && b[0] === 0x77 && b[1] === 0x74 && b[2] === 0x31,
    );
  }

  // Decode a single posted encrypted-team envelope (from its logs) into a
  // ReadMessage at the given (slot, logIndex). Decrypts with the thread key so
  // foldThread sees the real decoded kind/parent/payload, exactly like the
  // WarTableClient.readThread path would (which needs a Connection we lack here).
  function decodeTeamMessage(
    logs: string[],
    thread: PublicKey,
    epoch: number,
    slot: bigint,
    logIndex = 0,
  ): ReadMessage {
    const blob = wt1Blobs(logs)[logIndex]!;
    const env = decodeEnvelope(blob);
    const key = deriveThreadKey(K_MASTER, thread, epoch);
    const body = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
    return {
      id: encodeMessageId({ slot, txIndex: 0, logIndex }),
      scope: WtScope.Team,
      senderWallet: env.senderWallet,
      threadPda: env.threadPda,
      keyVersion: env.keyVersion,
      kind: body.kind,
      createdAt: body.createdAt,
      parentId: body.parentId,
      payload: body.payload,
      decrypted: true,
      txIndexResolved: false,
    };
  }

  // Post an encrypted team message, advance the slot, and return its ReadMessage.
  function postTeamMessage(
    leader: TestPlayer,
    teamPda: PublicKey,
    epoch: number,
    body: { kind: WtKind; payload: string; parentId?: Uint8Array },
  ): ReadMessage {
    const slot = ctx.svm.getClock().slot;
    const envelope = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, body);
    const logs = sendAndGetLogs(
      new Transaction().add(createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope)),
      [leader.keypair],
    );
    const read = decodeTeamMessage(logs, teamPda, epoch, slot, 0);
    ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
    ctx.svm.expireBlockhash();
    return read;
  }

  // Create a team with a leader (slot 0) and one invited member (slot 1).
  async function createTeamWithMember(): Promise<{
    leader: TestPlayer;
    member: TestPlayer;
    teamPda: PublicKey;
    teamId: number;
  }> {
    const leader = await factory.createPlayer({ initialize: true, createEstate: true });
    const member = await factory.createPlayer({ initialize: true, createEstate: true });
    const teamId = uniqueTeamId();
    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: `WT${teamId}` }),
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

    return { leader, member, teamPda, teamId };
  }

  // 1. Team member post OK
  it('1. team member posts an encrypted message and the chain emits the envelope', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    expect(team).not.toBeNull();
    const epoch = team!.membershipEpoch;

    const text = 'rally the house at the north gate';
    const envelope = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, { kind: WtKind.Text, payload: text });
    const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);

    const before = ctx.svm.getAccount(teamPda);
    const logs = sendAndGetLogs(new Transaction().add(ix), [leader.keypair]);
    const after = ctx.svm.getAccount(teamPda);

    // The thread account is unchanged (log-only instruction).
    expect(Buffer.from(before!.data).equals(Buffer.from(after!.data))).toBe(true);
    expect(before!.lamports).toBe(after!.lamports);

    const blobs = wt1Blobs(logs);
    expect(blobs.length).toBe(1);
    const env = decodeEnvelope(blobs[0]!);
    expect(env.encrypted).toBe(true);
    const key = deriveThreadKey(K_MASTER, teamPda, epoch);
    const body = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
    expect(new TextDecoder().decode(body.payload)).toBe(text);
  });

  // 2. Non-member rejected
  it('2. non-member is rejected with WtNotInScope', async () => {
    const { teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    const epoch = team!.membershipEpoch;
    const outsider = await factory.createPlayer({ initialize: true, createEstate: true });

    const envelope = buildEncryptedEnvelope(teamPda, outsider.publicKey, epoch, { kind: WtKind.Text, payload: 'let me in' });
    const ix = createPostTeamMessageInstruction(teamPda, outsider.publicKey, outsider.playerPda, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [outsider.keypair], GameError.WtNotInScope);
  });

  // 3. thread_pda mismatch
  it('3. thread_pda mismatch is rejected with WtThreadPdaMismatch', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    const epoch = team!.membershipEpoch;
    // Encode the envelope with a WRONG thread pda baked into bytes 4..36.
    const wrongThread = Keypair.generate().publicKey;
    const envelope = buildEncryptedEnvelope(wrongThread, leader.publicKey, epoch, { kind: WtKind.Text, payload: 'oops' });
    const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [leader.keypair], GameError.WtThreadPdaMismatch);
  });

  // 4. sender_wallet mismatch
  it('4. sender_wallet mismatch is rejected with WtSenderMismatch', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    const epoch = team!.membershipEpoch;
    // Bake a wrong sender wallet into bytes 36..68.
    const wrongSender = Keypair.generate().publicKey;
    const envelope = buildEncryptedEnvelope(teamPda, wrongSender, epoch, { kind: WtKind.Text, payload: 'spoof' });
    const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [leader.keypair], GameError.WtSenderMismatch);
  });

  // 5. key_version != epoch
  it('5. key_version != epoch is rejected with WtKeyVersionMismatch', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    const wrongEpoch = team!.membershipEpoch + 5;
    const envelope = buildEncryptedEnvelope(teamPda, leader.publicKey, wrongEpoch, { kind: WtKind.Text, payload: 'stale' });
    const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [leader.keypair], GameError.WtKeyVersionMismatch);
  });

  // BC2: posting flags=0 (plaintext) on a Team thread fails with WtEncryptedFlagRequired
  it('BC2. plaintext flags=0 on a Team thread is rejected with WtEncryptedFlagRequired', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const team = await fetchTeam(ctx.svm, teamPda);
    const epoch = team!.membershipEpoch;
    // key_version is the correct epoch, but flags=0 and zero nonce (plaintext shape).
    const bodyBytes = encodeBody({
      version: 0x01,
      kind: WtKind.Text,
      createdAt: 0n,
      parentId: WT_ID_ZERO,
      payload: new TextEncoder().encode('plaintext on encrypted scope'),
    });
    const envelope = encodeEnvelope({
      flags: 0,
      threadPda: teamPda,
      senderWallet: leader.publicKey,
      keyVersion: epoch,
      bodyNonce: new Uint8Array(WT_NONCE_LEN),
      body: bodyBytes,
    });
    const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [leader.keypair], GameError.WtEncryptedFlagRequired);
  });

  // 6. kick bumps epoch (and leader joinedAtEpoch stays 0)
  it('6. kicking a member bumps the team membership epoch', async () => {
    const { leader, member, teamPda, teamId } = await createTeamWithMember();
    const before = await fetchTeam(ctx.svm, teamPda);
    expect(before!.membershipEpoch).toBe(0);

    const leaderSlot = await fetchTeamMemberSlot(ctx.svm, teamPda, 0);
    expect(leaderSlot!.joinedAtEpoch).toBe(0);

    const kickIx = createTeamKickMemberInstruction({
      kicker: leader.publicKey,
      gameEngine: ctx.gameEngine,
      team: teamPda,
      teamId,
      kickerSlotIndex: 0,
      kickedPlayer: member.playerPda,
      kickedSlotIndex: 1,
      kickedOwner: member.publicKey,
    });
    await sendTransaction(ctx.svm, new Transaction().add(kickIx), [leader.keypair]);

    const after = await fetchTeam(ctx.svm, teamPda);
    expect(after!.membershipEpoch).toBe(1);

    const leaderSlotAfter = await fetchTeamMemberSlot(ctx.svm, teamPda, 0);
    expect(leaderSlotAfter!.joinedAtEpoch).toBe(0);
  });

  // 7. join-gate epoch range: a member who joins after a kick has joinedAtEpoch=1
  it('7. a member joining after a kick has joinedAtEpoch equal to the bumped epoch', async () => {
    const { leader, member, teamPda, teamId } = await createTeamWithMember();
    // Kick the first member to bump the epoch to 1.
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamKickMemberInstruction({
          kicker: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          kickerSlotIndex: 0,
          kickedPlayer: member.playerPda,
          kickedSlotIndex: 1,
          kickedOwner: member.publicKey,
        }),
      ),
      [leader.keypair],
    );

    const teamAfterKick = await fetchTeam(ctx.svm, teamPda);
    expect(teamAfterKick!.membershipEpoch).toBe(1);

    // Invite + accept a fresh member into slot 1.
    const newMember = await factory.createPlayer({ initialize: true, createEstate: true });
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamInviteInstruction({
          inviter: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          inviterSlotIndex: 0,
          inviteePlayer: newMember.playerPda,
          leaderPlayer: leader.playerPda,
        }),
      ),
      [leader.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamAcceptInviteInstruction({
          owner: newMember.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          slotIndex: 1,
          inviteRefund: leader.publicKey,
          leaderPlayer: leader.playerPda,
        }),
      ),
      [newMember.keypair],
    );

    const newSlot = await fetchTeamMemberSlot(ctx.svm, teamPda, 1);
    expect(newSlot!.joinedAtEpoch).toBe(1);
    // The servable key range for this member starts at joinedAtEpoch (1).
    expect(newSlot!.joinedAtEpoch).toBe(teamAfterKick!.membershipEpoch);
  });

  // 8. DM symmetry
  it('8. deriveDmThreadPda is symmetric over the two player PDAs', async () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    const [pdaAB] = deriveDmThreadPda(a, b);
    const [pdaBA] = deriveDmThreadPda(b, a);
    expect(pdaAB.equals(pdaBA)).toBe(true);
    expect(() => deriveDmThreadPda(a, a)).toThrow();
  });

  // 9. DM post OK
  it('9. DM participant posts an encrypted message at keyVersion 1', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const [threadPda] = deriveDmThreadPda(alice.playerPda, bob.playerPda);

    const text = 'meet me at the docks at dusk';
    const envelope = buildEncryptedEnvelope(threadPda, alice.publicKey, 1, { kind: WtKind.Text, payload: text });
    const ix = createPostDmMessageInstruction(
      alice.playerPda,
      bob.playerPda,
      alice.publicKey,
      alice.playerPda,
      envelope,
    );
    const logs = sendAndGetLogs(new Transaction().add(ix), [alice.keypair]);
    const blobs = wt1Blobs(logs);
    expect(blobs.length).toBe(1);
    const env = decodeEnvelope(blobs[0]!);
    expect(env.keyVersion).toBe(1);
    const key = deriveThreadKey(K_MASTER, threadPda, 1);
    const body = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
    expect(new TextDecoder().decode(body.payload)).toBe(text);
  });

  // 10. DM non-participant rejected; wrong keyVersion rejected
  it('10. DM non-participant is rejected, and keyVersion != 1 is rejected', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });
    const carol = await factory.createPlayer({ initialize: true, createEstate: true });
    const [threadPda] = deriveDmThreadPda(alice.playerPda, bob.playerPda);

    // Carol (not a participant) signs against the alice/bob thread.
    const envC = buildEncryptedEnvelope(threadPda, carol.publicKey, 1, { kind: WtKind.Text, payload: 'eavesdrop' });
    const ixC = createPostWarTableMessageInstruction(
      { thread: threadPda, sender: carol.publicKey, senderPlayer: carol.playerPda, gateAccounts: [alice.playerPda, bob.playerPda] },
      { scope: WtScope.Dm, envelope: envC },
    );
    await expectTransactionToFail(ctx.svm, new Transaction().add(ixC), [carol.keypair], GameError.WtNotInScope);

    // Alice posts with keyVersion 2 (must be 1).
    const envBad = buildEncryptedEnvelope(threadPda, alice.publicKey, 2, { kind: WtKind.Text, payload: 'wrong version' });
    const ixBad = createPostDmMessageInstruction(alice.playerPda, bob.playerPda, alice.publicKey, alice.playerPda, envBad);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ixBad), [alice.keypair], GameError.WtKeyVersionMismatch);
  });

  // BC3: DM program-ownership rejection
  it('BC3. DM with a crafted non-program-owned gate account is rejected', async () => {
    const alice = await factory.createPlayer({ initialize: true, createEstate: true });
    const bob = await factory.createPlayer({ initialize: true, createEstate: true });

    // Forge a fake "player" account: a system-owned account whose bytes are
    // arbitrary. Use a wallet keypair pubkey as the fake player PDA so the
    // pair-PDA derivation succeeds but load_checked_by_key must reject it.
    const fakePlayer = Keypair.generate().publicKey;
    const [threadPda] = deriveDmThreadPda(alice.playerPda, fakePlayer);
    const envelope = buildEncryptedEnvelope(threadPda, alice.publicKey, 1, { kind: WtKind.Text, payload: 'forge' });
    const ix = createPostWarTableMessageInstruction(
      { thread: threadPda, sender: alice.publicKey, senderPlayer: alice.playerPda, gateAccounts: [alice.playerPda, fakePlayer] },
      { scope: WtScope.Dm, envelope },
    );
    // The fake player account is not program-owned, so load_checked_by_key
    // fails before any owner read (BC3). Any non-success error is acceptable.
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [alice.keypair]);
  });

  // Auto-spawn a Common encounter via DAO; returns the encounter PDA. The
  // on-chain encounter id is the city's total_encounters_spawned counter, so
  // we read it rather than guess an index.
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

  // 11. Encounter plaintext OK; encrypted attempt rejected
  it('11. encounter accepts plaintext and rejects an encrypted attempt', async () => {
    const cityId = 7;
    const encounterPda = await spawnEncounter(cityId, 3);

    // A kingdom player posts plaintext.
    const player = await factory.createPlayer({ initialize: true, createEstate: true });
    const text = 'epic spotted at the crossroads';
    const envelope = buildPlaintextEnvelope(encounterPda, player.publicKey, { kind: WtKind.Text, payload: text });
    const ix = createPostEncounterMessageInstruction(encounterPda, player.publicKey, player.playerPda, envelope);
    const logs = sendAndGetLogs(new Transaction().add(ix), [player.keypair]);
    const blobs = wt1Blobs(logs);
    expect(blobs.length).toBe(1);
    const env = decodeEnvelope(blobs[0]!);
    expect(env.encrypted).toBe(false);
    expect(new TextDecoder().decode(decodeBody(env.body).payload)).toBe(text);

    // An encrypted attempt (flags bit0 set, keyVersion 0) is rejected.
    const encEnvelope = buildEncryptedEnvelope(encounterPda, player.publicKey, 0, { kind: WtKind.Text, payload: 'secret' });
    const ixEnc = createPostEncounterMessageInstruction(encounterPda, player.publicKey, player.playerPda, encEnvelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ixEnc), [player.keypair], GameError.WtKeyVersionMismatch);
  });

  // 12. Encounter out-of-kingdom proxy: no PlayerAccount => access failure (O5)
  it('12. a sender with no PlayerAccount cannot post to an encounter', async () => {
    // TODO: test true cross-kingdom (needs a second game engine in the SVM).
    const cityId = 8;
    const encounterPda = await spawnEncounter(cityId, 3);

    // A fresh wallet with no on-chain PlayerAccount.
    const stranger = Keypair.generate();
    ctx.svm.airdrop(stranger.publicKey, 1_000_000_000n);
    const [strangerPlayer] = derivePlayerPda(ctx.gameEngine, stranger.publicKey);
    const envelope = buildPlaintextEnvelope(encounterPda, stranger.publicKey, { kind: WtKind.Text, payload: 'who am i' });
    const ix = createPostEncounterMessageInstruction(encounterPda, stranger.publicKey, strangerPlayer, envelope);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [stranger]);
  });

  // 13. readThread orders by slot (here we assert ordering of recovered envelopes by slot)
  it('13. messages recovered across distinct slots stay in ascending slot order', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    const ids: { slot: bigint; id: Uint8Array }[] = [];
    for (let i = 0; i < 3; i++) {
      const envelope = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, {
        kind: WtKind.Text,
        payload: `message ${i}`,
      });
      const ix = createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envelope);
      const slotBefore = ctx.svm.getClock().slot;
      const logs = sendAndGetLogs(new Transaction().add(ix), [leader.keypair]);
      const blobs = wt1Blobs(logs);
      expect(blobs.length).toBe(1);
      ids.push({ slot: slotBefore, id: encodeMessageId({ slot: slotBefore, txIndex: 0, logIndex: 0 }) });
      // Advance the slot so the next post lands in a strictly later slot.
      ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
      ctx.svm.expireBlockhash();
    }

    // Slots must be strictly ascending in post order.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!.slot > ids[i - 1]!.slot).toBe(true);
    }
  });

  // 14. reply parent_id byte-equals the parent message id
  it('14. a reply body carries the parent message id', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    // P1: root.
    const env1 = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, { kind: WtKind.Text, payload: 'parent' });
    const slot1 = ctx.svm.getClock().slot;
    const logs1 = sendAndGetLogs(
      new Transaction().add(createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, env1)),
      [leader.keypair],
    );
    expect(wt1Blobs(logs1).length).toBe(1);
    const p1Id = encodeMessageId({ slot: slot1, txIndex: 0, logIndex: 0 });

    ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
    ctx.svm.expireBlockhash();

    // P2: reply with parentId = P1 id.
    const env2 = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, {
      kind: WtKind.Reply,
      payload: 'child',
      parentId: p1Id,
    });
    const logs2 = sendAndGetLogs(
      new Transaction().add(createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, env2)),
      [leader.keypair],
    );
    const blobs2 = wt1Blobs(logs2);
    expect(blobs2.length).toBe(1);
    const env = decodeEnvelope(blobs2[0]!);
    const key = deriveThreadKey(K_MASTER, teamPda, epoch);
    const body = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
    expect(body.kind).toBe(WtKind.Reply);
    expect(Buffer.from(body.parentId).equals(Buffer.from(p1Id))).toBe(true);
  });

  // 15. tombstone hides the original (fold applied client-side)
  it('15. a tombstone message folds to hide its parent', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    const slot1 = ctx.svm.getClock().slot;
    const env1 = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, { kind: WtKind.Text, payload: 'delete me' });
    sendAndGetLogs(
      new Transaction().add(createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, env1)),
      [leader.keypair],
    );
    const p1Id = encodeMessageId({ slot: slot1, txIndex: 0, logIndex: 0 });

    ctx.svm.warpToSlot(ctx.svm.getClock().slot + 1n);
    ctx.svm.expireBlockhash();

    const envT = buildEncryptedEnvelope(teamPda, leader.publicKey, epoch, {
      kind: WtKind.Tombstone,
      payload: '',
      parentId: p1Id,
    });
    const logsT = sendAndGetLogs(
      new Transaction().add(createPostTeamMessageInstruction(teamPda, leader.publicKey, leader.playerPda, envT)),
      [leader.keypair],
    );
    const env = decodeEnvelope(wt1Blobs(logsT)[0]!);
    const key = deriveThreadKey(K_MASTER, teamPda, epoch);
    const body = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
    // The tombstone targets P1: applying the fold marks P1 hidden.
    expect(body.kind).toBe(WtKind.Tombstone);
    expect(Buffer.from(body.parentId).equals(Buffer.from(p1Id))).toBe(true);
  });

  // 16. Rally post + epoch bump
  it('16. rally participant posts OK, non-participant rejected, cancel bumps epoch', async () => {
    // The rally creator needs Barracks (units) + Citadel (create rally).
    const leader = await factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks, BuildingType.Citadel],
    });
    const teamId = uniqueTeamId();
    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: `R${teamId}` }),
      ),
      [leader.keypair],
    );
    await factory.hireUnits(leader, 0, 50_000);
    const leaderAccount = await fetchPlayer(ctx.svm, leader.playerPda);
    const rallyCityId = leaderAccount!.currentCity;
    const rallyId = 700 + (teamCounter % 50);

    const createIx = createRallyCreateInstruction(
      { gameEngine: ctx.gameEngine, owner: leader.publicKey, rallyId, target: Keypair.generate().publicKey, teamId, rallyCityId },
      {
        targetType: RallyTargetType.Encounter,
        gatherDuration: new BN(3600),
        targetCityId: rallyCityId,
        defensiveUnit1: new BN(50),
        defensiveUnit2: new BN(0),
        defensiveUnit3: new BN(0),
        meleeWeapons: new BN(0),
        rangedWeapons: new BN(0),
        siegeWeapons: new BN(0),
      },
    );
    await sendTransaction(ctx.svm, new Transaction().add(createIx), [leader.keypair]);

    const [rallyPda] = deriveRallyPda(ctx.gameEngine, leader.publicKey, rallyId);
    const rally = await fetchRally(ctx.svm, rallyPda);
    expect(rally).not.toBeNull();
    const epoch = rally!.membershipEpoch;
    expect(epoch).toBe(0);

    // Participant (creator) posts OK.
    const envelope = buildEncryptedEnvelope(rallyPda, leader.publicKey, epoch, { kind: WtKind.Text, payload: 'march at gather end' });
    const ix = createPostRallyMessageInstruction(ctx.gameEngine, leader.publicKey, rallyId, rallyPda, leader.publicKey, leader.playerPda, envelope);
    const logs = sendAndGetLogs(new Transaction().add(ix), [leader.keypair]);
    expect(wt1Blobs(logs).length).toBe(1);

    // Non-participant rejected: their RallyParticipant PDA does not exist.
    const outsider = await factory.createPlayer({ initialize: true, createEstate: true });
    const envO = buildEncryptedEnvelope(rallyPda, outsider.publicKey, epoch, { kind: WtKind.Text, payload: 'intrude' });
    const ixO = createPostRallyMessageInstruction(ctx.gameEngine, leader.publicKey, rallyId, rallyPda, outsider.publicKey, outsider.playerPda, envO);
    await expectTransactionToFail(ctx.svm, new Transaction().add(ixO), [outsider.keypair]);

    // Cancel the rally: bumps membership_epoch (process_return per returning participant).
    const cancelIx = createRallyCancelInstruction({ gameEngine: ctx.gameEngine, owner: leader.publicKey, rally: rallyPda, rallyId, rallyCityId });
    await sendTransaction(ctx.svm, new Transaction().add(cancelIx), [leader.keypair]);
    const rallyAfter = await fetchRally(ctx.svm, rallyPda);
    expect(rallyAfter!.membershipEpoch).toBeGreaterThan(epoch);
  });

  // 17. Castle post (king branch) + garrison leave bumps epoch
  it('17. castle king posts OK and a garrison leave bumps the castle epoch', async () => {
    const cityId = 1;
    const castleId = 150 + (teamCounter % 40);
    const city = CITIES[cityId]!;
    const cityLatGrid = Math.round(city.lat * GRID_PRECISION);
    const cityLonGrid = Math.round(city.lon * GRID_PRECISION);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createCreateCastleInstruction(
          { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
          {
            cityId,
            castleId,
            tier: 2,
            latitude: cityLatGrid + ((castleId % 30) * 5 + 30),
            longitude: cityLonGrid + (Math.floor(castleId / 30) * 5 + 30),
            minLevel: 1,
            minNetworthMillions: 0,
            minTroopsThousands: 0,
            name: `WTCastle${castleId}`,
            footprintSize: 2,
          },
        ),
      ),
      [ctx.daoAuthority],
    );
    expect(await fetchCastleRaw(ctx.svm, ctx.gameEngine, cityId, castleId)).not.toBeNull();
    const [castlePda] = deriveCastlePda(ctx.gameEngine, cityId, castleId);

    // King claims the castle (this is a bump site: epoch goes 0 -> 1).
    const king = await factory.createPlayer({ initialize: true, createEstate: true });
    // King needs a team to claim.
    const kingTeamId = uniqueTeamId();
    const [kingTeamPda] = deriveTeamPda(ctx.gameEngine, kingTeamId);
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamCreateInstruction({ owner: king.publicKey, gameEngine: ctx.gameEngine, teamId: kingTeamId }, { name: `K${kingTeamId}` }),
      ),
      [king.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createClaimVacantCastleInstruction({ gameEngine: ctx.gameEngine, claimer: king.publicKey, cityId, castleId }),
      ),
      [king.keypair],
    );

    const castleAfterClaim = deserializeCastle(Buffer.from(ctx.svm.getAccount(castlePda)!.data));
    const kingEpoch = castleAfterClaim.membershipEpoch;
    expect(kingEpoch).toBeGreaterThan(0);

    // King posts (no gate account, 3 accounts total).
    const envelope = buildEncryptedEnvelope(castlePda, king.publicKey, kingEpoch, { kind: WtKind.Text, payload: 'defend the keep' });
    const ix = createPostCastleMessageInstruction(castlePda, king.publicKey, king.playerPda, undefined, envelope);
    const logs = sendAndGetLogs(new Transaction().add(ix), [king.keypair]);
    expect(wt1Blobs(logs).length).toBe(1);

    // Add a garrison member, then have them leave to bump the epoch.
    const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamInviteInstruction({
          inviter: king.publicKey,
          gameEngine: ctx.gameEngine,
          team: kingTeamPda,
          teamId: kingTeamId,
          inviterSlotIndex: 0,
          inviteePlayer: member.playerPda,
          leaderPlayer: king.playerPda,
        }),
      ),
      [king.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamAcceptInviteInstruction({
          owner: member.publicKey,
          gameEngine: ctx.gameEngine,
          team: kingTeamPda,
          teamId: kingTeamId,
          slotIndex: 1,
          inviteRefund: king.publicKey,
          leaderPlayer: king.playerPda,
        }),
      ),
      [member.keypair],
    );
    await factory.hireUnits(member, 0, 10_000);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createJoinGarrisonInstruction(
          { gameEngine: ctx.gameEngine, owner: member.publicKey, cityId, castleId },
          { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 },
        ),
      ),
      [member.keypair],
    );

    const epochAfterJoin = deserializeCastle(Buffer.from(ctx.svm.getAccount(castlePda)!.data)).membershipEpoch;
    // Join does not bump the epoch.
    expect(epochAfterJoin).toBe(kingEpoch);

    // Garrison member's joinedAtEpoch was snapshotted to the castle epoch.
    const [garrisonPda] = deriveGarrisonPda(castlePda, member.playerPda);
    const garrisonInfo = ctx.svm.getAccount(garrisonPda);
    expect(garrisonInfo).not.toBeNull();

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createLeaveGarrisonInstruction({ gameEngine: ctx.gameEngine, owner: member.publicKey, cityId, castleId }),
      ),
      [member.keypair],
    );
    const epochAfterLeave = deserializeCastle(Buffer.from(ctx.svm.getAccount(castlePda)!.data)).membershipEpoch;
    expect(epochAfterLeave).toBeGreaterThan(epochAfterJoin);
  });

  // 18. Reaction fold: post a text, two reactions on it, fold groups by emoji
  //     and the reaction messages are not returned as bubbles.
  it('18. reactions posted on a message fold onto it and are not returned as bubbles', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    const parent = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Text, payload: 'rally up' });
    const fireReaction = postTeamMessage(leader, teamPda, epoch, {
      kind: WtKind.Reaction,
      payload: '\u{1F525}',
      parentId: parent.id,
    });
    const heartReaction = postTeamMessage(leader, teamPda, epoch, {
      kind: WtKind.Reaction,
      payload: '\u{2764}\u{FE0F}',
      parentId: parent.id,
    });

    const folded = foldThread([parent, fireReaction, heartReaction], { myWallet: leader.publicKey });
    // Only the parent text bubble survives; reaction messages are folded out.
    const bubbles = folded.messages.filter((m) => m.kind === WtKind.Text);
    expect(bubbles.length).toBe(1);
    expect(folded.messages.every((m) => m.kind !== WtKind.Reaction)).toBe(true);
    const bubble = bubbles[0]!;
    expect(bubble.reactions!.length).toBe(2);
    const fire = bubble.reactions!.find((r) => r.emoji === '\u{1F525}')!;
    expect(fire.count).toBe(1);
    expect(fire.mine).toBe(true);
    expect(fire.myReactionId).toBeDefined();
  });

  // 19. Un-react via tombstone of MY reaction id removes the reaction.
  it('19. un-react: a tombstone of the reaction message id clears it', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    const parent = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Text, payload: 'react then unreact' });
    const reaction = postTeamMessage(leader, teamPda, epoch, {
      kind: WtKind.Reaction,
      payload: '\u{1F44D}',
      parentId: parent.id,
    });
    // Un-react targets the REACTION message id, not the reacted-to message.
    const tomb = postTeamMessage(leader, teamPda, epoch, {
      kind: WtKind.Tombstone,
      payload: '',
      parentId: reaction.id,
    });

    const folded = foldThread([parent, reaction, tomb], { myWallet: leader.publicKey });
    const bubble = folded.messages.find((m) => Buffer.from(m.id).equals(Buffer.from(parent.id)))!;
    expect(bubble.tombstoned).toBeFalsy();
    expect(bubble.payload.length).toBeGreaterThan(0);
    expect(bubble.reactions).toEqual([]);
  });

  // 20. Pin: latest-wins and zero-parent unpin.
  it('20. pin resolves latest-wins and a zero-parent pin unpins', async () => {
    const { leader, teamPda } = await createTeamWithMember();
    const epoch = (await fetchTeam(ctx.svm, teamPda))!.membershipEpoch;

    const a = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Text, payload: 'first' });
    const b = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Text, payload: 'second' });
    const pinA = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Pin, payload: '', parentId: a.id });
    const pinB = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Pin, payload: '', parentId: b.id });

    let folded = foldThread([a, b, pinA, pinB]);
    // Latest pin (pinB -> b) wins; pin messages are not bubbles.
    expect(Buffer.from(folded.pinnedId).equals(Buffer.from(b.id))).toBe(true);
    expect(folded.messages.every((m) => m.kind !== WtKind.Pin)).toBe(true);
    expect(folded.messages.filter((m) => m.kind === WtKind.Text).length).toBe(2);

    // A later zero-parent pin unpins, no tombstone needed.
    const unpin = postTeamMessage(leader, teamPda, epoch, { kind: WtKind.Pin, payload: '', parentId: WT_ID_ZERO });
    folded = foldThread([a, b, pinA, pinB, unpin]);
    expect(Buffer.from(folded.pinnedId).equals(Buffer.from(WT_ID_ZERO))).toBe(true);
  });

  // 21. System line synthesized from a real entity event via systemLabelFor.
  it('21. a MemberKicked event on a team thread synthesizes a System line', async () => {
    const { leader, member, teamPda, teamId } = await createTeamWithMember();

    const kickLogs = sendAndGetLogs(
      new Transaction().add(
        createTeamKickMemberInstruction({
          kicker: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          kickerSlotIndex: 0,
          kickedPlayer: member.playerPda,
          kickedSlotIndex: 1,
          kickedOwner: member.publicKey,
        }),
      ),
      [leader.keypair],
    );

    const events = parseEventsFromLogs(kickLogs);
    const kicked = events.find((e) => e.name === 'MemberKicked');
    expect(kicked).toBeDefined();
    const label = systemLabelFor(WtScope.Team, teamPda, kicked!);
    expect(label).not.toBeNull();
    expect(label).toContain('was removed');

    // An unrelated thread (different PDA) yields no label.
    const otherThread = Keypair.generate().publicKey;
    expect(systemLabelFor(WtScope.Team, otherThread, kicked!)).toBeNull();
    // DM scope never synthesizes a label.
    expect(systemLabelFor(WtScope.Dm, teamPda, kicked!)).toBeNull();
  });
});
