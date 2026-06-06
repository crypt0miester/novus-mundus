/**
 * Shop oracle-payment account-layout unit tests.
 *
 * These assert the *account ordering* the new token/oracle purchase builders
 * emit, matching what `helpers::process_token_payment_flow` (item/flash/bundle)
 * and `purchase_novi`'s `try_oracle_price` read positionally on-chain. They run
 * without an SVM — the NOVI Switchboard path in particular has no SDK config
 * setter, so this is the only place its layout is pinned.
 */

import { describe, it, expect } from 'bun:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  createPurchaseFlashSaleInstruction,
  createPurchaseBundleInstruction,
  createPurchaseNoviInstruction,
  deriveGameEnginePda,
  deriveShopConfigPda,
  deriveOracleQuotePda,
  SPL_TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SLOT_HASHES_SYSVAR,
} from '../../src/index';

const pk = async (): Promise<PublicKey> => (await Keypair.generate()).publicKey;

describe('shop oracle-payment account layouts', () => {
  it('flash-sale Switchboard token payment appends the SB oracle accounts', async () => {
    const [gameEngine] = await deriveGameEnginePda(0);
    const buyer = await pk();
    const allowedToken = await pk();
    const tokenMint = await pk();
    const buyerTokenAta = await pk();
    const treasuryTokenAta = await pk();
    const oracleQuote = await pk();
    const switchboardQueue = await pk();

    const ix = await createPurchaseFlashSaleInstruction(
      {
        gameEngine,
        buyer,
        saleId: 1,
        itemOrBundle: await pk(),
        treasury: await pk(),
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

    // Base flash-sale accounts are 10; token-payment block follows.
    const tail = ix.keys.slice(10).map((k) => k.pubkey.toBase58());
    expect(tail).toEqual([
      allowedToken,
      tokenMint,
      buyerTokenAta,
      treasuryTokenAta,
      SPL_TOKEN_PROGRAM_ID,
      oracleQuote,
      switchboardQueue,
      SLOT_HASHES_SYSVAR,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ].map((k) => k.toBase58()));
    // The buyer/treasury ATAs are writable; the oracle accounts are not.
    expect(ix.keys.find((k) => k.pubkey.equals(buyerTokenAta))!.isWritable).toBe(true);
    expect(ix.keys.find((k) => k.pubkey.equals(oracleQuote))!.isWritable).toBe(false);
  });

  it('bundle Switchboard token payment appends the SB oracle accounts after shop items', async () => {
    const [gameEngine] = await deriveGameEnginePda(0);
    const allowedToken = await pk();
    const tokenMint = await pk();
    const buyerTokenAta = await pk();
    const treasuryTokenAta = await pk();
    const oracleQuote = await pk();
    const switchboardQueue = await pk();
    const shopItemAccounts = [await pk(), await pk()];

    const ix = await createPurchaseBundleInstruction(
      {
        gameEngine,
        buyer: await pk(),
        bundleId: 7001,
        treasury: await pk(),
        shopItemAccounts,
        tokenPayment: {
          allowedToken,
          tokenMint,
          buyerTokenAta,
          treasuryTokenAta,
          oracleQuote,
          switchboardQueue,
        },
      },
      { paymentType: 2 },
    );

    // Base bundle accounts are 9 + the 2 shop-item accounts = 11; token block follows.
    const tail = ix.keys.slice(9 + shopItemAccounts.length).map((k) => k.pubkey.toBase58());
    expect(tail).toEqual([
      allowedToken,
      tokenMint,
      buyerTokenAta,
      treasuryTokenAta,
      SPL_TOKEN_PROGRAM_ID,
      oracleQuote,
      switchboardQueue,
      SLOT_HASHES_SYSVAR,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ].map((k) => k.toBase58()));
  });

  it('NOVI Switchboard oracle appends [shopConfig, quote, queue, SlotHashes]', async () => {
    const [gameEngine] = await deriveGameEnginePda(0);
    const [shopConfig] = await deriveShopConfigPda(gameEngine);
    const switchboardQueue = await pk();
    const [oracleQuote] = await deriveOracleQuotePda(switchboardQueue);

    const ix = await createPurchaseNoviInstruction(
      { buyer: await pk(), gameEngine, treasury: await pk(), noviMint: await pk() },
      {
        packageIndex: 0,
        maxLamports: 1_000_000n,
        oracleAccounts: { shopConfig, oracleQuote, switchboardQueue },
      },
    );

    // 9 base NOVI accounts, then the 4-account Switchboard oracle tail.
    const tail = ix.keys.slice(9).map((k) => k.pubkey.toBase58());
    expect(tail).toEqual(
      [shopConfig, oracleQuote, switchboardQueue, SLOT_HASHES_SYSVAR].map((k) => k.toBase58()),
    );
  });

  it('NOVI Pyth oracle appends [shopConfig, solFeed, noviFeed]', async () => {
    const [gameEngine] = await deriveGameEnginePda(0);
    const [shopConfig] = await deriveShopConfigPda(gameEngine);
    const solOracleFeed = await pk();
    const noviOracleFeed = await pk();

    const ix = await createPurchaseNoviInstruction(
      { buyer: await pk(), gameEngine, treasury: await pk(), noviMint: await pk() },
      {
        packageIndex: 0,
        maxLamports: 1_000_000n,
        oracleAccounts: { shopConfig, solOracleFeed, noviOracleFeed },
      },
    );

    const tail = ix.keys.slice(9).map((k) => k.pubkey.toBase58());
    expect(tail).toEqual(
      [shopConfig, solOracleFeed, noviOracleFeed].map((k) => k.toBase58()),
    );
  });
});
