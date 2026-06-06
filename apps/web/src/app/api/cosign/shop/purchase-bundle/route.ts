import "server-only";
import { NextResponse } from "next/server";
import {
  createPurchaseBundleInstruction,
  deriveBundlePda,
  deriveShopItemPda,
  parseBundle,
  getAssociatedTokenAddressAsync,
} from "novus-mundus-sdk";
import { coSign } from "@/lib/server/cosign";
import { buildOracleCrankIxs } from "@/lib/server/oracle-crank";
import { parseSessionBody, fail } from "@/lib/server/route-helpers";
import { loadTokenPurchaseContext, feedHex } from "@/lib/server/shop-cosign";

export const runtime = "nodejs";

interface BundleBody {
  bundleId: number;
  tokenMint: string;
}

/**
 * POST /api/cosign/shop/purchase-bundle
 *
 * Switchboard-payment bundle purchase. Bundles the JIT oracle refresh:
 *
 *   [ed25519-verify, crank_oracle_quote, purchase_bundle]
 *
 * Bundles are SOL-priced, so the token path always needs the oracle. The
 * per-item ShopItem accounts are derived from the on-chain Bundle.
 * Non-Switchboard tokens get `NOT_SWITCHBOARD` for the direct path.
 */
export async function POST(req: Request) {
  const parsed = await parseSessionBody<BundleBody>(req);
  if ("error" in parsed) return parsed.error;
  const { owner: buyer, body } = parsed;

  if (!Number.isInteger(body.bundleId) || body.bundleId < 0) {
    return fail("invalid 'bundleId'");
  }

  const loaded = await loadTokenPurchaseContext(body.tokenMint);
  if (loaded instanceof NextResponse) return loaded;
  const { ctx, tok, tokenMint } = loaded;

  // Derive a ShopItem account per bundle item, in order (matches the on-chain
  // positional `shop_item_accounts[i]` read).
  const [bundlePda] = await deriveBundlePda(ctx.gameEngine, body.bundleId);
  const bundleInfo = await ctx.connection.getAccountInfo(bundlePda);
  const bundle = bundleInfo ? parseBundle(bundleInfo) : null;
  if (!bundle) return fail("bundle not found", 404);
  const shopItemAccounts = await Promise.all(
    bundle.items.map(async (it) => (await deriveShopItemPda(ctx.gameEngine, it.itemId))[0]),
  );

  try {
    const crankIxs = await buildOracleCrankIxs({
      gameEngine: ctx.gameEngine,
      switchboardQueue: ctx.switchboardQueue,
      feedHashes: [feedHex(ctx.shopConfig.solSwitchboardFeed), tok.tokenFeedHex],
      ed25519IxIndex: ctx.ed25519IxIndex,
    });

    const purchaseIx = await createPurchaseBundleInstruction(
      {
        buyer,
        gameEngine: ctx.gameEngine,
        bundleId: body.bundleId,
        treasury: ctx.treasury,
        shopItemAccounts,
        tokenPayment: {
          allowedToken: tok.allowedTokenPda,
          tokenMint,
          buyerTokenAta: await getAssociatedTokenAddressAsync(tokenMint, buyer),
          treasuryTokenAta: await getAssociatedTokenAddressAsync(tokenMint, ctx.treasury),
          oracleQuote: ctx.oracleQuote,
          switchboardQueue: ctx.switchboardQueue,
        },
      },
      { paymentType: 2 },
    );

    const transaction = await coSign([...crankIxs, purchaseIx], buyer, [ctx.alt]);
    return NextResponse.json({ transaction });
  } catch (e) {
    console.error("bundle co-sign failed", e);
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
