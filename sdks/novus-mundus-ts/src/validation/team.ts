/**
 * Team Validation
 *
 * Validate team-related parameters and requirements.
 */

import { PublicKey } from '@solana/web3.js';
import type { TeamAccount, TeamMemberSlot, TeamInviteAccount, TreasuryRequest } from '../state/team';
import {
  isTeamActive,
  isTeamPublic,
  isTeamFull,
  rankHasPermission,
  isInviteExpired,
  isTreasuryRequestExecutable,
} from '../state/team';
import { TeamPermissions } from '../state/team';
import type { PlayerCore } from '../state/player';
import { hasTeam } from '../state/player';
import {
  type ValidationResult,
  valid,
  invalid,
  combine,
  validateRange,
  validateName,
} from './common';

// Team State Validation

/** Validate team is active */
export function validateTeamActive(team: TeamAccount): ValidationResult {
  if (!isTeamActive(team)) {
    return invalid('Team is not active');
  }
  return valid();
}

/** Validate team is public (for joining) */
export function validateTeamPublic(team: TeamAccount): ValidationResult {
  if (!isTeamPublic(team)) {
    return invalid('Team is not public - invitation required');
  }
  return valid();
}

/** Validate team has space for new members */
export function validateTeamHasSpace(team: TeamAccount): ValidationResult {
  if (isTeamFull(team)) {
    return invalid('Team is full');
  }
  return valid();
}

/** Validate team member count is within limits */
export function validateTeamMemberCount(team: TeamAccount, minMembers: number): ValidationResult {
  if (team.memberCount < minMembers) {
    return invalid(`Team needs at least ${minMembers} members (currently ${team.memberCount})`);
  }
  return valid();
}

// Permission Validation

/** Validate member has specific permission */
export function validateHasPermission(
  team: TeamAccount,
  memberRank: number,
  permission: number
): ValidationResult {
  if (!rankHasPermission(team, memberRank, permission)) {
    return invalid(`Insufficient permissions for this action`);
  }
  return valid();
}

/** Validate member can invite */
export function validateCanInvite(team: TeamAccount, memberRank: number): ValidationResult {
  return validateHasPermission(team, memberRank, TeamPermissions.INVITE);
}

/** Validate member can kick */
export function validateCanKick(team: TeamAccount, memberRank: number): ValidationResult {
  return validateHasPermission(team, memberRank, TeamPermissions.KICK);
}

/** Validate member can promote */
export function validateCanPromote(team: TeamAccount, memberRank: number): ValidationResult {
  return validateHasPermission(team, memberRank, TeamPermissions.PROMOTE);
}

/** Validate member can demote */
export function validateCanDemote(team: TeamAccount, memberRank: number): ValidationResult {
  // No separate demote permission - uses promote permission
  return validateHasPermission(team, memberRank, TeamPermissions.PROMOTE);
}

/** Validate member can manage treasury */
export function validateCanManageTreasury(team: TeamAccount, memberRank: number): ValidationResult {
  return validateHasPermission(team, memberRank, TeamPermissions.TREASURY);
}

/** Validate member can update settings */
export function validateCanUpdateSettings(team: TeamAccount, memberRank: number): ValidationResult {
  return validateHasPermission(team, memberRank, TeamPermissions.SETTINGS);
}

// Rank Validation

/** Validate rank is valid (0-4: Leader, Officer, Veteran, Member, Recruit) */
export function validateRank(rank: number): ValidationResult {
  return validateRange(rank, 0, 4, 'Rank');
}

/** Validate actor has higher rank than target */
export function validateHigherRank(actorRank: number, targetRank: number): ValidationResult {
  if (actorRank >= targetRank) {
    return invalid('Cannot perform action on member of equal or higher rank');
  }
  return valid();
}

/** Validate promotion target rank is valid */
export function validatePromotionRank(currentRank: number, newRank: number): ValidationResult {
  if (newRank >= currentRank) {
    return invalid('New rank must be lower (higher privilege) than current rank');
  }
  if (newRank < 1) {
    // Can't promote to leader
    return invalid('Cannot promote to leader rank - use transfer leadership');
  }
  return valid();
}

/** Validate demotion target rank is valid */
export function validateDemotionRank(currentRank: number, newRank: number): ValidationResult {
  if (newRank <= currentRank) {
    return invalid('New rank must be higher (lower privilege) than current rank');
  }
  if (newRank > 4) {
    return invalid('Invalid target rank');
  }
  return valid();
}

// Member Validation

/** Validate player is a team member */
export function validateIsMember(
  player: PlayerCore,
  team: PublicKey
): ValidationResult {
  if (!hasTeam(player)) {
    return invalid('Player is not in any team');
  }
  if (!player.team!.equals(team)) {
    return invalid('Player is in a different team');
  }
  return valid();
}

/** Validate player is the team leader */
export function validateIsLeader(memberSlot: TeamMemberSlot): ValidationResult {
  if (memberSlot.rank !== 0) {
    return invalid('Only the team leader can perform this action');
  }
  return valid();
}

/** Validate player is not the team leader */
export function validateNotLeader(memberSlot: TeamMemberSlot): ValidationResult {
  if (memberSlot.rank === 0) {
    return invalid('Team leader cannot perform this action');
  }
  return valid();
}

// Invite Validation

/** Validate invite is not expired */
export function validateInviteNotExpired(invite: TeamInviteAccount, nowSeconds: number): ValidationResult {
  if (isInviteExpired(invite, nowSeconds)) {
    return invalid('Team invite has expired');
  }
  return valid();
}

/** Validate invite is for the correct player */
export function validateInviteRecipient(invite: TeamInviteAccount, player: PublicKey): ValidationResult {
  if (!invite.invitee.equals(player)) {
    return invalid('This invite is for a different player');
  }
  return valid();
}

// Treasury Validation

/** Validate treasury has sufficient funds */
export function validateTreasuryBalance(team: TeamAccount, amount: bigint): ValidationResult {
  if (team.treasury < amount) {
    return invalid(
      `Insufficient treasury balance: need ${amount.toString()}, have ${team.treasury.toString()}`
    );
  }
  return valid();
}

/** Validate treasury request can be executed */
export function validateTreasuryRequestExecutable(
  request: TreasuryRequest,
  nowSeconds: number
): ValidationResult {
  if (!isTreasuryRequestExecutable(request, nowSeconds)) {
    return invalid('Treasury request cannot be executed yet');
  }
  return valid();
}

/** Validate treasury request amount is valid */
export function validateTreasuryRequestAmount(
  team: TeamAccount,
  request: TreasuryRequest
): ValidationResult {
  if (request.amount > team.treasury) {
    return invalid(
      `Treasury request amount exceeds available balance: ${request.amount.toString()} > ${team.treasury.toString()}`
    );
  }
  return valid();
}

// Team Creation Validation

/** Validate team name */
export function validateTeamName(name: string): ValidationResult {
  return validateName(name, 'Team name');
}

/** Validate team tag (short identifier) */
export function validateTeamTag(tag: string): ValidationResult {
  if (tag.length < 2 || tag.length > 6) {
    return invalid('Team tag must be 2-6 characters');
  }
  if (!/^[A-Z0-9]+$/.test(tag)) {
    return invalid('Team tag must be uppercase alphanumeric only');
  }
  return valid();
}

/** Validate team creation requirements */
export function validateCanCreateTeam(player: PlayerCore): ValidationResult {
  if (hasTeam(player)) {
    return invalid('Player is already in a team');
  }
  return valid();
}

// Combined Validations

/** Validate player can join a team */
export function validateCanJoinTeam(
  player: PlayerCore,
  team: TeamAccount
): ValidationResult {
  return combine(
    validateTeamActive(team),
    validateTeamHasSpace(team),
    player && !hasTeam(player) ? valid() : invalid('Player is already in a team')
  );
}

/** Validate player can accept an invite */
export function validateCanAcceptInvite(
  player: PlayerCore,
  team: TeamAccount,
  invite: TeamInviteAccount,
  nowSeconds: number
): ValidationResult {
  return combine(
    validateTeamActive(team),
    validateTeamHasSpace(team),
    validateInviteNotExpired(invite, nowSeconds),
    validateInviteRecipient(invite, player.owner),
    !hasTeam(player) ? valid() : invalid('Player is already in a team')
  );
}

/** Validate member can kick another member */
export function validateCanKickMember(
  team: TeamAccount,
  actorSlot: TeamMemberSlot,
  targetSlot: TeamMemberSlot
): ValidationResult {
  return combine(
    validateTeamActive(team),
    validateCanKick(team, actorSlot.rank),
    validateHigherRank(actorSlot.rank, targetSlot.rank),
    validateNotLeader(targetSlot)
  );
}

/** Validate member can promote another member */
export function validateCanPromoteMember(
  team: TeamAccount,
  actorSlot: TeamMemberSlot,
  targetSlot: TeamMemberSlot,
  newRank: number
): ValidationResult {
  return combine(
    validateTeamActive(team),
    validateCanPromote(team, actorSlot.rank),
    validateHigherRank(actorSlot.rank, targetSlot.rank),
    validatePromotionRank(targetSlot.rank, newRank)
  );
}

/** Validate member can demote another member */
export function validateCanDemoteMember(
  team: TeamAccount,
  actorSlot: TeamMemberSlot,
  targetSlot: TeamMemberSlot,
  newRank: number
): ValidationResult {
  return combine(
    validateTeamActive(team),
    validateCanDemote(team, actorSlot.rank),
    validateHigherRank(actorSlot.rank, targetSlot.rank),
    validateDemotionRank(targetSlot.rank, newRank)
  );
}
