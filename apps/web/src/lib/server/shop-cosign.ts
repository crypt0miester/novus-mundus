import "server-only";
import { NextResponse } from "next/server";
import { PublicKey, type AddressLookupTableAccount } from "@solana/web3.js";
import {
  deriveShopConfigPda,
  deriveAllowedTokenPda,
  deriveOracleQuotePda,
  parseShopConfig,
  parseAllowedToken,
  parseGameEngine,
  COMPUTE_BUDGET_PREFIX_IX_COUNT,
} from "novus-mundus-sdk";
import { gameEnginePda } from "@/lib/server/chain";
import { serverConnection } from "@/lib/server/game-authority";
import { fail } from "@/lib/server/route-helpers";

/**
 * Shared building blocks for the Switchboard-priced shop cosign routes
 * (`purchase`, `purchase-flash-sale`, `purchase-bundle`, `purchase-novi`).
 *
 * Each route fetches a just-in-time oracle quote and bundles the refresh into
 * the same transaction the buyer signs:
 *
 *   [ed25519-verify, crank_oracle_quote, <purchase ix>]
 *
 * The shared (kingdom-fixed) accounts ride the shop Address Lookup Table so the
 * bundle fits the 1232-byte limit. SOL- and Pyth-priced purchases need no
 * server involvement — the client builds those directly.
 */

/** A 32-byte feed/key is "unset" when all zero. */
export const isZeroKey = (k: PublicKey): boolean => k.equals(PublicKey.default);

/** A 32-byte Switchboard feed hash, as the program stores it, to hex. */
export const feedHex = (k: PublicKey): string =>
  Buffer.from(k.toBytes()).toString("hex");

export interface ShopSwitchboardContext {
  connection: ReturnType<typeof serverConnection>;
  /** This kingdom's GameEngine PDA. */
  gameEngine: PublicKey;
  /** Parsed ShopConfig (carries the SOL/USD feed + Switchboard queue). */
  shopConfig: NonNullable<ReturnType<typeof parseShopConfig>>;
  /** Parsed GameEngine (carries the treasury wallet + NOVI config). */
  engine: NonNullable<ReturnType<typeof parseGameEngine>>;
  /** DAO-configured treasury wallet. */
  treasury: PublicKey;
  /** Switchboard On-Demand queue (`shop_config.sol_switchboard_queue`). */
  switchboardQueue: PublicKey;
  /** Program-owned oracle-quote PDA the crank writes + the purchase reads. */
  oracleQuote: PublicKey;
  /** The shop Address Lookup Table (created via `novus oracle init-alt`). */
  alt: AddressLookupTableAccount;
  /** Index of the ed25519 instruction in the final transaction. */
  ed25519IxIndex: number;
}

/**
 * Load the kingdom-fixed accounts every Switchboard-priced shop purchase needs:
 * shop config + queue, game engine + treasury, the oracle-quote PDA, and the
 * shop Address Lookup Table. Returns a `fail()` response on any missing piece,
 * or `NO_SWITCHBOARD` when this kingdom has no Switchboard queue configured.
 */
export async function loadShopSwitchboardContext(): Promise<
  ShopSwitchboardContext | NextResponse
> {
  const connection = serverConnection();
  const gameEngine = gameEnginePda();

  const [shopConfigPda] = await deriveShopConfigPda(gameEngine);
  const [shopConfigInfo, gameEngineInfo] = await Promise.all([
    connection.getAccountInfo(shopConfigPda),
    connection.getAccountInfo(gameEngine),
  ]);

  const shopConfig = shopConfigInfo ? parseShopConfig(shopConfigInfo) : null;
  if (!shopConfig) return fail("shop config not found", 500);
  if (isZeroKey(shopConfig.solSwitchboardQueue)) {
    return fail("Switchboard is not configured for this kingdom", 400, "NO_SWITCHBOARD");
  }

  const engine = gameEngineInfo ? parseGameEngine(gameEngineInfo) : null;
  if (!engine) return fail("game engine not found", 500);

  const altRaw = process.env.SHOP_ADDRESS_LOOKUP_TABLE;
  if (!altRaw) return fail("SHOP_ADDRESS_LOOKUP_TABLE is not configured", 500);
  const altResult = await connection.getAddressLookupTable(new PublicKey(altRaw));
  const alt = altResult.value;
  if (!alt) return fail("shop Address Lookup Table not found on-chain", 500);

  const switchboardQueue = shopConfig.solSwitchboardQueue;
  const [oracleQuote] = await deriveOracleQuotePda(switchboardQueue);

  return {
    connection,
    gameEngine,
    shopConfig,
    engine,
    treasury: engine.treasuryWallet,
    switchboardQueue,
    oracleQuote,
    alt,
    ed25519IxIndex: COMPUTE_BUDGET_PREFIX_IX_COUNT,
  };
}

/**
 * Resolve a Switchboard-priced payment token: its AllowedToken PDA + the hex
 * feed hash for the crank. Rejects non-registered tokens, and non-Switchboard
 * tokens with `NOT_SWITCHBOARD` so the client falls back to the direct path.
 */
export async function loadSwitchboardToken(
  connection: ReturnType<typeof serverConnection>,
  gameEngine: PublicKey,
  tokenMint: PublicKey,
): Promise<{ allowedTokenPda: PublicKey; tokenFeedHex: string } | NextResponse> {
  const [allowedTokenPda] = await deriveAllowedTokenPda(gameEngine, tokenMint);
  const allowedTokenInfo = await connection.getAccountInfo(allowedTokenPda);
  const allowedToken = allowedTokenInfo ? parseAllowedToken(allowedTokenInfo) : null;
  if (!allowedToken) return fail("token is not a registered payment token", 400);
  if (isZeroKey(allowedToken.switchboardFeed)) {
    return fail(
      "token is not Switchboard-priced — use the direct purchase path",
      400,
      "NOT_SWITCHBOARD",
    );
  }
  return { allowedTokenPda, tokenFeedHex: feedHex(allowedToken.switchboardFeed) };
}

export interface TokenPurchaseContext {
  ctx: ShopSwitchboardContext;
  tok: { allowedTokenPda: PublicKey; tokenFeedHex: string };
  tokenMint: PublicKey;
}

/**
 * One-shot loader for the token-paid shop cosign routes (item / flash-sale /
 * bundle): parse the payment-token pubkey, load the Switchboard context, and
 * resolve the token's AllowedToken + feed. Returns a `fail()` response (the
 * caller forwards it) on any bad input or missing/non-Switchboard token.
 */
export async function loadTokenPurchaseContext(
  tokenMintRaw: string,
): Promise<TokenPurchaseContext | NextResponse> {
  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(tokenMintRaw);
  } catch {
    return fail("invalid 'tokenMint' pubkey");
  }
  const ctx = await loadShopSwitchboardContext();
  if (ctx instanceof NextResponse) return ctx;
  const tok = await loadSwitchboardToken(ctx.connection, ctx.gameEngine, tokenMint);
  if (tok instanceof NextResponse) return tok;
  return { ctx, tok, tokenMint };
}
