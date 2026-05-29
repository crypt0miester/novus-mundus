import "server-only";
import type { NextResponse } from "next/server";
import type { PublicKey } from "@solana/web3.js";
import {
  DungeonStatus,
  RoomType,
  type DungeonRunAccount,
  type DungeonTemplateAccount,
} from "novus-mundus-sdk";
import { getDungeonRun, getDungeonTemplate } from "@/lib/server/chain";
import { fail } from "@/lib/server/route-helpers";

/**
 * Load the player's run + template and assert it is in an attackable combat
 * state. Shared by the `attack` and `attack-multi` routes.
 */
export async function loadCombatRun(
  owner: PublicKey,
): Promise<{ run: DungeonRunAccount; template: DungeonTemplateAccount } | { error: NextResponse }> {
  const run = await getDungeonRun(owner);
  if (!run) return { error: fail("no active dungeon run", 409) };
  if (run.status !== DungeonStatus.Active && run.status !== DungeonStatus.BossFight) {
    return { error: fail("dungeon run is not in an attackable state", 409) };
  }
  if (run.roomType !== RoomType.Combat) {
    return { error: fail("the current room is not a combat room", 409) };
  }
  if (run.enemyHealth.isZero()) {
    return { error: fail("the enemy is already defeated", 409) };
  }
  const template = await getDungeonTemplate(run.dungeonId);
  if (!template) return { error: fail("dungeon template not found", 500) };
  return { run, template };
}
