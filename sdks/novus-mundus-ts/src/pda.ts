/**
 * PDA Derivation Functions
 *
 * All Program Derived Address derivation functions for Novus Mundus.
 */

import { PublicKey } from '@solana/web3.js';
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

// Core Account PDAs

/** Derive GameEngine PDA for a specific kingdom */
export function deriveGameEnginePda(kingdomId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.GAME_ENGINE, u16le(kingdomId)],
    PROGRAM_ID
  );
}

/** Derive NOVI Mint PDA */
export function deriveNoviMintPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.NOVI_MINT], PROGRAM_ID);
}

/** Derive PlayerAccount PDA from game engine and owner wallet */
export function derivePlayerPda(gameEngine: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PLAYER, gameEngine.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive User PDA from wallet */
export function deriveUserPda(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.USER, wallet.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive City PDA from game engine and city ID */
export function deriveCityPda(gameEngine: PublicKey, cityId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CITY, gameEngine.toBuffer(), u16le(cityId)],
    PROGRAM_ID
  );
}

// Team System PDAs

/** Derive Team PDA from game engine and team ID */
export function deriveTeamPda(gameEngine: PublicKey, teamId: bigint | number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM, gameEngine.toBuffer(), u64le(teamId)],
    PROGRAM_ID
  );
}

/** Derive Team Member Slot PDA */
export function deriveTeamSlotPda(
  team: PublicKey,
  slotIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM_SLOT, team.toBuffer(), u16le(slotIndex)],
    PROGRAM_ID
  );
}

/** Derive Team Invite PDA */
export function deriveTeamInvitePda(
  team: PublicKey,
  invitee: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM_INVITE, team.toBuffer(), invitee.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Treasury Request PDA */
export function deriveTreasuryRequestPda(
  team: PublicKey,
  requester: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TREASURY_REQUEST, team.toBuffer(), requester.toBuffer()],
    PROGRAM_ID
  );
}

// Rally System PDAs

/** Derive Rally PDA */
export function deriveRallyPda(
  gameEngine: PublicKey,
  creator: PublicKey,
  rallyId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RALLY, gameEngine.toBuffer(), creator.toBuffer(), u64le(rallyId)],
    PROGRAM_ID
  );
}

/** Derive Rally Participant PDA */
export function deriveRallyParticipantPda(
  gameEngine: PublicKey,
  rallyCreator: PublicKey,
  rallyId: number | bigint,
  participant: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RALLY_PARTICIPANT, gameEngine.toBuffer(), rallyCreator.toBuffer(), u64le(rallyId), participant.toBuffer()],
    PROGRAM_ID
  );
}

// Reinforcement System PDAs

/** Derive Reinforcement PDA (player-to-player) */
export function deriveReinforcementPda(
  gameEngine: PublicKey,
  sender: PublicKey,
  receiver: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.REINFORCEMENT, gameEngine.toBuffer(), sender.toBuffer(), receiver.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Garrison Reinforcement PDA (player-to-castle) */
export function deriveGarrisonReinforcementPda(
  gameEngine: PublicKey,
  sender: PublicKey,
  castle: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.GARRISON, gameEngine.toBuffer(), sender.toBuffer(), castle.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Garrison Contribution PDA */
export function deriveGarrisonPda(
  castle: PublicKey,
  player: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.GARRISON, castle.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  );
}

// Location PDAs

/** Derive Location PDA from game engine, city and grid coordinates */
export function deriveLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  gridLat: number,
  gridLong: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.LOCATION, gameEngine.toBuffer(), u16le(cityId), i32le(gridLat), i32le(gridLong)],
    PROGRAM_ID
  );
}

// Encounter & Loot PDAs

/** Derive Encounter PDA */
export function deriveEncounterPda(
  gameEngine: PublicKey,
  cityId: number,
  encounterId: bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ENCOUNTER, gameEngine.toBuffer(), u16le(cityId), u64le(encounterId)],
    PROGRAM_ID
  );
}

/** Derive Loot PDA: [b"loot", player_pda, loot_id_le] */
export function deriveLootPda(
  playerPda: PublicKey,
  lootId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.LOOT, playerPda.toBuffer(), u64le(lootId)],
    PROGRAM_ID
  );
}

// Event System PDAs

/** Derive Event PDA */
export function deriveEventPda(gameEngine: PublicKey, eventId: bigint | number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EVENT, gameEngine.toBuffer(), u64le(eventId)],
    PROGRAM_ID
  );
}

/** Derive Event Participation PDA */
export function deriveEventParticipationPda(
  gameEngine: PublicKey,
  eventId: bigint | number,
  playerOwner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EVENT_PARTICIPATION, gameEngine.toBuffer(), u64le(eventId), playerOwner.toBuffer()],
    PROGRAM_ID
  );
}

// Progression System PDAs

/** Derive Progression PDA */
export function deriveProgressionPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PROGRESSION, player.toBuffer()],
    PROGRAM_ID
  );
}

// Research System PDAs

/** Derive Research Template PDA */
export function deriveResearchTemplatePda(
  templateId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RESEARCH_TEMPLATE, u8(templateId)],
    PROGRAM_ID
  );
}

/** Derive Building Template PDA (one per BuildingType) */
export function deriveBuildingTemplatePda(
  buildingType: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.BUILDING_TEMPLATE, u8(buildingType)],
    PROGRAM_ID
  );
}

/** Derive Research Progress PDA */
export function deriveResearchPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RESEARCH, player.toBuffer()],
    PROGRAM_ID
  );
}

// Hero System PDAs

/** Derive Hero Template PDA */
export function deriveHeroTemplatePda(templateId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.HERO_TEMPLATE, u16le(templateId)],
    PROGRAM_ID
  );
}

/** Derive Hero Collection PDA */
export function deriveHeroCollectionPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.HERO_COLLECTION], PROGRAM_ID);
}

/** Derive Hero Mint Receipt PDA (existence = player already minted this template) */
export function deriveHeroMintReceiptPda(
  playerPda: PublicKey,
  templateId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.HERO_MINT_RECEIPT, playerPda.toBuffer(), u16le(templateId)],
    PROGRAM_ID
  );
}

// Shop System PDAs

/** Derive Shop Config PDA */
export function deriveShopConfigPda(
  gameEngine: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SHOP_CONFIG, gameEngine.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Shop Item PDA */
export function deriveShopItemPda(
  gameEngine: PublicKey,
  itemId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SHOP_ITEM, gameEngine.toBuffer(), u32le(itemId)],
    PROGRAM_ID
  );
}

/** Derive Bundle PDA */
export function deriveBundlePda(
  gameEngine: PublicKey,
  bundleId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.BUNDLE, gameEngine.toBuffer(), u32le(bundleId)],
    PROGRAM_ID
  );
}

/** Derive Daily Deal PDA */
export function deriveDailyDealPda(
  gameEngine: PublicKey,
  slotIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DAILY_DEAL, gameEngine.toBuffer(), u8(slotIndex)],
    PROGRAM_ID
  );
}

/** Derive Flash Sale PDA */
export function deriveFlashSalePda(
  gameEngine: PublicKey,
  saleId: bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.FLASH_SALE, gameEngine.toBuffer(), u64le(saleId)],
    PROGRAM_ID
  );
}

/** Derive Weekly Sale PDA */
export function deriveWeeklySalePda(
  gameEngine: PublicKey,
  weekNumber: bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.WEEKLY_SALE, gameEngine.toBuffer(), u64le(weekNumber)],
    PROGRAM_ID
  );
}

/** Derive Seasonal Sale PDA */
export function deriveSeasonalSalePda(
  gameEngine: PublicKey,
  event: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SEASONAL_SALE, gameEngine.toBuffer(), event.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive DAO Promotion PDA */
export function deriveDaoPromotionPda(
  gameEngine: PublicKey,
  proposalId: bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DAO_PROMOTION, gameEngine.toBuffer(), u64le(proposalId)],
    PROGRAM_ID
  );
}

/** Derive Player Purchase PDA */
export function derivePlayerPurchasePda(
  player: PublicKey,
  itemId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PLAYER_PURCHASE, player.toBuffer(), u32le(itemId)],
    PROGRAM_ID
  );
}

/**
 * Build a reverse lookup (PlayerPurchase PDA base58 -> itemId) for a wallet,
 * covering item ids 0..maxItemId. PlayerPurchase accounts store no itemId, so
 * this map is how a fetched account is matched back to its item.
 */
export function derivePlayerPurchaseIndex(
  wallet: PublicKey,
  maxItemId: number = 200
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < maxItemId; i++) {
    map.set(derivePlayerPurchasePda(wallet, i)[0].toBase58(), i);
  }
  return map;
}

/** Derive Inventory PDA */
export function deriveInventoryPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.INVENTORY, player.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Allowed Token PDA */
export function deriveAllowedTokenPda(
  gameEngine: PublicKey,
  tokenMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ALLOWED_TOKEN, gameEngine.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive the program-owned Switchboard oracle-quote PDA, keyed by queue.
 *
 * On-chain seeds: `["oracle_quote", switchboard_queue]`.
 */
export function deriveOracleQuotePda(
  switchboardQueue: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ORACLE_QUOTE, switchboardQueue.toBuffer()],
    PROGRAM_ID
  );
}

// Estate System PDAs

/** Derive Estate PDA (scoped to player PDA) */
export function deriveEstatePda(playerPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ESTATE, playerPda.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Crafted Equipment PDA */
export function deriveCraftedEquipmentPda(
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CRAFTED_EQUIPMENT, owner.toBuffer()],
    PROGRAM_ID
  );
}

// Expedition System PDAs

/** Derive Expedition PDA for a player */
export function deriveExpeditionPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EXPEDITION, owner.toBuffer()],
    PROGRAM_ID
  );
}

// Arena System PDAs

/** Derive Arena Season PDA */
export function deriveArenaSeasonPda(
  gameEngine: PublicKey,
  seasonId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_SEASON, gameEngine.toBuffer(), u32le(seasonId)],
    PROGRAM_ID
  );
}

/** Derive Arena Participant PDA */
export function deriveArenaParticipantPda(
  gameEngine: PublicKey,
  seasonId: number,
  player: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_PARTICIPANT, gameEngine.toBuffer(), u32le(seasonId), player.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Arena Loadout PDA (per-player, kingdom-scoped) */
export function deriveArenaLoadoutPda(
  gameEngine: PublicKey,
  player: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_LOADOUT, gameEngine.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  );
}

// Dungeon System PDAs

/** Derive Dungeon Template PDA */
export function deriveDungeonTemplatePda(
  templateId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DUNGEON_TEMPLATE, u16le(templateId)],
    PROGRAM_ID
  );
}

/** Derive Dungeon Run PDA */
export function deriveDungeonRunPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DUNGEON_RUN, player.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Dungeon Leaderboard PDA */
export function deriveDungeonLeaderboardPda(
  gameEngine: PublicKey,
  dungeonId: number,
  weekNumber: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DUNGEON_LEADERBOARD, gameEngine.toBuffer(), u16le(dungeonId), u16le(weekNumber)],
    PROGRAM_ID
  );
}

// Castle System PDAs

/** Derive Castle PDA from game engine, city ID and castle ID */
export function deriveCastlePda(gameEngine: PublicKey, cityId: number, castleId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CASTLE, gameEngine.toBuffer(), u16le(cityId), u16le(castleId)],
    PROGRAM_ID
  );
}

/** Derive Court Position PDA */
export function deriveCourtPda(
  castle: PublicKey,
  position: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.COURT, castle.toBuffer(), u8(position)],
    PROGRAM_ID
  );
}

/** Derive King Registry PDA */
export function deriveKingRegistryPda(king: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.KING_REGISTRY, king.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Team Castle Reward PDA */
export function deriveTeamCastleRewardPda(
  castle: PublicKey,
  team: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM_CASTLE_REWARD, castle.toBuffer(), team.toBuffer()],
    PROGRAM_ID
  );
}

// War Table PDAs

/**
 * Derive the DM thread PDA from the two participants' PlayerAccount PDAs.
 *
 * The operands are the PLAYER PDAs (not wallets), sorted lexicographically by
 * their raw 32 bytes so the result is symmetric: deriveDmThreadPda(A,B) ===
 * deriveDmThreadPda(B,A). Seeds [b"wt_dm", lo, hi]. Throws on equal players.
 */
export function deriveDmThreadPda(
  playerPdaA: PublicKey,
  playerPdaB: PublicKey,
): [PublicKey, number] {
  const a = playerPdaA.toBuffer();
  const b = playerPdaB.toBuffer();
  const cmp = Buffer.compare(a as Uint8Array, b as Uint8Array);
  if (cmp === 0) {
    throw new Error('DM thread requires two distinct players');
  }
  const [lo, hi] = cmp < 0 ? [a, b] : [b, a];
  return PublicKey.findProgramAddressSync([SEEDS.DM_THREAD, lo, hi], PROGRAM_ID);
}

// Name Service PDAs (ANS / TLD House)

/** Hash prefix for ALT Name Service */
const ANS_HASH_PREFIX = 'ALT Name Service';

/** Null pubkey for name service */
const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

/** Derive ANS name account PDA (forward lookup) */
export function deriveNameAccountPda(
  domainName: string,
  nameParent: PublicKey
): [PublicKey, number] {
  const hashedName = sha256(strBytes(ANS_HASH_PREFIX + domainName));
  return PublicKey.findProgramAddressSync(
    [hashedName, NULL_PUBKEY.toBuffer(), nameParent.toBuffer()],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

/** Derive ANS reverse name account PDA */
export function deriveReverseNameAccountPda(
  nameAccount: PublicKey,
  tldHouse: PublicKey
): [PublicKey, number] {
  const hashedReverse = sha256(
    strBytes(ANS_HASH_PREFIX + nameAccount.toBase58())
  );
  return PublicKey.findProgramAddressSync(
    [hashedReverse, tldHouse.toBuffer(), NULL_PUBKEY.toBuffer()],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

/** Derive TLD House MainDomain PDA */
export function deriveMainDomainPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [strBytes('main_domain'), owner.toBuffer()],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD State PDA */
export function deriveTldStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [strBytes('tld_pda')],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD House PDA for a specific TLD */
export function deriveTldHousePda(tld: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [strBytes('tld_house'), strBytes(tld.toLowerCase())],
    TLD_HOUSE_PROGRAM_ID
  );
}

// Helper: Hash domain name for ANS

/** Get hashed name bytes for ANS operations */
export function getHashedName(domainName: string): Uint8Array {
  return sha256(strBytes(ANS_HASH_PREFIX + domainName));
}
