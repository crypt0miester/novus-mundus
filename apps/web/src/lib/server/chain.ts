import "server-only";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import {
  parseDungeonRun,
  parseDungeonTemplate,
  parseArenaLoadout,
  parseExpedition,
  parseEstate,
  parsePlayer,
  derivePlayerPda,
  deriveDungeonRunPda,
  deriveDungeonTemplatePda,
  deriveArenaLoadoutPda,
  deriveExpeditionPda,
  deriveEstatePda,
  type DungeonRunAccount,
  type DungeonTemplateAccount,
  type ArenaLoadoutAccount,
  type ExpeditionAccount,
  type EstateAccount,
  type PlayerAccount,
} from "novus-mundus-sdk";
import { serverClient, serverConnection } from "./game-authority";

/**
 * Server-side reads of on-chain state. Co-sign route handlers must derive game
 * state from chain themselves — never from client-supplied values.
 */

/** This kingdom's GameEngine PDA. */
export function gameEnginePda(): PublicKey {
  return serverClient().gameEngine;
}

/** A player's PlayerAccount PDA. */
export function playerPda(owner: PublicKey): PublicKey {
  return derivePlayerPda(gameEnginePda(), owner)[0];
}

/** A player's estate PDA. */
export function estatePda(owner: PublicKey): PublicKey {
  return deriveEstatePda(playerPda(owner))[0];
}

/** A player's expedition PDA (seeded by the owner wallet, not the player PDA). */
export function expeditionPda(owner: PublicKey): PublicKey {
  return deriveExpeditionPda(owner)[0];
}

async function fetchParsed<T>(
  address: PublicKey,
  parse: (info: AccountInfo<Buffer>) => T | null,
): Promise<T | null> {
  const info = await serverConnection().getAccountInfo(address);
  return info ? parse(info) : null;
}

/** A player's PlayerAccount, or null. */
export function getPlayer(owner: PublicKey): Promise<PlayerAccount | null> {
  return fetchParsed(playerPda(owner), parsePlayer);
}

/** The player's active dungeon run, or null if there is none. */
export function getDungeonRun(owner: PublicKey): Promise<DungeonRunAccount | null> {
  const runPda = deriveDungeonRunPda(playerPda(owner))[0];
  return fetchParsed(runPda, parseDungeonRun);
}

/** A dungeon template by id. */
export function getDungeonTemplate(dungeonId: number): Promise<DungeonTemplateAccount | null> {
  const templatePda = deriveDungeonTemplatePda(dungeonId)[0];
  return fetchParsed(templatePda, parseDungeonTemplate);
}

/** A player's arena loadout (units / weapons / arena hero), or null. */
export function getArenaLoadout(player: PublicKey): Promise<ArenaLoadoutAccount | null> {
  const loadoutPda = deriveArenaLoadoutPda(gameEnginePda(), player)[0];
  return fetchParsed(loadoutPda, parseArenaLoadout);
}

/** The player's active expedition, or null if there is none. */
export function getExpedition(owner: PublicKey): Promise<ExpeditionAccount | null> {
  return fetchParsed(expeditionPda(owner), parseExpedition);
}

/** The player's estate, or null if they have not established one. */
export function getEstate(owner: PublicKey): Promise<EstateAccount | null> {
  return fetchParsed(estatePda(owner), parseEstate);
}
