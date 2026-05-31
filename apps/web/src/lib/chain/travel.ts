import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAttackEncounterInstruction,
  createAttackPlayerInstruction,
  createIntercityCancelInstruction,
  createIntercityCompleteInstruction,
  createIntercityStartInstruction,
  createIntercityTeleportInstruction,
  createIntracityCancelInstruction,
  createIntracityCompleteInstruction,
  createIntracityStartInstruction,
  createTravelSpeedupInstruction,
  deriveLocationPda,
  deriveLootPda,
  derivePlayerPda,
  toGrid,
  type CityAccount,
  type EncounterAccount,
  type PlayerCore,
} from "novus-mundus-sdk";

// Single source of truth for travel / strike instruction construction.
//
// Every travel and strike instruction addresses cells by their Location PDA,
// derived from (gameEngine, cityId, gridLat, gridLong), and carries a rent
// refund whose recipient is dictated by the on-chain program. Those rules were
// previously inlined ~16 times in map-tab and re-implemented again in
// TargetTravel / EncounterDetailPanel / ProximityGrid, where they could drift.
// They now live here, once, with the load-bearing chain comments as the spec.
//
// These builders are pure: they take typed game state and return instructions
// (plus, where the caller needs it for an optimistic store update, the resolved
// destination coords). UI state and `transact` orchestration stay in the hooks.

type CityCentre = Pick<CityAccount, "latitude" | "longitude">;
type SpeedupTier = 1 | 2;

// ── Location PDA helpers ──

/** Location PDA for the player's current chain position. */
export async function playerLocationPda(
  gameEngine: PublicKey,
  player: PlayerCore,
): Promise<PublicKey> {
  return (
    await deriveLocationPda(
      gameEngine,
      player.currentCity,
      toGrid(player.currentLat),
      toGrid(player.currentLong),
    )
  )[0];
}

/** Location PDA for a specific grid cell in a city (coords already in grid units). */
export async function cellLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  gridLat: number,
  gridLong: number,
): Promise<PublicKey> {
  return (await deriveLocationPda(gameEngine, cityId, gridLat, gridLong))[0];
}

/** Location PDA for a city's centre cell (from the CityAccount lat/long). */
export async function cityCentreLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  city: CityCentre,
): Promise<PublicKey> {
  return (
    await deriveLocationPda(gameEngine, cityId, toGrid(city.latitude), toGrid(city.longitude))
  )[0];
}

/** Location PDA for the player's in-flight destination (traveling_to_lat/long). */
async function travelingToLocationPda(
  gameEngine: PublicKey,
  cityId: number,
  player: PlayerCore,
): Promise<PublicKey> {
  return (
    await deriveLocationPda(
      gameEngine,
      cityId,
      toGrid(player.travelingToLat),
      toGrid(player.travelingToLong),
    )
  )[0];
}

// ── Intercity travel ──

export interface IntercityStartArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  /** The GameEngine authority; the on-chain origin-cell rent refund goes here. */
  gameAuthority: PublicKey | undefined;
  player: PlayerCore;
  destinationCityId: number;
  destGridLat: number;
  destGridLong: number;
}

export async function buildIntercityStartIx(
  a: IntercityStartArgs,
): Promise<TransactionInstruction> {
  return createIntercityStartInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    originCityId: a.player.currentCity,
    destinationCityId: a.destinationCityId,
    destGridLat: a.destGridLat,
    destGridLong: a.destGridLong,
    originLocation: await playerLocationPda(a.gameEngine, a.player),
    destinationLocation: await cellLocationPda(
      a.gameEngine,
      a.destinationCityId,
      a.destGridLat,
      a.destGridLong,
    ),
    // The origin cell's location_creator is the game authority, so its rent
    // refund routes there (owner only when the GameEngine isn't loaded yet).
    originCreatorRefund: a.gameAuthority ?? a.owner,
  });
}

export interface IntercityCompleteArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  player: PlayerCore;
  /** The origin city — required only when the player is returning home. */
  homeCity: CityCentre | undefined;
}

/**
 * Returns the complete instruction plus the resolved destination the caller
 * applies optimistically to the local player. intercity_cancel sends the player
 * back to the origin city CENTRE and sets destination_city = current_city while
 * leaving traveling_to_lat/long at the original forward destination; on that
 * return leg the reserved cell is the city centre, so deriving from
 * traveling_to_lat/long would address a non-existent (System-owned) PDA and the
 * ix would fail.
 */
export async function buildIntercityCompleteIx(a: IntercityCompleteArgs): Promise<{
  ix: TransactionInstruction;
  destinationCityId: number;
  destLat: number;
  destLong: number;
}> {
  const returningHome = a.player.destinationCity === a.player.currentCity;
  if (returningHome && !a.homeCity) throw new Error("Origin city not loaded");
  const destinationCityId = a.player.destinationCity;
  const destLat = returningHome ? a.homeCity!.latitude : a.player.travelingToLat;
  const destLong = returningHome ? a.homeCity!.longitude : a.player.travelingToLong;
  const ix = await createIntercityCompleteInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    originCityId: a.player.currentCity,
    destinationCityId,
    destinationLocation: (
      await deriveLocationPda(a.gameEngine, destinationCityId, toGrid(destLat), toGrid(destLong))
    )[0],
  });
  return { ix, destinationCityId, destLat, destLong };
}

export interface IntercityCancelArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  player: PlayerCore;
  /** The origin city — its centre is the reserved cell on cancel. */
  originCity: CityCentre;
}

export async function buildIntercityCancelIx(
  a: IntercityCancelArgs,
): Promise<TransactionInstruction> {
  return createIntercityCancelInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    originCityId: a.player.currentCity,
    destinationCityId: a.player.destinationCity,
    originLocation: await cityCentreLocationPda(a.gameEngine, a.player.currentCity, a.originCity),
    destinationLocation: await travelingToLocationPda(
      a.gameEngine,
      a.player.destinationCity,
      a.player,
    ),
    // intercity_start stamps the destination cell's location_creator with the
    // traveling player's wallet and intercity_cancel refunds its rent there —
    // any other account trips GameError::InvalidParameter (6007).
    destinationCreatorRefund: a.owner,
  });
}

export interface IntercityTeleportArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  player: PlayerCore;
  destinationCityId: number;
  destGridLat: number;
  destGridLong: number;
}

export async function buildIntercityTeleportIx(
  a: IntercityTeleportArgs,
): Promise<TransactionInstruction> {
  return createIntercityTeleportInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    originCityId: a.player.currentCity,
    destinationCityId: a.destinationCityId,
    originLocation: await playerLocationPda(a.gameEngine, a.player),
    destinationLocation: await cellLocationPda(
      a.gameEngine,
      a.destinationCityId,
      a.destGridLat,
      a.destGridLong,
    ),
  });
}

export interface TravelSpeedupArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  tier: SpeedupTier;
  /** Number of speedups to pack into one tx (hold-to-charge); clamped to >= 1. */
  count?: number;
}

export function buildTravelSpeedupIxs(a: TravelSpeedupArgs): Promise<TransactionInstruction[]> {
  const n = Math.max(1, Math.floor(a.count ?? 1));
  return Promise.all(
    Array.from({ length: n }, () =>
      createTravelSpeedupInstruction(
        { owner: a.owner, gameEngine: a.gameEngine },
        { speedupTier: a.tier },
      ),
    ),
  );
}

// ── Intracity travel ──

export interface IntracityStartArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  gameAuthority: PublicKey | undefined;
  player: PlayerCore;
  targetGridLat: number;
  targetGridLong: number;
}

export async function buildIntracityStartIx(
  a: IntracityStartArgs,
): Promise<TransactionInstruction> {
  const cityId = a.player.currentCity;
  return createIntracityStartInstruction(
    {
      owner: a.owner,
      gameEngine: a.gameEngine,
      cityId,
      originLocation: await playerLocationPda(a.gameEngine, a.player),
      destinationLocation: await cellLocationPda(
        a.gameEngine,
        cityId,
        a.targetGridLat,
        a.targetGridLong,
      ),
      originCreatorRefund: a.gameAuthority ?? a.owner,
    },
    { destinationLat: a.targetGridLat / 10000, destinationLong: a.targetGridLong / 10000 },
  );
}

export interface IntracityCompleteArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  player: PlayerCore;
}

/** Returns the complete instruction plus the destination for the optimistic store update. */
export async function buildIntracityCompleteIx(a: IntracityCompleteArgs): Promise<{
  ix: TransactionInstruction;
  destLat: number;
  destLong: number;
}> {
  const cityId = a.player.currentCity;
  const destLat = a.player.travelingToLat;
  const destLong = a.player.travelingToLong;
  const ix = await createIntracityCompleteInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    cityId,
    destinationLocation: (
      await deriveLocationPda(a.gameEngine, cityId, toGrid(destLat), toGrid(destLong))
    )[0],
  });
  return { ix, destLat, destLong };
}

export interface IntracityCancelArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  player: PlayerCore;
}

export async function buildIntracityCancelIx(
  a: IntracityCancelArgs,
): Promise<TransactionInstruction> {
  const cityId = a.player.currentCity;
  return createIntracityCancelInstruction({
    owner: a.owner,
    gameEngine: a.gameEngine,
    cityId,
    originLocation: await playerLocationPda(a.gameEngine, a.player),
    destinationLocation: await travelingToLocationPda(a.gameEngine, cityId, a.player),
    // intracity_start sets dest_location.location_creator = owner, so the refund
    // of the freed destination cell must go to the player wallet.
    destinationCreatorRefund: a.owner,
  });
}

// ── Strikes ──

export interface AttackEncounterArgs {
  owner: PublicKey;
  gameEngine: PublicKey;
  gameAuthority: PublicKey | undefined;
  player: PlayerCore;
  encounterPubkey: PublicKey;
  encounter: Pick<EncounterAccount, "cityId" | "locationLat" | "locationLong" | "id">;
}

export async function buildAttackEncounterIx(
  a: AttackEncounterArgs,
): Promise<TransactionInstruction> {
  const [playerPda] = await derivePlayerPda(a.gameEngine, a.owner);
  const [loot] = await deriveLootPda(playerPda, a.player.lootCounter);
  const encounterLocation = (
    await deriveLocationPda(
      a.gameEngine,
      a.encounter.cityId,
      toGrid(a.encounter.locationLat),
      toGrid(a.encounter.locationLong),
    )
  )[0];
  return createAttackEncounterInstruction(
    {
      owner: a.owner,
      gameEngine: a.gameEngine,
      encounter: a.encounterPubkey,
      loot,
      encounterLocation,
      locationCreatorRefund: a.gameAuthority ?? a.owner,
    },
    { encounterId: a.encounter.id },
  );
}

export interface AttackPlayerArgs {
  attacker: PublicKey;
  gameEngine: PublicKey;
  attackerCityId: number;
  defenderPlayer: PublicKey;
  defenderCityId: number;
  driveBy: boolean;
}

export async function buildAttackPlayerIx(a: AttackPlayerArgs): Promise<TransactionInstruction> {
  return createAttackPlayerInstruction(
    {
      attacker: a.attacker,
      gameEngine: a.gameEngine,
      defenderPlayer: a.defenderPlayer,
      attackerCityId: a.attackerCityId,
      defenderCityId: a.defenderCityId,
    },
    { driveBy: a.driveBy },
  );
}
