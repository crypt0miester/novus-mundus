/**
 * Oracle crank + purchase transaction-bundling E2E test.
 *
 * Design question for the web/app: when a Switchboard-payment purchase needs a
 * fresh oracle quote, can the crank ride in the SAME transaction the user
 * signs — `[ed25519-verify, crank_oracle_quote, purchase_item]`?
 *
 * This compiles the real instruction set and measures the wire size against
 * Solana's hard 1232-byte packet limit, both as a plain v0 transaction and
 * with an Address Lookup Table compressing the shared (non-per-buyer)
 * accounts. The `ed25519` payload uses the exact `OracleQuote` layout the
 * on-chain verifier consumes (see `seedMockOracleQuote` in `fixtures/svm.ts`):
 * it scales 49 bytes per feed, and one quote carries every feed the game
 * prices against (SOL/USD + NOVI/USD + each whitelisted token), not just the
 * two a single purchase reads.
 */

import { describe, it, expect } from 'bun:test';
import {
  address,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  type Instruction,
  type Address,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  createCrankOracleQuoteInstruction,
  createPurchaseItemInstruction,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveAllowedTokenPda,
  deriveOracleQuotePda,
  getAssociatedTokenAddressSync,
  SLOT_HASHES_SYSVAR,
  INSTRUCTIONS_SYSVAR,
} from '../../src/index';

/** Solana hard transaction (packet) size limit, in bytes. */
const TX_LIMIT = 1232;

/** Solana ed25519 signature-verify native program. */
const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111');

/** A 32-zero-byte base58 blockhash — only the size matters here. */
const DUMMY_BLOCKHASH = '11111111111111111111111111111111' as Parameters<
  typeof setTransactionMessageLifetimeUsingBlockhash
>[0]['blockhash'];

/**
 * Switchboard quote `ed25519` instruction data for `feedCount` feeds signed by
 * `numSigs` oracles. Byte-exact with `seedMockOracleQuote`'s `ed` buffer.
 */
function ed25519Ix(numSigs: number, feedCount: number): Instruction {
  const messageSize = 32 + 49 * feedCount;
  const pubkeysOffset = 2 + 14 * numSigs;
  const signaturesOffset = pubkeysOffset + 32 * numSigs;
  const messageOffset = signaturesOffset + 64 * numSigs;
  const len = messageOffset + messageSize + (numSigs + 8 + 1 + 4);
  return { programAddress: ED25519_PROGRAM, data: new Uint8Array(len) };
}

interface Bundle {
  cuIxs: Instruction[];
  crankIx: Instruction;
  purchaseIx: Instruction;
  feePayer: Address;
  /** Every shared, non-per-buyer, non-program account — the maximal ALT. */
  altFull: Address[];
  /**
   * Only the kingdom-fixed accounts — created once, never extended. Excludes
   * the per-token accounts (`allowedToken`, `tokenMint`, `treasuryTokenAta`)
   * and the per-item `shopItem`, which then ride as plain static keys.
   */
  altGlobal: Address[];
}

/**
 * Build a realistic `[ed25519, crank, purchase]` Switchboard-purchase bundle.
 *
 * Every account is derived/known so the ALT set is exact: the shared accounts
 * (config, item, oracle-quote, queue, sysvars, …) go in the table; the
 * per-buyer PDAs (`player`, `inventory`, `estate`, `playerPurchase`,
 * `buyerTokenAta`) and the two signers must stay in the static keys.
 */
async function buildBundle(): Promise<Bundle> {
  const buyer = await generateKeyPairSigner();
  const cranker = await generateKeyPairSigner();
  const gameEngine = (await generateKeyPairSigner()).address;
  const treasury = (await generateKeyPairSigner()).address;
  const tokenMint = (await generateKeyPairSigner()).address;
  const switchboardQueue = (await generateKeyPairSigner()).address;
  const itemId = 9999;

  const [shopConfig] = await deriveShopConfigPda(gameEngine);
  const [shopItem] = await deriveShopItemPda(gameEngine, itemId);
  const [allowedToken] = await deriveAllowedTokenPda(gameEngine, tokenMint);
  const [oracleQuote] = await deriveOracleQuotePda(switchboardQueue);
  const treasuryTokenAta = await getAssociatedTokenAddressSync(tokenMint, treasury);
  const buyerTokenAta = await getAssociatedTokenAddressSync(tokenMint, buyer.address);

  // ed25519 sits at tx index 2: [CUlimit, CUprice, ed25519, crank, purchase].
  const crankIx = await createCrankOracleQuoteInstruction(
    { cranker: cranker.address, gameEngine, switchboardQueue },
    2,
  );
  const purchaseIx = await createPurchaseItemInstruction(
    {
      buyer: buyer.address,
      gameEngine,
      itemId,
      treasury,
      tokenPayment: {
        allowedToken,
        tokenMint,
        buyerTokenAta,
        treasuryTokenAta,
        oracleQuote,
        switchboardQueue,
      },
    },
    { quantity: 1, paymentType: 2 },
  );

  return {
    cuIxs: [
      getSetComputeUnitLimitInstruction({ units: 200_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 10_000 }),
    ],
    crankIx,
    purchaseIx,
    feePayer: buyer.address,
    altFull: [
      gameEngine,
      shopConfig,
      shopItem,
      treasury,
      allowedToken,
      tokenMint,
      treasuryTokenAta,
      oracleQuote,
      switchboardQueue,
      SLOT_HASHES_SYSVAR,
      INSTRUCTIONS_SYSVAR,
    ],
    altGlobal: [
      gameEngine,
      shopConfig,
      treasury,
      oracleQuote,
      switchboardQueue,
      SLOT_HASHES_SYSVAR,
      INSTRUCTIONS_SYSVAR,
    ],
  };
}

function baseMessage(instructions: Instruction[], feePayer: Address) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 0n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Compiled wire size: `shortvec(sigCount)` + 64·signers + message bytes. */
function wireSize(message: ReturnType<typeof baseMessage>): number {
  const compiled = compileTransaction(message);
  return compiled.messageBytes.length + 1 + 64 * Object.keys(compiled.signatures).length;
}

/** Size of `[CUs, ed25519, crank, purchase]`, optionally ALT-compressed. */
function bundleSize(
  b: Bundle,
  numSigs: number,
  feedCount: number,
  alt?: { addr: Address; accounts: Address[] },
): number {
  const ixs = [...b.cuIxs, ed25519Ix(numSigs, feedCount), b.crankIx, b.purchaseIx];
  let msg = baseMessage(ixs, b.feePayer);
  if (alt) msg = compressTransactionMessageUsingAddressLookupTables(msg, { [alt.addr]: alt.accounts });
  return wireSize(msg);
}

const fmt = (label: string, size: number) =>
  `  ${label.padEnd(34)} ${String(size).padStart(4)}  headroom ${String(
    TX_LIMIT - size,
  ).padStart(5)}  ${size <= TX_LIMIT ? 'FITS' : 'OVER'}`;

describe('Oracle crank + purchase transaction bundling', () => {
  it('plain v0 only fits the bare-minimum quote — overflows on realistic feeds/sigs', async () => {
    const b = await buildBundle();
    const min = bundleSize(b, 1, 2); // 2 feeds, 1 oracle sig
    const feeds5 = bundleSize(b, 1, 5); // SOL + NOVI + 3 tokens, 1 sig
    const sigs3 = bundleSize(b, 3, 2); // 2 feeds, 3 oracle sigs

    console.log('\n  plain v0 [CUs, ed25519, crank, purchase] — no ALT, limit 1232');
    console.log(fmt('2 feeds, 1 oracle sig', min));
    console.log(fmt('5 feeds, 1 oracle sig', feeds5));
    console.log(fmt('2 feeds, 3 oracle sigs', sigs3));

    // The bare-minimum quote technically fits, but only by a handful of bytes
    // — not a margin a design can rely on.
    expect(TX_LIMIT - min).toBeLessThan(32);
    // Realistic feed counts and multi-oracle quotes overflow outright.
    expect(feeds5).toBeGreaterThan(TX_LIMIT);
    expect(sigs3).toBeGreaterThan(TX_LIMIT);
  });

  it('the maximal ALT fits [ed25519, crank, purchase] across every config', async () => {
    const b = await buildBundle();
    const alt = { addr: (await generateKeyPairSigner()).address, accounts: b.altFull };

    const min = bundleSize(b, 1, 2, alt);
    const feeds8 = bundleSize(b, 1, 8, alt); // a fully-loaded 8-feed quote
    const sigs3 = bundleSize(b, 3, 2, alt);

    console.log(`\n  maximal ALT (${b.altFull.length} accounts, extended per token) — limit 1232`);
    console.log(fmt('2 feeds, 1 oracle sig', min));
    console.log(fmt('8 feeds, 1 oracle sig', feeds8));
    console.log(fmt('2 feeds, 3 oracle sigs', sigs3));

    expect(min).toBeLessThanOrEqual(TX_LIMIT);
    expect(feeds8).toBeLessThanOrEqual(TX_LIMIT);
    expect(sigs3).toBeLessThanOrEqual(TX_LIMIT);
  });

  it('a global-only ALT fits the per-purchase JIT crank — and never needs extending', async () => {
    const b = await buildBundle();
    // Only the kingdom-fixed accounts. `allow-token` never touches this ALT;
    // the per-token accounts (`allowedToken`, `tokenMint`, `treasuryTokenAta`)
    // ride as plain static keys.
    const alt = { addr: (await generateKeyPairSigner()).address, accounts: b.altGlobal };

    // The JIT design cranks a FRESH quote covering exactly the 2 feeds this
    // purchase reads — SOL/USD + this token. feedCount is always 2, no matter
    // how many tokens are whitelisted, so the ALT membership is fixed forever.
    const jit = bundleSize(b, 1, 2, alt);

    console.log(`\n  global-only ALT (${b.altGlobal.length} fixed accounts, never extended) — limit 1232`);
    console.log(fmt('per-purchase JIT crank (2 feeds)', jit));
    // Reference: a shared quote carrying many feeds at once would instead need
    // the maximal (per-token-extended) ALT — global-only tops out near 5 feeds.
    for (const f of [4, 6, 8]) console.log(fmt(`(ref) ${f}-feed shared quote`, bundleSize(b, 1, f, alt)));
    console.log();

    expect(jit).toBeLessThanOrEqual(TX_LIMIT);
    expect(TX_LIMIT - jit).toBeGreaterThan(100); // comfortable, fixed headroom
  });
});
