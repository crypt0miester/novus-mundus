// Server-side hero loader. Reads the on-chain AssetV1, plus the owner's
// PlayerAccount (for lock state) and the HeroTemplate (for tier) — the
// latter two batched into one getMultipleAccountsInfo so the route stays at
// two RPC roundtrips.
//
// Returns null if the account doesn't exist, isn't a valid AssetV1, lacks
// the "Template" attribute, or the templateId doesn't resolve to a known
// HeroTemplate on chain. The caller (the /heroes/<pubkey> routes) treats
// null as a 404.

import type { Connection, PublicKey } from "@solana/web3.js";
import {
  derivePlayerPda,
  deriveHeroTemplatePda,
  parseAssetV1,
  parsePlayer,
  parseHeroTemplate,
  tierFromMintCost,
  type ParsedAssetV1,
} from "novus-mundus-sdk";
import type { HeroState } from "../hero-image/fingerprint";
import { gameEnginePda } from "../server/chain";

export interface FetchedHero {
  asset: ParsedAssetV1;
  state: HeroState;
}

export async function fetchHero(
  connection: Connection,
  pubkey: PublicKey,
): Promise<FetchedHero | null> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info?.data) return null;

  const asset = parseAssetV1(info.data);
  if (!asset) return null;

  const tplStr = asset.attributes.Template;
  if (!tplStr) return null;

  const templateId = parseInt(tplStr, 10);
  if (!Number.isFinite(templateId)) return null;

  const levelStr = asset.attributes.Level;
  const parsedLevel = levelStr != null ? parseInt(levelStr, 10) : NaN;
  const level = Number.isFinite(parsedLevel) ? Math.max(1, parsedLevel) : 1;

  // Batch the two follow-up reads. PlayerAccount supplies lock state
  // (activeHeroes contains the asset mint when slotted); HeroTemplate
  // supplies on-chain tier so a DAO mint-cost change is reflected without
  // redeploying the web app.
  const ge = gameEnginePda();
  const [playerPda] = derivePlayerPda(ge, asset.owner);
  const [templatePda] = deriveHeroTemplatePda(templateId);
  const [playerInfo, templateInfo] = await connection.getMultipleAccountsInfo(
    [playerPda, templatePda],
    "confirmed",
  );

  const template = templateInfo ? parseHeroTemplate(templateInfo) : null;
  if (!template) return null;
  // mintCostSol is the field name but stores lamports (cf. on-chain
  // HeroTemplate.mint_cost_sol comment in state/hero.rs).
  const tier = tierFromMintCost(template.mintCostSol.toNumber());

  // Lock state lives on the owner's PlayerAccount, not the asset itself.
  // Treat a missing player account as "unlocked" — the hero exists but the
  // owner hasn't initialised a player yet (or is no longer using the slot).
  let locked = false;
  if (playerInfo) {
    const player = parsePlayer(playerInfo);
    if (player) {
      locked = player.activeHeroes.some((h) => h.equals(pubkey));
    }
  }

  return { asset, state: { templateId, tier, level, locked } };
}
