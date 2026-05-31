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
export async function playerPda(owner: PublicKey): Promise<PublicKey> {
  return (await derivePlayerPda(gameEnginePda(), owner))[0];
}

/** A player's estate PDA. */
export async function estatePda(owner: PublicKey): Promise<PublicKey> {
  return (await deriveEstatePda(await playerPda(owner)))[0];
}

/** A player's expedition PDA (seeded by the owner wallet, not the player PDA). */
export async function expeditionPda(owner: PublicKey): Promise<PublicKey> {
  return (await deriveExpeditionPda(owner))[0];
}

async function fetchParsed<T>(
  address: PublicKey,
  parse: (info: AccountInfo<Buffer>) => T | null,
): Promise<T | null> {
  const info = await serverConnection().getAccountInfo(address);
  if (!info) return null;
  // v3 RPC returns account data as Uint8Array; the SDK parsers read it via a
  // BufferReader that accepts Uint8Array, so the cast is structurally safe.
  return parse(info as unknown as AccountInfo<Buffer>);
}

/** A player's PlayerAccount, or null. */
export async function getPlayer(owner: PublicKey): Promise<PlayerAccount | null> {
  return fetchParsed(await playerPda(owner), parsePlayer);
}

/** The player's active dungeon run, or null if there is none. */
export async function getDungeonRun(owner: PublicKey): Promise<DungeonRunAccount | null> {
  const runPda = (await deriveDungeonRunPda(await playerPda(owner)))[0];
  return fetchParsed(runPda, parseDungeonRun);
}

/** A dungeon template by id. */
export async function getDungeonTemplate(dungeonId: number): Promise<DungeonTemplateAccount | null> {
  const templatePda = (await deriveDungeonTemplatePda(dungeonId))[0];
  return fetchParsed(templatePda, parseDungeonTemplate);
}

/** A player's arena loadout (units / weapons / arena hero), or null. */
export async function getArenaLoadout(player: PublicKey): Promise<ArenaLoadoutAccount | null> {
  const loadoutPda = (await deriveArenaLoadoutPda(gameEnginePda(), player))[0];
  return fetchParsed(loadoutPda, parseArenaLoadout);
}

/** The player's active expedition, or null if there is none. */
export async function getExpedition(owner: PublicKey): Promise<ExpeditionAccount | null> {
  return fetchParsed(await expeditionPda(owner), parseExpedition);
}

/** The player's estate, or null if they have not established one. */
export async function getEstate(owner: PublicKey): Promise<EstateAccount | null> {
  return fetchParsed(await estatePda(owner), parseEstate);
}
