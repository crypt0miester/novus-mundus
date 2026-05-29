import { getEffectiveTier, MAX_TEAM_MEMBERS_BY_TIER } from "novus-mundus-sdk";
import type { PlayerCore } from "novus-mundus-sdk";

/**
 * Effective team capacity derived from the leader's current subscription tier,
 * floored at the current member count.
 *
 * This mirrors the on-chain `TeamAccount::refresh_capacity`, which the program
 * recomputes against the leader's live tier on every join / invite / accept.
 * Because the stored `maxMembers` is only rewritten by those calls, it can lag
 * the leader's real tier (e.g. a team created before the leader upgraded). The
 * UI must gate on the effective value so a higher-tier leader's team can grow
 * past a stale stored cap — and the first join/accept then persists it.
 *
 * `leader` is the team leader's parsed PlayerCore. Until it has loaded we can't
 * know the tier, so the stored cap is surfaced unchanged.
 */
export function effectiveTeamCapacity(
  team: { memberCount: number; maxMembers: number },
  leader: PlayerCore | null | undefined,
  nowSec: number,
): number {
  if (!leader) return team.maxMembers;
  const tierCap = MAX_TEAM_MEMBERS_BY_TIER[getEffectiveTier(leader, nowSec)];
  return Math.max(tierCap, team.memberCount);
}
