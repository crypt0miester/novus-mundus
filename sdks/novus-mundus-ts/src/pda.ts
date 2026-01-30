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
} from './program.ts';

// ============================================================
// Core Account PDAs
// ============================================================

/** Derive GameEngine PDA for a specific kingdom */
export function deriveGameEnginePda(kingdomId: number): [PublicKey, number] {
  const kingdomIdBuffer = Buffer.alloc(2);
  kingdomIdBuffer.writeUInt16LE(kingdomId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.GAME_ENGINE, kingdomIdBuffer],
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
  const cityIdBuffer = Buffer.alloc(2);
  cityIdBuffer.writeUInt16LE(cityId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.CITY, gameEngine.toBuffer(), cityIdBuffer],
    PROGRAM_ID
  );
}

// ============================================================
// Team System PDAs
// ============================================================

/** Derive Team PDA from game engine and team ID */
export function deriveTeamPda(gameEngine: PublicKey, teamId: bigint | number): [PublicKey, number] {
  const teamIdBuffer = Buffer.alloc(8);
  teamIdBuffer.writeBigUInt64LE(BigInt(teamId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM, gameEngine.toBuffer(), teamIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Team Member Slot PDA */
export function deriveTeamSlotPda(
  team: PublicKey,
  slotIndex: number
): [PublicKey, number] {
  const slotBuffer = Buffer.alloc(2);
  slotBuffer.writeUInt16LE(slotIndex);
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM_SLOT, team.toBuffer(), slotBuffer],
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

// ============================================================
// Rally System PDAs
// ============================================================

/** Derive Rally PDA */
export function deriveRallyPda(
  gameEngine: PublicKey,
  creator: PublicKey,
  rallyId: number | bigint
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(rallyId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.RALLY, gameEngine.toBuffer(), creator.toBuffer(), idBuffer],
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
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(rallyId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.RALLY_PARTICIPANT, gameEngine.toBuffer(), rallyCreator.toBuffer(), idBuffer, participant.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================
// Reinforcement System PDAs
// ============================================================

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

// ============================================================
// Location PDAs
// ============================================================

/** Derive Location PDA from game engine, city and grid coordinates */
export function deriveLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  gridLat: number,
  gridLong: number
): [PublicKey, number] {
  const cityIdBuffer = Buffer.alloc(2);
  cityIdBuffer.writeUInt16LE(cityId);
  const latBuffer = Buffer.alloc(4);
  latBuffer.writeInt32LE(gridLat);
  const longBuffer = Buffer.alloc(4);
  longBuffer.writeInt32LE(gridLong);
  return PublicKey.findProgramAddressSync(
    [SEEDS.LOCATION, gameEngine.toBuffer(), cityIdBuffer, latBuffer, longBuffer],
    PROGRAM_ID
  );
}

// ============================================================
// Encounter & Loot PDAs
// ============================================================

/** Derive Encounter PDA */
export function deriveEncounterPda(
  gameEngine: PublicKey,
  cityId: number,
  encounterId: bigint | number
): [PublicKey, number] {
  const cityIdBuffer = Buffer.alloc(2);
  cityIdBuffer.writeUInt16LE(cityId);
  const encounterIdBuffer = Buffer.alloc(8);
  encounterIdBuffer.writeBigUInt64LE(BigInt(encounterId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.ENCOUNTER, gameEngine.toBuffer(), cityIdBuffer, encounterIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Loot PDA */
export function deriveLootPda(
  encounter: PublicKey,
  attacker: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.LOOT, encounter.toBuffer(), attacker.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================
// Event System PDAs
// ============================================================

/** Derive Event PDA */
export function deriveEventPda(gameEngine: PublicKey, eventId: bigint | number): [PublicKey, number] {
  const eventIdBuffer = Buffer.alloc(8);
  eventIdBuffer.writeBigUInt64LE(BigInt(eventId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.EVENT, gameEngine.toBuffer(), eventIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Event Participation PDA */
export function deriveEventParticipationPda(
  gameEngine: PublicKey,
  eventId: bigint | number,
  playerOwner: PublicKey
): [PublicKey, number] {
  const eventIdBuffer = Buffer.alloc(8);
  eventIdBuffer.writeBigUInt64LE(BigInt(eventId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.EVENT_PARTICIPATION, gameEngine.toBuffer(), eventIdBuffer, playerOwner.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================
// Progression System PDAs
// ============================================================

/** Derive Progression PDA */
export function deriveProgressionPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PROGRESSION, player.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================
// Research System PDAs
// ============================================================

/** Derive Research Template PDA */
export function deriveResearchTemplatePda(
  templateId: number
): [PublicKey, number] {
  const templateIdBuffer = Buffer.alloc(2);
  templateIdBuffer.writeUInt16LE(templateId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.RESEARCH_TEMPLATE, templateIdBuffer],
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

// ============================================================
// Hero System PDAs
// ============================================================

/** Derive Hero Template PDA */
export function deriveHeroTemplatePda(templateId: number): [PublicKey, number] {
  const templateIdBuffer = Buffer.alloc(2);
  templateIdBuffer.writeUInt16LE(templateId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.HERO_TEMPLATE, templateIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Hero Collection PDA */
export function deriveHeroCollectionPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.HERO_COLLECTION], PROGRAM_ID);
}

// ============================================================
// Shop System PDAs
// ============================================================

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
  const itemIdBuffer = Buffer.alloc(4);
  itemIdBuffer.writeUInt32LE(itemId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.SHOP_ITEM, gameEngine.toBuffer(), itemIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Bundle PDA */
export function deriveBundlePda(
  gameEngine: PublicKey,
  bundleId: number
): [PublicKey, number] {
  const bundleIdBuffer = Buffer.alloc(4);
  bundleIdBuffer.writeUInt32LE(bundleId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.BUNDLE, gameEngine.toBuffer(), bundleIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Daily Deal PDA */
export function deriveDailyDealPda(
  gameEngine: PublicKey,
  slotIndex: number
): [PublicKey, number] {
  const slotBuffer = Buffer.alloc(1);
  slotBuffer.writeUInt8(slotIndex);
  return PublicKey.findProgramAddressSync(
    [SEEDS.DAILY_DEAL, gameEngine.toBuffer(), slotBuffer],
    PROGRAM_ID
  );
}

/** Derive Flash Sale PDA */
export function deriveFlashSalePda(
  gameEngine: PublicKey,
  saleId: bigint | number
): [PublicKey, number] {
  const saleIdBuffer = Buffer.alloc(8);
  saleIdBuffer.writeBigUInt64LE(BigInt(saleId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.FLASH_SALE, gameEngine.toBuffer(), saleIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Weekly Sale PDA */
export function deriveWeeklySalePda(
  gameEngine: PublicKey,
  weekNumber: bigint | number
): [PublicKey, number] {
  const weekBuffer = Buffer.alloc(8);
  weekBuffer.writeBigUInt64LE(BigInt(weekNumber));
  return PublicKey.findProgramAddressSync(
    [SEEDS.WEEKLY_SALE, gameEngine.toBuffer(), weekBuffer],
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
  const proposalIdBuffer = Buffer.alloc(8);
  proposalIdBuffer.writeBigUInt64LE(BigInt(proposalId));
  return PublicKey.findProgramAddressSync(
    [SEEDS.DAO_PROMOTION, gameEngine.toBuffer(), proposalIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Player Purchase PDA */
export function derivePlayerPurchasePda(
  player: PublicKey,
  itemId: number
): [PublicKey, number] {
  const itemIdBuffer = Buffer.alloc(4);
  itemIdBuffer.writeUInt32LE(itemId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.PLAYER_PURCHASE, player.toBuffer(), itemIdBuffer],
    PROGRAM_ID
  );
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

// ============================================================
// Estate System PDAs
// ============================================================

/** Derive Estate PDA */
export function deriveEstatePda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ESTATE, owner.toBuffer()],
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

// ============================================================
// Expedition System PDAs
// ============================================================

/** Derive Expedition PDA for a player */
export function deriveExpeditionPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EXPEDITION, owner.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================
// Arena System PDAs
// ============================================================

/** Derive Arena Season PDA */
export function deriveArenaSeasonPda(
  gameEngine: PublicKey,
  seasonId: number
): [PublicKey, number] {
  const seasonIdBuffer = Buffer.alloc(4);
  seasonIdBuffer.writeUInt32LE(seasonId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_SEASON, gameEngine.toBuffer(), seasonIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Arena Participant PDA */
export function deriveArenaParticipantPda(
  gameEngine: PublicKey,
  seasonId: number,
  player: PublicKey
): [PublicKey, number] {
  const seasonIdBuffer = Buffer.alloc(4);
  seasonIdBuffer.writeUInt32LE(seasonId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_PARTICIPANT, gameEngine.toBuffer(), seasonIdBuffer, player.toBuffer()],
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

// ============================================================
// Dungeon System PDAs
// ============================================================

/** Derive Dungeon Template PDA */
export function deriveDungeonTemplatePda(
  templateId: number
): [PublicKey, number] {
  const templateIdBuffer = Buffer.alloc(2);
  templateIdBuffer.writeUInt16LE(templateId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.DUNGEON_TEMPLATE, templateIdBuffer],
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
  const dungeonIdBuffer = Buffer.alloc(2);
  dungeonIdBuffer.writeUInt16LE(dungeonId);
  const weekBuffer = Buffer.alloc(2);
  weekBuffer.writeUInt16LE(weekNumber);
  return PublicKey.findProgramAddressSync(
    [SEEDS.DUNGEON_LEADERBOARD, gameEngine.toBuffer(), dungeonIdBuffer, weekBuffer],
    PROGRAM_ID
  );
}

// ============================================================
// Castle System PDAs
// ============================================================

/** Derive Castle PDA from game engine, city ID and castle ID */
export function deriveCastlePda(gameEngine: PublicKey, cityId: number, castleId: number): [PublicKey, number] {
  const cityIdBuffer = Buffer.alloc(2);
  cityIdBuffer.writeUInt16LE(cityId);
  const castleIdBuffer = Buffer.alloc(2);
  castleIdBuffer.writeUInt16LE(castleId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.CASTLE, gameEngine.toBuffer(), cityIdBuffer, castleIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Court Position PDA */
export function deriveCourtPda(
  castle: PublicKey,
  position: number
): [PublicKey, number] {
  const positionBuffer = Buffer.alloc(1);
  positionBuffer.writeUInt8(position);
  return PublicKey.findProgramAddressSync(
    [SEEDS.COURT, castle.toBuffer(), positionBuffer],
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

// ============================================================
// Name Service PDAs (ANS / TLD House)
// ============================================================

/** Hash prefix for ALT Name Service */
const ANS_HASH_PREFIX = 'ALT Name Service';

/** Null pubkey for name service */
const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

/** Derive ANS name account PDA (forward lookup) */
export function deriveNameAccountPda(
  domainName: string,
  nameParent: PublicKey
): [PublicKey, number] {
  const hashedName = sha256(Buffer.from(ANS_HASH_PREFIX + domainName));
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
    Buffer.from(ANS_HASH_PREFIX + nameAccount.toBase58())
  );
  return PublicKey.findProgramAddressSync(
    [hashedReverse, tldHouse.toBuffer(), NULL_PUBKEY.toBuffer()],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

/** Derive TLD House MainDomain PDA */
export function deriveMainDomainPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('main_domain'), owner.toBuffer()],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD State PDA */
export function deriveTldStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('tld_pda')],
    TLD_HOUSE_PROGRAM_ID
  );
}

/** Derive TLD House PDA for a specific TLD */
export function deriveTldHousePda(tld: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('tld_house'), Buffer.from(tld.toLowerCase())],
    TLD_HOUSE_PROGRAM_ID
  );
}

// ============================================================
// Helper: Hash domain name for ANS
// ============================================================

/** Get hashed name bytes for ANS operations */
export function getHashedName(domainName: string): Uint8Array {
  return sha256(Buffer.from(ANS_HASH_PREFIX + domainName));
}
