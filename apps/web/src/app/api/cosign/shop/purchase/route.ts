import "server-only";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  createPurchaseItemInstruction,
  deriveShopConfigPda,
  deriveAllowedTokenPda,
  deriveOracleQuotePda,
  parseShopConfig,
  parseAllowedToken,
  parseGameEngine,
  getAssociatedTokenAddressAsync,
  COMPUTE_BUDGET_PREFIX_IX_COUNT,
} from "novus-mundus-sdk";
import { gameEnginePda } from "@/lib/server/chain";
import { serverConnection } from "@/lib/server/game-authority";
import { coSign } from "@/lib/server/cosign";
import { buildOracleCrankIxs } from "@/lib/server/oracle-crank";
import { parseSessionBody, fail } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface PurchaseBody {
  itemId: number;
  tokenMint: string;
  quantity?: number;
}

/** A 32-byte feed/key is "unset" when all zero. */
const isZeroKey = (k: PublicKey): boolean => k.equals(PublicKey.default);

/** A 32-byte Switchboard feed hash, as the program stores it, to hex. */
const feedHex = (k: PublicKey): string => Buffer.from(k.toBytes()).toString("hex");

/**
 * POST /api/cosign/shop/purchase
 *
 * Builds a Switchboard-payment item purchase. Because the price comes from a
 * Switchboard On-Demand quote that must be fresh, the server fetches a quote
 * just in time and bundles the refresh into the same transaction:
 *
 *   [ed25519-verify, crank_oracle_quote, purchase_item]
 *
 * The shared (kingdom-fixed) accounts are compressed via the shop Address
 * Lookup Table so the bundle fits the 1232-byte limit. The `crank` is
 * co-signed by the `game_authority`; the buyer's wallet signs as fee payer.
 *
 * SOL- and Pyth-priced purchases need no server involvement — the client
 * builds those directly. This route rejects non-Switchboard tokens with the
 * `NOT_SWITCHBOARD` code so the client can fall back to the direct path.
 */
export async function POST(req: Request) {
  const parsed = await parseSessionBody<PurchaseBody>(req);
  if ("error" in parsed) return parsed.error;
  const { owner: buyer, body } = parsed;

  if (!Number.isInteger(body.itemId) || body.itemId < 0) {
    return fail("invalid 'itemId'");
  }
  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return fail("invalid 'quantity'");
  }
  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(body.tokenMint);
  } catch {
    return fail("invalid 'tokenMint' pubkey");
  }

  const connection = serverConnection();
  const gameEngine = gameEnginePda();

  // Shop config — the Switchboard queue + SOL/USD feed hash.
  const [shopConfigPda] = await deriveShopConfigPda(gameEngine);
  const shopConfigInfo = await connection.getAccountInfo(shopConfigPda);
  const shopConfig = shopConfigInfo ? parseShopConfig(shopConfigInfo) : null;
  if (!shopConfig) return fail("shop config not found", 500);
  if (isZeroKey(shopConfig.solSwitchboardQueue)) {
    return fail("Switchboard is not configured for this kingdom", 400, "NO_SWITCHBOARD");
  }

  // Allowed token — must carry a Switchboard TOKEN/USD feed hash.
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

  // Treasury wallet — the purchase pays its ATA.
  const gameEngineInfo = await connection.getAccountInfo(gameEngine);
  const engine = gameEngineInfo ? parseGameEngine(gameEngineInfo) : null;
  if (!engine) return fail("game engine not found", 500);
  const treasury = engine.treasuryWallet;

  // The shop Address Lookup Table (created once via `novus oracle init-alt`).
  const altRaw = process.env.SHOP_ADDRESS_LOOKUP_TABLE;
  if (!altRaw) {
    return fail("SHOP_ADDRESS_LOOKUP_TABLE is not configured", 500);
  }
  const altResult = await connection.getAddressLookupTable(new PublicKey(altRaw));
  const alt = altResult.value;
  if (!alt) return fail("shop Address Lookup Table not found on-chain", 500);

  const switchboardQueue = shopConfig.solSwitchboardQueue;
  const [oracleQuote] = await deriveOracleQuotePda(switchboardQueue);

  try {
    // Final tx layout: [<compute-budget prefix>, ed25519, crank, purchase].
    // `coSign` to `buildVersionedTransaction` prepends COMPUTE_BUDGET_PREFIX_IX_COUNT
    // instructions, and `ed25519` is the first instruction we supply — so it
    // lands at exactly that index. This index is consumed two ways and BOTH
    // must match its real position: the Switchboard gateway request, and the
    // `crank_oracle_quote` data (which tells the program where to read the
    // quote from the instructions sysvar).
    const ed25519IxIndex = COMPUTE_BUDGET_PREFIX_IX_COUNT;
    const crankIxs = await buildOracleCrankIxs({
      gameEngine,
      switchboardQueue,
      feedHashes: [feedHex(shopConfig.solSwitchboardFeed), feedHex(allowedToken.switchboardFeed)],
      ed25519IxIndex,
    });

    const purchaseIx = await createPurchaseItemInstruction(
      {
        buyer,
        gameEngine,
        itemId: body.itemId,
        treasury,
        tokenPayment: {
          allowedToken: allowedTokenPda,
          tokenMint,
          buyerTokenAta: await getAssociatedTokenAddressAsync(tokenMint, buyer),
          treasuryTokenAta: await getAssociatedTokenAddressAsync(tokenMint, treasury),
          oracleQuote,
          switchboardQueue,
        },
      },
      { quantity, paymentType: 2 },
    );

    const transaction = await coSign([...crankIxs, purchaseIx], buyer, [alt]);
    return NextResponse.json({ transaction });
  } catch (e) {
    console.error("shop purchase co-sign failed", e);
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
