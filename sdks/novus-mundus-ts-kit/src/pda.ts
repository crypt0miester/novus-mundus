/**
 * PDA Derivation Functions
 *
 * All Program Derived Address derivation functions for Novus Mundus.
 */

import type { Address } from '@solana/kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { findProgramAddressSync, addressBytes } from './crypto';
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
export function deriveGameEnginePda(kingdomId: number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.GAME_ENGINE, u16le(kingdomId)],
    PROGRAM_ID
  );
}

/** Derive NOVI Mint PDA */
export function deriveNoviMintPda(): [Address, number] {
  return findProgramAddressSync([SEEDS.NOVI_MINT], PROGRAM_ID);
}

/** Derive PlayerAccount PDA from game engine and owner wallet */
export function derivePlayerPda(gameEngine: Address, owner: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.PLAYER, addressBytes(gameEngine), addressBytes(owner)],
    PROGRAM_ID
  );
}

/** Derive User PDA from wallet */
export function deriveUserPda(wallet: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.USER, addressBytes(wallet)],
    PROGRAM_ID
  );
}

/** Derive City PDA from game engine and city ID */
export function deriveCityPda(gameEngine: Address, cityId: number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.CITY, addressBytes(gameEngine), u16le(cityId)],
    PROGRAM_ID
  );
}

// Team System PDAs

/** Derive Team PDA from game engine and team ID */
export function deriveTeamPda(gameEngine: Address, teamId: bigint | number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.TEAM, addressBytes(gameEngine), u64le(teamId)],
    PROGRAM_ID
  );
}

/** Derive Team Member Slot PDA */
export function deriveTeamSlotPda(
  team: Address,
  slotIndex: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.TEAM_SLOT, addressBytes(team), u16le(slotIndex)],
    PROGRAM_ID
  );
}

/** Derive Team Invite PDA */
export function deriveTeamInvitePda(
  team: Address,
  invitee: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.TEAM_INVITE, addressBytes(team), addressBytes(invitee)],
    PROGRAM_ID
  );
}

/** Derive Treasury Request PDA */
export function deriveTreasuryRequestPda(
  team: Address,
  requester: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.TREASURY_REQUEST, addressBytes(team), addressBytes(requester)],
    PROGRAM_ID
  );
}

// Rally System PDAs

/** Derive Rally PDA */
export function deriveRallyPda(
  gameEngine: Address,
  creator: Address,
  rallyId: number | bigint
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.RALLY, addressBytes(gameEngine), addressBytes(creator), u64le(rallyId)],
    PROGRAM_ID
  );
}

/** Derive Rally Participant PDA */
export function deriveRallyParticipantPda(
  gameEngine: Address,
  rallyCreator: Address,
  rallyId: number | bigint,
  participant: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.RALLY_PARTICIPANT, addressBytes(gameEngine), addressBytes(rallyCreator), u64le(rallyId), addressBytes(participant)],
    PROGRAM_ID
  );
}

// Reinforcement System PDAs

/** Derive Reinforcement PDA (player-to-player) */
export function deriveReinforcementPda(
  gameEngine: Address,
  sender: Address,
  receiver: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.REINFORCEMENT, addressBytes(gameEngine), addressBytes(sender), addressBytes(receiver)],
    PROGRAM_ID
  );
}

/** Derive Garrison Reinforcement PDA (player-to-castle) */
export function deriveGarrisonReinforcementPda(
  gameEngine: Address,
  sender: Address,
  castle: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.GARRISON, addressBytes(gameEngine), addressBytes(sender), addressBytes(castle)],
    PROGRAM_ID
  );
}

/** Derive Garrison Contribution PDA */
export function deriveGarrisonPda(
  castle: Address,
  player: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.GARRISON, addressBytes(castle), addressBytes(player)],
    PROGRAM_ID
  );
}

// Location PDAs

/** Derive Location PDA from game engine, city and grid coordinates */
export function deriveLocationPda(
  gameEngine: Address,
  cityId: number,
  gridLat: number,
  gridLong: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.LOCATION, addressBytes(gameEngine), u16le(cityId), i32le(gridLat), i32le(gridLong)],
    PROGRAM_ID
  );
}

// Encounter & Loot PDAs

/** Derive Encounter PDA */
export function deriveEncounterPda(
  gameEngine: Address,
  cityId: number,
  encounterId: bigint | number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ENCOUNTER, addressBytes(gameEngine), u16le(cityId), u64le(encounterId)],
    PROGRAM_ID
  );
}

/** Derive Loot PDA: [b"loot", player_pda, loot_id_le] */
export function deriveLootPda(
  playerPda: Address,
  lootId: number | bigint
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.LOOT, addressBytes(playerPda), u64le(lootId)],
    PROGRAM_ID
  );
}

// Event System PDAs

/** Derive Event PDA */
export function deriveEventPda(gameEngine: Address, eventId: bigint | number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.EVENT, addressBytes(gameEngine), u64le(eventId)],
    PROGRAM_ID
  );
}

/** Derive Event Participation PDA */
export function deriveEventParticipationPda(
  gameEngine: Address,
  eventId: bigint | number,
  playerOwner: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.EVENT_PARTICIPATION, addressBytes(gameEngine), u64le(eventId), addressBytes(playerOwner)],
    PROGRAM_ID
  );
}

// Progression System PDAs

/** Derive Progression PDA */
export function deriveProgressionPda(player: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.PROGRESSION, addressBytes(player)],
    PROGRAM_ID
  );
}

// Research System PDAs

/** Derive Research Template PDA */
export function deriveResearchTemplatePda(
  templateId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.RESEARCH_TEMPLATE, u8(templateId)],
    PROGRAM_ID
  );
}

/** Derive Research Progress PDA */
export function deriveResearchPda(player: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.RESEARCH, addressBytes(player)],
    PROGRAM_ID
  );
}

// Hero System PDAs

/** Derive Hero Template PDA */
export function deriveHeroTemplatePda(templateId: number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.HERO_TEMPLATE, u16le(templateId)],
    PROGRAM_ID
  );
}

/** Derive Hero Collection PDA */
export function deriveHeroCollectionPda(): [Address, number] {
  return findProgramAddressSync([SEEDS.HERO_COLLECTION], PROGRAM_ID);
}

/** Derive Hero Mint Receipt PDA (existence = player already minted this template) */
export function deriveHeroMintReceiptPda(
  playerPda: Address,
  templateId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.HERO_MINT_RECEIPT, addressBytes(playerPda), u16le(templateId)],
    PROGRAM_ID
  );
}

// Shop System PDAs

/** Derive Shop Config PDA */
export function deriveShopConfigPda(
  gameEngine: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.SHOP_CONFIG, addressBytes(gameEngine)],
    PROGRAM_ID
  );
}

/** Derive Shop Item PDA */
export function deriveShopItemPda(
  gameEngine: Address,
  itemId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.SHOP_ITEM, addressBytes(gameEngine), u32le(itemId)],
    PROGRAM_ID
  );
}

/** Derive Bundle PDA */
export function deriveBundlePda(
  gameEngine: Address,
  bundleId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.BUNDLE, addressBytes(gameEngine), u32le(bundleId)],
    PROGRAM_ID
  );
}

/** Derive Daily Deal PDA */
export function deriveDailyDealPda(
  gameEngine: Address,
  slotIndex: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.DAILY_DEAL, addressBytes(gameEngine), u8(slotIndex)],
    PROGRAM_ID
  );
}

/** Derive Flash Sale PDA */
export function deriveFlashSalePda(
  gameEngine: Address,
  saleId: bigint | number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.FLASH_SALE, addressBytes(gameEngine), u64le(saleId)],
    PROGRAM_ID
  );
}

/** Derive Weekly Sale PDA */
export function deriveWeeklySalePda(
  gameEngine: Address,
  weekNumber: bigint | number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.WEEKLY_SALE, addressBytes(gameEngine), u64le(weekNumber)],
    PROGRAM_ID
  );
}

/** Derive Seasonal Sale PDA */
export function deriveSeasonalSalePda(
  gameEngine: Address,
  event: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.SEASONAL_SALE, addressBytes(gameEngine), addressBytes(event)],
    PROGRAM_ID
  );
}

/** Derive DAO Promotion PDA */
export function deriveDaoPromotionPda(
  gameEngine: Address,
  proposalId: bigint | number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.DAO_PROMOTION, addressBytes(gameEngine), u64le(proposalId)],
    PROGRAM_ID
  );
}

/** Derive Player Purchase PDA */
export function derivePlayerPurchasePda(
  player: Address,
  itemId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.PLAYER_PURCHASE, addressBytes(player), u32le(itemId)],
    PROGRAM_ID
  );
}

/**
 * Build a reverse lookup (PlayerPurchase PDA base58 -> itemId) for a wallet,
 * covering item ids 0..maxItemId. PlayerPurchase accounts store no itemId, so
 * this map is how a fetched account is matched back to its item.
 */
export function derivePlayerPurchaseIndex(
  wallet: Address,
  maxItemId: number = 200
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < maxItemId; i++) {
    map.set(derivePlayerPurchasePda(wallet, i)[0], i);
  }
  return map;
}

/** Derive Inventory PDA */
export function deriveInventoryPda(player: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.INVENTORY, addressBytes(player)],
    PROGRAM_ID
  );
}

/** Derive Allowed Token PDA */
export function deriveAllowedTokenPda(
  gameEngine: Address,
  tokenMint: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ALLOWED_TOKEN, addressBytes(gameEngine), addressBytes(tokenMint)],
    PROGRAM_ID
  );
}

// Estate System PDAs

/** Derive Estate PDA (scoped to player PDA) */
export function deriveEstatePda(playerPda: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ESTATE, addressBytes(playerPda)],
    PROGRAM_ID
  );
}

/** Derive Crafted Equipment PDA */
export function deriveCraftedEquipmentPda(
  owner: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.CRAFTED_EQUIPMENT, addressBytes(owner)],
    PROGRAM_ID
  );
}

// Expedition System PDAs

/** Derive Expedition PDA for a player */
export function deriveExpeditionPda(owner: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.EXPEDITION, addressBytes(owner)],
    PROGRAM_ID
  );
}

// Arena System PDAs

/** Derive Arena Season PDA */
export function deriveArenaSeasonPda(
  gameEngine: Address,
  seasonId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ARENA_SEASON, addressBytes(gameEngine), u32le(seasonId)],
    PROGRAM_ID
  );
}

/** Derive Arena Participant PDA */
export function deriveArenaParticipantPda(
  gameEngine: Address,
  seasonId: number,
  player: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ARENA_PARTICIPANT, addressBytes(gameEngine), u32le(seasonId), addressBytes(player)],
    PROGRAM_ID
  );
}

/** Derive Arena Loadout PDA (per-player, kingdom-scoped) */
export function deriveArenaLoadoutPda(
  gameEngine: Address,
  player: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.ARENA_LOADOUT, addressBytes(gameEngine), addressBytes(player)],
    PROGRAM_ID
  );
}

// Dungeon System PDAs

/** Derive Dungeon Template PDA */
export function deriveDungeonTemplatePda(
  templateId: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.DUNGEON_TEMPLATE, u16le(templateId)],
    PROGRAM_ID
  );
}

/** Derive Dungeon Run PDA */
export function deriveDungeonRunPda(player: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.DUNGEON_RUN, addressBytes(player)],
    PROGRAM_ID
  );
}

/** Derive Dungeon Leaderboard PDA */
export function deriveDungeonLeaderboardPda(
  gameEngine: Address,
  dungeonId: number,
  weekNumber: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.DUNGEON_LEADERBOARD, addressBytes(gameEngine), u16le(dungeonId), u16le(weekNumber)],
    PROGRAM_ID
  );
}

// Castle System PDAs

/** Derive Castle PDA from game engine, city ID and castle ID */
export function deriveCastlePda(gameEngine: Address, cityId: number, castleId: number): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.CASTLE, addressBytes(gameEngine), u16le(cityId), u16le(castleId)],
    PROGRAM_ID
  );
}

/** Derive Court Position PDA */
export function deriveCourtPda(
  castle: Address,
  position: number
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.COURT, addressBytes(castle), u8(position)],
    PROGRAM_ID
  );
}

/** Derive King Registry PDA */
export function deriveKingRegistryPda(king: Address): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.KING_REGISTRY, addressBytes(king)],
    PROGRAM_ID
  );
}

/** Derive Team Castle Reward PDA */
export function deriveTeamCastleRewardPda(
  castle: Address,
  team: Address
): [Address, number] {
  return findProgramAddressSync(
    [SEEDS.TEAM_CASTLE_REWARD, addressBytes(castle), addressBytes(team)],
    PROGRAM_ID
  );
}

// Name Service PDAs (ANS / TLD House)

/** Hash prefix for ALT Name Service */
const ANS_HASH_PREFIX = 'ALT Name Service';

/** Null pubkey (32 zero bytes) used as a seed by the name service */
const NULL_ADDRESS_BYTES = new Uint8Array(32);

/** Derive ANS name account PDA (forward lookup) */
export function deriveNameAccountPda(
  domainName: string,
  nameParent: Address
): [Address, number] {
  const hashedName = sha256(strBytes(ANS_HASH_PREFIX + domainName));
  return findProgramAddressSync(
    [hashedName, NULL_ADDRESS_BYTES, addressBytes(nameParent)],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

/** Derive ANS reverse name account PDA */
export function deriveReverseNameAccountPda(
  nameAccount: Address,
  tldHouse: Address
): [Address, number] {
  const hashedReverse = sha256(
    strBytes(ANS_HASH_PREFIX + nameAccount)
  );
  return findProgramAddressSync(
    [hashedReverse, addressBytes(tldHouse), NULL_ADDRESS_BYTES],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

/** Derive TLD House MainDomain PDA */
export function deriveMainDomainPda(owner: Address): [Address, number] {
  return findProgramAddressSync(
    [strBytes('main_domain'), addressBytes(owner)],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD State PDA */
export function deriveTldStatePda(): [Address, number] {
  return findProgramAddressSync(
    [strBytes('tld_pda')],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD House PDA for a specific TLD */
export function deriveTldHousePda(tld: string): [Address, number] {
  return findProgramAddressSync(
    [strBytes('tld_house'), strBytes(tld.toLowerCase())],
    TLD_HOUSE_PROGRAM_ID
  );
}

// Helper: Hash domain name for ANS

/** Get hashed name bytes for ANS operations */
export function getHashedName(domainName: string): Uint8Array {
  return sha256(strBytes(ANS_HASH_PREFIX + domainName));
}
