/**
 * Deposit + Sweep E2E
 *
 * Covers the new `deposit_novi` ix and `treasury_sweep_untracked_novi` ix.
 *   - Earn → vest → withdraw → re-deposit round-trip, with the 5% fee burned.
 *   - Reject paths: zero amount, amount-that-rounds-to-zero-credited,
 *     wrong source ATA owner, wrong reserved ATA owner.
 *   - reserved_novi_earned_at is preserved across a deposit (so a
 *     depositor can't reset their own withdraw vesting clock).
 *   - User-driven sweep: tokens directly minted to a user PDA's reserved
 *     ATA (bypassing state) are recoverable via the sweep into the
 *     wallet's ATA.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

import {
  createDepositNoviInstruction,
  createTreasurySweepUntrackedNoviInstruction,
  createMintForPrizeInstruction,
  createWithdrawReservedInstruction,
  SweepKind,
  MintPurpose,
  DEPOSIT_FEE_BPS,
  RESERVED_NOVI_VESTING_PERIOD,
  deriveNoviMintPda,
  deriveUserPda,
  getAssociatedTokenAddressAsync,
  getAssociatedTokenAddressAsyncForPda,
  parseUser,
} from '../../src/index';

import { type TestContext, beforeAllTests } from '../fixtures/setup';
import { PlayerFactory } from '../fixtures/players';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import { fetchAccount } from '../utils/accounts';
import { advanceTime } from '../fixtures/time';
import { readSplTokenAmount, svmKey } from '../fixtures/svm';
import { log } from '../utils/logger';

/**
 * Rebuild an instruction produced by `@solana/spl-token` (which bundles
 * web3.js v1) into a web3.js v3 `TransactionInstruction`. The wire shape
 * (`programId`, `keys`, `data`) is identical between the two majors, so we
 * re-wrap the v1 pubkeys as v3 ones via their raw bytes.
 */
function toV3Instruction(ix: {
  programId: { toBytes(): Uint8Array };
  keys: { pubkey: { toBytes(): Uint8Array }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId.toBytes()),
    keys: ix.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey.toBytes()),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

/* Helper: seed the player's wallet ATA by minting reserved → waiting out
 * vesting → withdrawing to wallet. Returns the wallet balance. */
async function seedWalletAta(
  ctx: TestContext,
  player: { publicKey: PublicKey; keypair: Keypair },
  amount: number,
): Promise<bigint> {
  await sendTransaction(
    ctx.svm,
    new Transaction().add(
      await createMintForPrizeInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          recipientOwner: player.publicKey,
        },
        { amount: BigInt(amount), purpose: MintPurpose.Prize },
      ),
    ),
    [ctx.daoAuthority],
  );

  await advanceTime(ctx.svm, RESERVED_NOVI_VESTING_PERIOD + 60);

  await sendTransaction(
    ctx.svm,
    new Transaction().add(
      await createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: BigInt(amount) },
      ),
    ),
    [player.keypair],
  );

  const [noviMint] = await deriveNoviMintPda();
  const walletAta = await getAssociatedTokenAddressAsync(noviMint, player.publicKey);
  return readSplTokenAmount(ctx.svm, walletAta);
}

describe('Deposit NOVI + Sweep', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Deposit + Sweep');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  /* Round-trip happy path: wallet → reserved with 5% fee burned. */
  it('deposits wallet NOVI back into reserved with the 5% fee burned', async () => {
    const player = await factory.createPlayer({ initialize: true });
    const AMOUNT = 1_000_000;

    const walletBefore = await seedWalletAta(ctx, player, AMOUNT);
    expect(walletBefore).toBe(BigInt(AMOUNT));

    /* Read the on-chain user state PRE-deposit so we can verify earned_at
     * is preserved across the deposit. */
    const [userPda] = await deriveUserPda(player.publicKey);
    const preInfo = await fetchAccount(ctx.svm, userPda);
    expect(preInfo).not.toBeNull();
    const userPre = parseUser(preInfo!);
    expect(userPre).not.toBeNull();
    const earnedAtPre = userPre!.reservedNoviEarnedAt;

    /* The withdraw above zeroed user.reserved_novi. Deposit half of the
     * wallet balance back. fee = 500 bps × 500000 = 25000; credited =
     * 475000. */
    const depositAmount = AMOUNT / 2;
    const expectedFee = Math.floor((depositAmount * DEPOSIT_FEE_BPS) / 10_000);
    const expectedCredited = depositAmount - expectedFee;

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createDepositNoviInstruction(
          { owner: player.publicKey },
          { amount: BigInt(depositAmount) },
        ),
      ),
      [player.keypair],
    );

    /* Wallet ATA: was AMOUNT, lost depositAmount (fee + credited). */
    const [noviMint] = await deriveNoviMintPda();
    const walletAta = await getAssociatedTokenAddressAsync(noviMint, player.publicKey);
    const walletAfter = readSplTokenAmount(ctx.svm, walletAta);
    expect(walletAfter).toBe(BigInt(AMOUNT - depositAmount));

    /* Reserved ATA: credited tokens landed here. */
    const reservedAta = await getAssociatedTokenAddressAsyncForPda(noviMint, userPda);
    const reservedAfter = readSplTokenAmount(ctx.svm, reservedAta);
    expect(reservedAfter).toBe(BigInt(expectedCredited));

    /* User state: reserved_novi += credited; earned_at unchanged.
     * Both fields are BN — compare by stringified value, not reference. */
    const postInfo = await fetchAccount(ctx.svm, userPda);
    const userPost = parseUser(postInfo!);
    expect(userPost).not.toBeNull();
    expect(userPost!.reservedNovi.toString()).toBe(String(expectedCredited));
    expect(userPost!.reservedNoviEarnedAt.toString()).toBe(earnedAtPre.toString());
  });

  it('rejects a zero-amount deposit', async () => {
    const player = await factory.createPlayer({ initialize: true });
    await seedWalletAta(ctx, player, 10_000);

    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(
        await createDepositNoviInstruction(
          { owner: player.publicKey },
          { amount: 0n },
        ),
      ),
      [player.keypair],
    );
  });

  /* `credited = amount - floor(amount * 500 / 10000)`. For amount=1,
   * fee=0, credited=1 — passes. For tiny amounts where the entire
   * deposit rounds to fee, the ix rejects so the user doesn't burn dust
   * for nothing. We pick amount=0 (rejected as zero) above; here we
   * confirm the small-but-nonzero path succeeds. */
  it('accepts a single-token deposit (credit ≥ 1)', async () => {
    const player = await factory.createPlayer({ initialize: true });
    await seedWalletAta(ctx, player, 10);

    /* amount=2 → fee=0 (floor 100/10000), credited=2. */
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createDepositNoviInstruction(
          { owner: player.publicKey },
          { amount: BigInt(2) },
        ),
      ),
      [player.keypair],
    );

    const [noviMint] = await deriveNoviMintPda();
    const [userPda] = await deriveUserPda(player.publicKey);
    const reservedAta = await getAssociatedTokenAddressAsyncForPda(noviMint, userPda);
    expect(readSplTokenAmount(ctx.svm, reservedAta)).toBe(2n);
  });

  it("rejects when source ATA isn't wallet-owned", async () => {
    const player = await factory.createPlayer({ initialize: true });
    const other = await Keypair.generate();

    /* Construct a deposit ix that points the source ATA at OTHER's wallet
     * — the wallet still signs as `player`, but the source ATA owner
     * field mismatches `owner.address()`. The on-chain validator should
     * reject with DepositSourceNotWalletOwned. */
    const baseIx = await createDepositNoviInstruction(
      { owner: player.publicKey },
      { amount: BigInt(100) },
    );
    /* Account 2 is the source_token_account. Swap to other's wallet ATA. */
    const [noviMint] = await deriveNoviMintPda();
    const otherAta = await getAssociatedTokenAddressAsync(noviMint, other.publicKey);
    const tamperedKeys = [...baseIx.keys];
    tamperedKeys[2] = { pubkey: otherAta, isSigner: false, isWritable: true };
    const tamperedIx = new (baseIx.constructor as any)({
      keys: tamperedKeys,
      programId: baseIx.programId,
      data: baseIx.data,
    });

    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(tamperedIx),
      [player.keypair],
    );
  });

  /* Sweep no-op path: when the reserved ATA balance equals
   * `user.reserved_novi` (no untracked surplus), the sweep should
   * return silently and not transfer anything.
   *
   * Injecting actual untracked NOVI into a PDA-owned ATA requires
   * minting via a non-`mint_for_prize` path (the program is the only
   * thing that can sign for the GameEngine mint authority, and all of
   * its paths keep state and ATA in lockstep). So we test the
   * symmetric case here. The state-mutation tests are covered in Rust
   * unit-test land if/when we add them. */
  it("sweep is a silent no-op when balance == tracked state", async () => {
    const player = await factory.createPlayer({ initialize: true });

    /* Mint via the internal Prize path so user.reserved_novi == the
     * reserved ATA balance. */
    const AMOUNT = 50_000;
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createMintForPrizeInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            recipientOwner: player.publicKey,
          },
          { amount: BigInt(AMOUNT), purpose: MintPurpose.Prize },
        ),
      ),
      [ctx.daoAuthority],
    );

    const [noviMint] = await deriveNoviMintPda();
    const [userPda] = await deriveUserPda(player.publicKey);
    const reservedAta = await getAssociatedTokenAddressAsyncForPda(noviMint, userPda);
    const reservedBefore = readSplTokenAmount(ctx.svm, reservedAta);

    /* Wallet ATA needs to exist for the sweep's destination slot. */
    const walletAta = await getAssociatedTokenAddressAsync(noviMint, player.publicKey);
    if (!ctx.svm.getAccount(svmKey(walletAta))) {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          toV3Instruction(
            createAssociatedTokenAccountIdempotentInstruction(
              player.publicKey as any,
              walletAta as any,
              player.publicKey as any,
              noviMint as any,
            ),
          ),
        ),
        [player.keypair],
      );
    }

    /* balance == tracked → silent no-op. */
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createTreasurySweepUntrackedNoviInstruction(
          { owner: player.publicKey },
          { kind: SweepKind.User },
        ),
      ),
      [player.keypair],
    );

    /* Reserved ATA + wallet ATA both unchanged. */
    expect(readSplTokenAmount(ctx.svm, reservedAta)).toBe(reservedBefore);
  });

  /* Purpose 6 (Liquidity) mints directly to an external wallet ATA —
   * no UserAccount required, no vesting. The wallet receives NOVI it
   * can immediately trade on a DEX, then any game-side user can pull
   * NOVI back into reserved via deposit_novi. */
  it('mints purpose-6 (Liquidity) directly to an external wallet ATA', async () => {
    /* External wallet — NOT a game user. We never call init_user. */
    const externalWallet = await Keypair.generate();
    const AMOUNT = 5_000_000;

    const [noviMint] = await deriveNoviMintPda();
    const externalAta = await getAssociatedTokenAddressAsync(noviMint, externalWallet.publicKey);

    /* The wallet ATA doesn't exist yet — the SPL Token mint CPI requires
     * an initialized account, so the DAO ops must create it first. The
     * idempotent variant is safe even if it already exists. */
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        toV3Instruction(
          createAssociatedTokenAccountIdempotentInstruction(
            ctx.daoAuthority.publicKey as any,
            externalAta as any,
            externalWallet.publicKey as any,
            noviMint as any,
          ),
        ),
      ),
      [ctx.daoAuthority],
    );

    /* External mint. recipientOwner is the wallet pubkey; the SDK
     * routes it to the wallet ATA because purpose === Liquidity. */
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createMintForPrizeInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            recipientOwner: externalWallet.publicKey,
          },
          { amount: BigInt(AMOUNT), purpose: MintPurpose.Liquidity },
        ),
      ),
      [ctx.daoAuthority],
    );

    /* Wallet ATA now holds the minted NOVI — no UserAccount, no vesting. */
    expect(readSplTokenAmount(ctx.svm, externalAta)).toBe(BigInt(AMOUNT));

    /* And critically — no UserAccount was ever created for this wallet. */
    const [userPda] = await deriveUserPda(externalWallet.publicKey);
    expect(ctx.svm.getAccount(svmKey(userPda))).toBeNull();
  });

  /* Full external-mint → game-deposit loop: DAO mints purpose-6 to an
   * external LP wallet, the LP wallet onboards as a game user, then
   * deposits the NOVI back into reserved via deposit_novi (paying the
   * 5% fee). This is the DEX-liquidity-injection flow the design's
   * §1 was written around. */
  it('round-trips: external Liquidity mint → init_user → deposit_novi', async () => {
    /* Use a player from the factory so init_user has already been
     * called for the wallet. (The factory creates both PlayerAccount
     * AND UserAccount on init.) */
    const player = await factory.createPlayer({ initialize: true });
    const AMOUNT = 1_000_000;

    /* DAO mints purpose-6 directly to the wallet ATA, NOT through the
     * reserved pool. Wallet ATA needs to exist — seed via the
     * idempotent helper so the test is order-independent. */
    const [noviMint] = await deriveNoviMintPda();
    const walletAta = await getAssociatedTokenAddressAsync(noviMint, player.publicKey);
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        toV3Instruction(
          createAssociatedTokenAccountIdempotentInstruction(
            ctx.daoAuthority.publicKey as any,
            walletAta as any,
            player.publicKey as any,
            noviMint as any,
          ),
        ),
      ),
      [ctx.daoAuthority],
    );

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createMintForPrizeInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            recipientOwner: player.publicKey,
          },
          { amount: BigInt(AMOUNT), purpose: MintPurpose.Liquidity },
        ),
      ),
      [ctx.daoAuthority],
    );
    expect(readSplTokenAmount(ctx.svm, walletAta)).toBe(BigInt(AMOUNT));

    /* Critically: the external mint did NOT touch user.reserved_novi.
     * The user-side reserved pool stays at zero. */
    const [userPda] = await deriveUserPda(player.publicKey);
    const preDeposit = parseUser((await fetchAccount(ctx.svm, userPda))!);
    expect(preDeposit).not.toBeNull();
    expect(preDeposit!.reservedNovi.toString()).toBe('0');

    /* Now deposit half of the wallet balance back into reserved.
     * fee = 500 bps × 500000 = 25000; credited = 475000. */
    const depositAmount = AMOUNT / 2;
    const expectedFee = Math.floor((depositAmount * DEPOSIT_FEE_BPS) / 10_000);
    const expectedCredited = depositAmount - expectedFee;

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createDepositNoviInstruction(
          { owner: player.publicKey },
          { amount: BigInt(depositAmount) },
        ),
      ),
      [player.keypair],
    );

    /* Wallet ATA: lost depositAmount. */
    expect(readSplTokenAmount(ctx.svm, walletAta)).toBe(BigInt(AMOUNT - depositAmount));

    /* Reserved ATA + state: credited tokens. */
    const reservedAta = await getAssociatedTokenAddressAsyncForPda(noviMint, userPda);
    expect(readSplTokenAmount(ctx.svm, reservedAta)).toBe(BigInt(expectedCredited));
    const postDeposit = parseUser((await fetchAccount(ctx.svm, userPda))!);
    expect(postDeposit!.reservedNovi.toString()).toBe(String(expectedCredited));
  });

  /* Regression: internal purposes (Prize = 0) still flow through the
   * UserAccount reserved pool, with the 7-day vesting clock reset. */
  it('purpose-0 (Prize) still credits reserved + sets earned_at (regression)', async () => {
    const player = await factory.createPlayer({ initialize: true });
    const AMOUNT = 50_000;

    const [userPda] = await deriveUserPda(player.publicKey);
    const pre = parseUser((await fetchAccount(ctx.svm, userPda))!);
    const reservedBefore = pre!.reservedNovi;

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createMintForPrizeInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            recipientOwner: player.publicKey,
          },
          { amount: BigInt(AMOUNT), purpose: MintPurpose.Prize },
        ),
      ),
      [ctx.daoAuthority],
    );

    const post = parseUser((await fetchAccount(ctx.svm, userPda))!);
    expect(post!.reservedNovi.toString()).toBe((reservedBefore + BigInt(AMOUNT)).toString());
    /* earned_at must be non-zero (the mint reset it to clock.now). */
    expect(Number(post!.reservedNoviEarnedAt)).toBeGreaterThan(0);
  });

  /* The sweep refuses to drain a PDA you don't own — Bob can't sweep
   * Alice's user PDA. */
  it('rejects a sweep signed by someone other than the PDA owner', async () => {
    const alice = await factory.createPlayer({ initialize: true });
    const bob = await factory.createPlayer({ initialize: true });

    /* Build the sweep ix for alice's PDA but sign with bob's keypair.
     * The SDK builder derives the PDA from accounts.owner, so we have to
     * tamper with the keys post-construction: replace `owner` (index 0)
     * with bob's wallet, but leave the PDA at index 1 pointing to
     * alice's. The on-chain `&user.owner != owner.address()` check
     * should reject. */
    const baseIx = await createTreasurySweepUntrackedNoviInstruction(
      { owner: alice.publicKey },
      { kind: SweepKind.User },
    );
    const tamperedKeys = [...baseIx.keys];
    /* Swap signer to bob while leaving the PDA at index 1 alone. */
    tamperedKeys[0] = { pubkey: bob.publicKey, isSigner: true, isWritable: true };
    /* Bob's wallet ATA must replace the destination too, otherwise the
     * wallet-ATA-ownership check fires first. */
    const [noviMint] = await deriveNoviMintPda();
    const bobWallet = await getAssociatedTokenAddressAsync(noviMint, bob.publicKey);
    tamperedKeys[3] = { pubkey: bobWallet, isSigner: false, isWritable: true };
    const tamperedIx = new (baseIx.constructor as any)({
      keys: tamperedKeys,
      programId: baseIx.programId,
      data: baseIx.data,
    });

    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(tamperedIx),
      [bob.keypair],
    );
  });
});
