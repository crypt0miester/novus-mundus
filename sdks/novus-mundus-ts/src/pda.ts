/**
 * PDA Derivation Functions
 *
 * All Program Derived Address derivation functions for Novus Mundus.
 *
 * web3.js v3: `PublicKey.findProgramAddressSync` no longer exists. Derivation
 * is async (native crypto.subtle under the hood) via `getProgramDerivedAddress`
 * from '@solana/addresses'. Every exported `derive*Pda` is therefore `async` and
 * returns a Promise; callers MUST `await`. The returned Address (a base58
 * string) is wrapped in `new PublicKey(...)` so the public types stay
 * PublicKey-based and downstream code that holds PublicKeys is unchanged.
 */

import { PublicKey } from '@solana/web3.js';
import { getProgramDerivedAddress, type Address } from '@solana/addresses';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  PROGRAM_ID,
  SEEDS,
  ALT_NAME_SERVICE_PROGRAM_ID,
  TLD_HOUSE_PROGRAM_ID,
} from './program';

// Browser-safe LE byte helpers (no Buffer.write* dependency)
function u8(v: number): Uint8Array { return new Uint8Array([v & 0xff]); }
function u16le(v: number): Uint8Array { return new Uint8Array([v & 0xff, (v >> 8) & 0xff]); }
function i32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
}
function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}
function u64le(v: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
}
function strBytes(s: string): Uint8Array { return new TextEncoder().encode(s); }

/**
 * Core async derivation: run `getProgramDerivedAddress` with the given seeds
 * under the given program and wrap the result as `[PublicKey, bump]`.
 *
 * `programId` is a PublicKey; its base58 form is the `programAddress` the
 * @solana/addresses API expects. Seeds are raw bytes (Uint8Array).
 */
async function derive(
  programId: PublicKey,
  seeds: Uint8Array[],
): Promise<[PublicKey, number]> {
  const [addr, bump] = await getProgramDerivedAddress({
    programAddress: programId.toBase58() as Address,
    seeds,
  });
  return [new PublicKey(addr), bump];
}

// Core Account PDAs

/** Derive GameEngine PDA for a specific kingdom */
export async function deriveGameEnginePda(kingdomId: number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.GAME_ENGINE, u16le(kingdomId)]);
}

/** Derive NOVI Mint PDA */
export async function deriveNoviMintPda(): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.NOVI_MINT]);
}

/** Derive PlayerAccount PDA from game engine and owner wallet */
export async function derivePlayerPda(gameEngine: PublicKey, owner: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.PLAYER, gameEngine.toBytes(), owner.toBytes()]);
}

/** Derive User PDA from wallet */
export async function deriveUserPda(wallet: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.USER, wallet.toBytes()]);
}

/** Derive City PDA from game engine and city ID */
export async function deriveCityPda(gameEngine: PublicKey, cityId: number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.CITY, gameEngine.toBytes(), u16le(cityId)]);
}

// Team System PDAs

/** Derive Team PDA from game engine and team ID */
export async function deriveTeamPda(gameEngine: PublicKey, teamId: bigint | number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.TEAM, gameEngine.toBytes(), u64le(teamId)]);
}

/** Derive Team Member Slot PDA */
export async function deriveTeamSlotPda(
  team: PublicKey,
  slotIndex: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.TEAM_SLOT, team.toBytes(), u16le(slotIndex)]);
}

/** Derive Team Invite PDA */
export async function deriveTeamInvitePda(
  team: PublicKey,
  invitee: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.TEAM_INVITE, team.toBytes(), invitee.toBytes()]);
}

/** Derive Treasury Request PDA */
export async function deriveTreasuryRequestPda(
  team: PublicKey,
  requester: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.TREASURY_REQUEST, team.toBytes(), requester.toBytes()]);
}

// Rally System PDAs

/** Derive Rally PDA */
export async function deriveRallyPda(
  gameEngine: PublicKey,
  creator: PublicKey,
  rallyId: number | bigint
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.RALLY, gameEngine.toBytes(), creator.toBytes(), u64le(rallyId)]);
}

/** Derive Rally Participant PDA */
export async function deriveRallyParticipantPda(
  gameEngine: PublicKey,
  rallyCreator: PublicKey,
  rallyId: number | bigint,
  participant: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [
    SEEDS.RALLY_PARTICIPANT,
    gameEngine.toBytes(),
    rallyCreator.toBytes(),
    u64le(rallyId),
    participant.toBytes(),
  ]);
}

// Reinforcement System PDAs

/** Derive Reinforcement PDA (player-to-player) */
export async function deriveReinforcementPda(
  gameEngine: PublicKey,
  sender: PublicKey,
  receiver: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.REINFORCEMENT, gameEngine.toBytes(), sender.toBytes(), receiver.toBytes()]);
}

/** Derive Garrison Reinforcement PDA (player-to-castle) */
export async function deriveGarrisonReinforcementPda(
  gameEngine: PublicKey,
  sender: PublicKey,
  castle: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.GARRISON, gameEngine.toBytes(), sender.toBytes(), castle.toBytes()]);
}

/** Derive Garrison Contribution PDA */
export async function deriveGarrisonPda(
  castle: PublicKey,
  player: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.GARRISON, castle.toBytes(), player.toBytes()]);
}

// Location PDAs

/** Derive Location PDA from game engine, city and grid coordinates */
export async function deriveLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  gridLat: number,
  gridLong: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.LOCATION, gameEngine.toBytes(), u16le(cityId), i32le(gridLat), i32le(gridLong)]);
}

// Encounter & Loot PDAs

/** Derive Encounter PDA */
export async function deriveEncounterPda(
  gameEngine: PublicKey,
  cityId: number,
  encounterId: bigint | number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ENCOUNTER, gameEngine.toBytes(), u16le(cityId), u64le(encounterId)]);
}

/** Derive Loot PDA: [b"loot", player_pda, loot_id_le] */
export async function deriveLootPda(
  playerPda: PublicKey,
  lootId: number | bigint
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.LOOT, playerPda.toBytes(), u64le(lootId)]);
}

// Event System PDAs

/** Derive Event PDA */
export async function deriveEventPda(gameEngine: PublicKey, eventId: bigint | number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.EVENT, gameEngine.toBytes(), u64le(eventId)]);
}

/** Derive Event Participation PDA */
export async function deriveEventParticipationPda(
  gameEngine: PublicKey,
  eventId: bigint | number,
  playerOwner: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.EVENT_PARTICIPATION, gameEngine.toBytes(), u64le(eventId), playerOwner.toBytes()]);
}

// Progression System PDAs

/** Derive Progression PDA */
export async function deriveProgressionPda(player: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.PROGRESSION, player.toBytes()]);
}

// Research System PDAs

/** Derive Research Template PDA */
export async function deriveResearchTemplatePda(
  templateId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.RESEARCH_TEMPLATE, u8(templateId)]);
}

/** Derive Building Template PDA (one per BuildingType) */
export async function deriveBuildingTemplatePda(
  buildingType: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.BUILDING_TEMPLATE, u8(buildingType)]);
}

/** Derive Research Progress PDA */
export async function deriveResearchPda(player: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.RESEARCH, player.toBytes()]);
}

// Hero System PDAs

/** Derive Hero Template PDA */
export async function deriveHeroTemplatePda(templateId: number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.HERO_TEMPLATE, u16le(templateId)]);
}

/** Derive Hero Collection PDA */
export async function deriveHeroCollectionPda(): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.HERO_COLLECTION]);
}

/** Derive Hero Mint Receipt PDA (existence = player already minted this template) */
export async function deriveHeroMintReceiptPda(
  playerPda: PublicKey,
  templateId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.HERO_MINT_RECEIPT, playerPda.toBytes(), u16le(templateId)]);
}

// Shop System PDAs

/** Derive Shop Config PDA */
export async function deriveShopConfigPda(
  gameEngine: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.SHOP_CONFIG, gameEngine.toBytes()]);
}

/** Derive Shop Item PDA */
export async function deriveShopItemPda(
  gameEngine: PublicKey,
  itemId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.SHOP_ITEM, gameEngine.toBytes(), u32le(itemId)]);
}

/** Derive Bundle PDA */
export async function deriveBundlePda(
  gameEngine: PublicKey,
  bundleId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.BUNDLE, gameEngine.toBytes(), u32le(bundleId)]);
}

/** Derive Daily Deal PDA */
export async function deriveDailyDealPda(
  gameEngine: PublicKey,
  slotIndex: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.DAILY_DEAL, gameEngine.toBytes(), u8(slotIndex)]);
}

/** Derive Flash Sale PDA */
export async function deriveFlashSalePda(
  gameEngine: PublicKey,
  saleId: bigint | number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.FLASH_SALE, gameEngine.toBytes(), u64le(saleId)]);
}

/** Derive Weekly Sale PDA */
export async function deriveWeeklySalePda(
  gameEngine: PublicKey,
  weekNumber: bigint | number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.WEEKLY_SALE, gameEngine.toBytes(), u64le(weekNumber)]);
}

/** Derive Seasonal Sale PDA */
export async function deriveSeasonalSalePda(
  gameEngine: PublicKey,
  event: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.SEASONAL_SALE, gameEngine.toBytes(), event.toBytes()]);
}

/** Derive DAO Promotion PDA */
export async function deriveDaoPromotionPda(
  gameEngine: PublicKey,
  proposalId: bigint | number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.DAO_PROMOTION, gameEngine.toBytes(), u64le(proposalId)]);
}

/** Derive Player Purchase PDA */
export async function derivePlayerPurchasePda(
  player: PublicKey,
  itemId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.PLAYER_PURCHASE, player.toBytes(), u32le(itemId)]);
}

/**
 * Build a reverse lookup (PlayerPurchase PDA base58 -> itemId) for a wallet,
 * covering item ids 0..maxItemId. PlayerPurchase accounts store no itemId, so
 * this map is how a fetched account is matched back to its item.
 *
 * Async: derivation is async in v3; the per-id derivations run concurrently.
 */
export async function derivePlayerPurchaseIndex(
  wallet: PublicKey,
  maxItemId: number = 200
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    Array.from({ length: maxItemId }, async (_unused, i): Promise<[string, number]> => {
      const [pda] = await derivePlayerPurchasePda(wallet, i);
      return [pda.toBase58(), i];
    })
  );
  return new Map(entries);
}

/** Derive Inventory PDA */
export async function deriveInventoryPda(player: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.INVENTORY, player.toBytes()]);
}

/** Derive Allowed Token PDA */
export async function deriveAllowedTokenPda(
  gameEngine: PublicKey,
  tokenMint: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ALLOWED_TOKEN, gameEngine.toBytes(), tokenMint.toBytes()]);
}

/**
 * Derive the program-owned Switchboard oracle-quote PDA, keyed by queue.
 *
 * On-chain seeds: `["oracle_quote", switchboard_queue]`.
 */
export async function deriveOracleQuotePda(
  switchboardQueue: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ORACLE_QUOTE, switchboardQueue.toBytes()]);
}

// Estate System PDAs

/** Derive Estate PDA (scoped to player PDA) */
export async function deriveEstatePda(playerPda: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ESTATE, playerPda.toBytes()]);
}

/** Derive Crafted Equipment PDA */
export async function deriveCraftedEquipmentPda(
  owner: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.CRAFTED_EQUIPMENT, owner.toBytes()]);
}

// Expedition System PDAs

/**
 * Derive a player's Expedition PDA. Seeded by the PLAYER PDA (kingdom-scoped),
 * NOT the owner wallet — a wallet holds a distinct player per kingdom, so keying
 * by wallet would collide the expedition across kingdoms. Mirrors
 * `[EXPEDITION_SEED, player_account]` on-chain.
 */
export async function deriveExpeditionPda(playerPda: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.EXPEDITION, playerPda.toBytes()]);
}

// Arena System PDAs

/** Derive Arena Season PDA */
export async function deriveArenaSeasonPda(
  gameEngine: PublicKey,
  seasonId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ARENA_SEASON, gameEngine.toBytes(), u32le(seasonId)]);
}

/** Derive Arena Participant PDA */
export async function deriveArenaParticipantPda(
  gameEngine: PublicKey,
  seasonId: number,
  player: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ARENA_PARTICIPANT, gameEngine.toBytes(), u32le(seasonId), player.toBytes()]);
}

/** Derive Arena Loadout PDA (per-player, kingdom-scoped) */
export async function deriveArenaLoadoutPda(
  gameEngine: PublicKey,
  player: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.ARENA_LOADOUT, gameEngine.toBytes(), player.toBytes()]);
}

// Dungeon System PDAs

/** Derive Dungeon Template PDA */
export async function deriveDungeonTemplatePda(
  templateId: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.DUNGEON_TEMPLATE, u16le(templateId)]);
}

/** Derive Dungeon Run PDA */
export async function deriveDungeonRunPda(player: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.DUNGEON_RUN, player.toBytes()]);
}

/** Derive Dungeon Leaderboard PDA */
export async function deriveDungeonLeaderboardPda(
  gameEngine: PublicKey,
  dungeonId: number,
  weekNumber: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.DUNGEON_LEADERBOARD, gameEngine.toBytes(), u16le(dungeonId), u16le(weekNumber)]);
}

// Castle System PDAs

/** Derive Castle PDA from game engine, city ID and castle ID */
export async function deriveCastlePda(gameEngine: PublicKey, cityId: number, castleId: number): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.CASTLE, gameEngine.toBytes(), u16le(cityId), u16le(castleId)]);
}

/** Derive Court Position PDA */
export async function deriveCourtPda(
  castle: PublicKey,
  position: number
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.COURT, castle.toBytes(), u8(position)]);
}

/** Derive King Registry PDA */
export async function deriveKingRegistryPda(king: PublicKey): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.KING_REGISTRY, king.toBytes()]);
}

/** Derive Team Castle Reward PDA */
export async function deriveTeamCastleRewardPda(
  castle: PublicKey,
  team: PublicKey
): Promise<[PublicKey, number]> {
  return derive(PROGRAM_ID, [SEEDS.TEAM_CASTLE_REWARD, castle.toBytes(), team.toBytes()]);
}

// War Table PDAs

/**
 * Derive the DM thread PDA from the two participants' PlayerAccount PDAs.
 *
 * The operands are the PLAYER PDAs (not wallets), sorted lexicographically by
 * their raw 32 bytes so the result is symmetric: deriveDmThreadPda(A,B) ===
 * deriveDmThreadPda(B,A). Seeds [b"wt_dm", lo, hi]. Throws on equal players.
 */
export async function deriveDmThreadPda(
  playerPdaA: PublicKey,
  playerPdaB: PublicKey,
): Promise<[PublicKey, number]> {
  const a = playerPdaA.toBytes();
  const b = playerPdaB.toBytes();
  const cmp = compareBytes(a, b);
  if (cmp === 0) {
    throw new Error('DM thread requires two distinct players');
  }
  const [lo, hi] = cmp < 0 ? [a, b] : [b, a];
  return derive(PROGRAM_ID, [SEEDS.DM_THREAD, lo, hi]);
}

/** Lexicographic byte comparison (replaces Buffer.compare). */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// Name Service PDAs (ANS / TLD House)

/** Hash prefix for ALT Name Service */
const ANS_HASH_PREFIX = 'ALT Name Service';

/** Null pubkey for name service */
const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

/** Derive ANS name account PDA (forward lookup) */
export async function deriveNameAccountPda(
  domainName: string,
  nameParent: PublicKey
): Promise<[PublicKey, number]> {
  const hashedName = sha256(strBytes(ANS_HASH_PREFIX + domainName));
  return derive(ALT_NAME_SERVICE_PROGRAM_ID, [hashedName, NULL_PUBKEY.toBytes(), nameParent.toBytes()]);
}

/** Derive ANS reverse name account PDA */
export async function deriveReverseNameAccountPda(
  nameAccount: PublicKey,
  tldHouse: PublicKey
): Promise<[PublicKey, number]> {
  const hashedReverse = sha256(
    strBytes(ANS_HASH_PREFIX + nameAccount.toBase58())
  );
  return derive(ALT_NAME_SERVICE_PROGRAM_ID, [hashedReverse, tldHouse.toBytes(), NULL_PUBKEY.toBytes()]);
}

/** Derive TLD House MainDomain PDA */
export async function deriveMainDomainPda(owner: PublicKey): Promise<[PublicKey, number]> {
  return derive(TLD_HOUSE_PROGRAM_ID, [strBytes('main_domain'), owner.toBytes()]);
}

/** Derive TLD State PDA */
export async function deriveTldStatePda(): Promise<[PublicKey, number]> {
  return derive(TLD_HOUSE_PROGRAM_ID, [strBytes('tld_pda')]);
}

/** Derive TLD House PDA for a specific TLD */
export async function deriveTldHousePda(tld: string): Promise<[PublicKey, number]> {
  return derive(TLD_HOUSE_PROGRAM_ID, [strBytes('tld_house'), strBytes(tld.toLowerCase())]);
}

// Helper: Hash domain name for ANS

/** Get hashed name bytes for ANS operations */
export function getHashedName(domainName: string): Uint8Array {
  return sha256(strBytes(ANS_HASH_PREFIX + domainName));
}
