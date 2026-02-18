/**
 * Event Scope Classification
 *
 * Pure function that tags NovusMundusEvents with scopes
 * (personal, team, city) based on event data.
 */

import type { NovusMundusEvent } from "novus-mundus-sdk";

export type EventScope = "personal" | "team" | "city";

/**
 * Classify an event into one or more scopes.
 *
 * @param event - Parsed event from transaction logs
 * @param myPlayerKey - Base58 pubkey of the current player's PDA
 * @param myTeamPubkey - Base58 pubkey of the current player's team PDA (if any)
 * @returns Array of scopes this event belongs to
 */
export function classifyEvent(
  event: NovusMundusEvent,
  myPlayerKey: string,
  myTeamPubkey?: string,
): EventScope[] {
  const scopes: EventScope[] = [];
  const d = event.data as unknown as Record<string, unknown>;

  // Check if any pubkey field matches the current player
  const isMe = (key: string): boolean => {
    const val = d[key];
    if (!val) return false;
    // PublicKey.toBase58() or already a string
    const str = typeof val === "string" ? val : (val as { toBase58?: () => string }).toBase58?.();
    return str === myPlayerKey;
  };

  // ── Personal scope ──────────────────────────────────────────
  const personalKeys = [
    "player", "attacker", "defender", "owner", "sender", "receiver",
    "from", "to", "creator", "killingBlowBy", "leader", "member",
    "inviter", "invitee", "kicker", "kicked",
  ];
  for (const key of personalKeys) {
    if (isMe(key)) {
      scopes.push("personal");
      break;
    }
  }

  // ── Team scope ──────────────────────────────────────────────
  if (myTeamPubkey) {
    const teamEvents = new Set([
      "TeamJoined", "TeamLeft", "MemberKicked", "LeadershipTransferred",
      "TeamDisbanded", "TreasuryDeposit", "TreasuryWithdraw",
      "MemberRankChanged", "InviteSent", "InviteAccepted", "InviteDeclined",
      "InviteCancelled", "MotdUpdated", "TeamSettingsUpdated",
      "TreasurySettingsUpdated", "TreasuryWithdrawRequested",
      "TreasuryRequestApproved", "TreasuryRequestRejected",
      "TreasuryRequestExecuted", "TreasuryRequestCancelled",
      "RallyCreated", "RallyJoined", "RallyExecuted", "RallyCancelled",
      "ReinforcementSent", "ReinforcementArrived",
      "ReinforcementRecalled", "ReinforcementReturned",
    ]);

    if (teamEvents.has(event.name)) {
      // Team events use `team: PublicKey` — match by pubkey
      const eventTeam = d.team;
      const teamStr = typeof eventTeam === "string"
        ? eventTeam
        : (eventTeam as { toBase58?: () => string })?.toBase58?.();
      if (teamStr === myTeamPubkey) {
        scopes.push("team");
      }
    }
  }

  // ── City scope ──────────────────────────────────────────────
  const cityEvents = new Set([
    "EncounterSpawned", "EncounterDefeated", "EncounterAttacked",
    "PlayerAttacked", "CastleCreated", "CastleClaimed", "CastleConquered",
    "CastleDefended", "CastleAttacked", "CastleTransitionProgress",
    "CastleStatusChanged", "CastleProtectionExpired", "KingForceRemoved",
  ]);

  if (cityEvents.has(event.name)) {
    scopes.push("city");
  }

  // If no scope matched, default to personal (it was our tx)
  if (scopes.length === 0) {
    scopes.push("personal");
  }

  return scopes;
}
