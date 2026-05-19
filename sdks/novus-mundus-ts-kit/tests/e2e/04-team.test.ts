/**
 * Team System E2E Tests
 *
 * Tests for team/guild functionality:
 * - Team creation
 * - Invitations
 * - Member management
 * - Treasury operations
 * - Team settings
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { address, type Address } from '@solana/kit';

import {
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createTeamDeclineInviteInstruction,
  createTeamCancelInviteInstruction,
  createTeamLeaveInstruction,
  createTeamKickMemberInstruction,
  createTeamPromoteMemberInstruction,
  createTeamDemoteMemberInstruction,
  createTeamTransferLeadershipInstruction,
  createTeamDisbandInstruction,
  createTeamSetMotdInstruction,
  createTeamUpdateSettingsInstruction,
  createTeamDepositTreasuryInstruction,
  createTeamWithdrawTreasuryInstruction,
  createTeamTreasuryRequestWithdrawInstruction,
  createTeamTreasuryApproveRequestInstruction,
  createTeamTreasuryRejectRequestInstruction,
  createTeamTreasuryCancelRequestInstruction,
  createTeamTreasuryExecuteRequestInstruction,
  createTeamUpdateTreasurySettingsInstruction,
  createTeamJoinInstruction,
  deriveTeamPda,
  deriveTeamSlotPda,
  deriveTeamInvitePda,
  deriveTreasuryRequestPda,
  derivePlayerPda,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
  createTeamReadyPlayers,
} from '../fixtures/players';
import {
  assertBnEquals,
  assertBnGreaterThan,
  assertPlayerHasNoTeam,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchTeam,
  fetchTeamById,
  fetchTeamMemberSlot,
  fetchTeamInvite,
  fetchTreasuryRequest,
} from '../utils/accounts';

// Test Suite

setDefaultTimeout(60_000);

describe('Team System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let teamCounter: number = 0;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Helper to generate unique team ID
  function uniqueTeamId(): number {
    return Date.now() + (++teamCounter);
  }

  // Helper to create unique team name
  function uniqueTeamName(): string {
    return `TestTeam${++teamCounter}`;
  }

  // Helper to get team PDA from team ID
  async function getTeamPda(teamId: number): Promise<Address> {
    const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);
    return teamPda;
  }

  // Team Creation Tests

  describe('Team Creation', () => {
    it('should create a new team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();

      const ix = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );

      const tx = [ix];

      await sendTransaction(ctx.svm, tx, [leader.keypair]);

      // Verify player is now in a team
      const playerAccount = await fetchPlayer(ctx.svm, leader.playerPda);
      expect(playerAccount).not.toBeNull();
      expect(playerAccount!.team).not.toBeNull();
    });

    it('should reject duplicate team creation for same player', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName1 = uniqueTeamName();
      const teamName2 = uniqueTeamName();
      const teamId1 = uniqueTeamId();
      const teamId2 = uniqueTeamId();

      // Create first team
      const ix1 = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId: teamId1 },
        { name: teamName1 }
      );
      const tx1 = [ix1];

      await sendTransaction(ctx.svm, tx1, [leader.keypair]);

      // Try to create second team - should fail
      const ix2 = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId: teamId2 },
        { name: teamName2 }
      );
      const tx2 = [ix2];
      await expectTransactionToFail(ctx.svm, tx2, [leader.keypair]);
    });

    it('should reject empty team name', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamId = uniqueTeamId();

      const ix = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: '' }
      );

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [leader.keypair]);
    });

    it('should reject team name exceeding max length', async () => {
      const longName = 'A'.repeat(33); // 32 is max
      const teamId = uniqueTeamId();

      // SDK validates client-side and rejects before sending tx
      await expect(
        createTeamCreateInstruction(
          { owner: address('11111111111111111111111111111111'), gameEngine: ctx.gameEngine, teamId },
          { name: longName }
        )
      ).rejects.toThrow('Team name too long');
    });
  });

  // Invitation Tests

  describe('Invitations', () => {
    it('should invite player to team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team
      const createIx = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      const createTx = [createIx];
      await sendTransaction(ctx.svm, createTx, [leader.keypair]);

      // Invite member
      const inviteIx = await createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0, // Leader is at slot 0
        inviteePlayer: invitee.playerPda,
      });
      const inviteTx = [inviteIx];
      await sendTransaction(ctx.svm, inviteTx, [leader.keypair]);

      // Verify invite was created
      const invite = await fetchTeamInvite(ctx.svm, teamPda, invitee.playerPda);
      expect(invite).not.toBeNull();
    });

    it('should accept team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team
      const createIx = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.svm, [createIx], [leader.keypair]);

      // Invite
      const inviteIx = await createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.svm, [inviteIx], [leader.keypair]);

      // Accept
      const acceptIx = await createTeamAcceptInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1, // Slot 0 is leader
        inviteRefund: leader.publicKey, // Refund to inviter
      });
      await sendTransaction(ctx.svm, [acceptIx], [invitee.keypair]);

      // Verify member is in team
      const inviteeAccount = await fetchPlayer(ctx.svm, invitee.playerPda);
      expect(inviteeAccount).not.toBeNull();
      expect(inviteeAccount!.team).not.toBeNull();
    });

    it('should decline team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create and invite
      const createIx = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.svm, [createIx], [leader.keypair]);

      const inviteIx = await createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.svm, [inviteIx], [leader.keypair]);

      // Decline
      const declineIx = await createTeamDeclineInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        inviterRefund: leader.publicKey, // Refund to inviter
      });
      await sendTransaction(ctx.svm, [declineIx], [invitee.keypair]);

      // Verify still not in team
      const inviteeAccount = await fetchPlayer(ctx.svm, invitee.playerPda);
      expect(inviteeAccount).not.toBeNull();
      assertPlayerHasNoTeam(inviteeAccount!);
    });

    it('should cancel team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create and invite
      const createIx = await createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.svm, [createIx], [leader.keypair]);

      const inviteIx = await createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.svm, [inviteIx], [leader.keypair]);

      // Cancel (by inviter)
      const cancelIx = await createTeamCancelInviteInstruction({
        member: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        memberSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.svm, [cancelIx], [leader.keypair]);

      // Verify invite is cancelled (accepting should fail)
      const acceptIx = await createTeamAcceptInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
        inviteRefund: leader.publicKey,
      });
      await expectTransactionToFail(
        ctx.svm,
        [acceptIx],
        [invitee.keypair]
      );
    });
  });

  // Member Management Tests

  describe('Member Management', () => {
    it('should kick member from team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team and add member
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Kick member
      const kickIx = await createTeamKickMemberInstruction({
        kicker: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        kickerSlotIndex: 0,
        kickedPlayer: member.playerPda,
        kickedSlotIndex: 1,
        kickedOwner: member.publicKey,
      });
      await sendTransaction(ctx.svm, [kickIx], [leader.keypair]);

      // Verify member is no longer in team
      const memberAccount = await fetchPlayer(ctx.svm, member.playerPda);
      assertPlayerHasNoTeam(memberAccount!);
    });

    it('should allow member to leave team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team and add member
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Member leaves
      const leaveIx = await createTeamLeaveInstruction({
        owner: member.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await sendTransaction(ctx.svm, [leaveIx], [member.keypair]);

      // Verify member left
      const memberAccount = await fetchPlayer(ctx.svm, member.playerPda);
      assertPlayerHasNoTeam(memberAccount!);
    });

    it('should promote member to officer', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote
      const promoteIx = await createTeamPromoteMemberInstruction(
        {
          promoter: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          promoterSlotIndex: 0,
          targetSlotIndex: 1,
        },
        { newRank: 1 }
      );
      await sendTransaction(ctx.svm, [promoteIx], [leader.keypair]);

      // Verify member role changed (would need to check team member slot)
    });

    it('should demote officer to member', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const officer = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team and promote
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:officer.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: officer.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [officer.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            {
              promoter: leader.publicKey,
              gameEngine: ctx.gameEngine,
              team: teamPda,
              teamId,
              promoterSlotIndex: 0,
              targetSlotIndex: 1,
            },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      // Demote
      const demoteIx = await createTeamDemoteMemberInstruction(
        {
          demoter: leader.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId,
          demoterSlotIndex: 0,
          targetSlotIndex: 1,
        },
        { newRank: 4 }
      );
      await sendTransaction(ctx.svm, [demoteIx], [leader.keypair]);
    });

    it('should transfer leadership', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const newLeader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:newLeader.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: newLeader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [newLeader.keypair]
      );

      // Transfer leadership
      const transferIx = await createTeamTransferLeadershipInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        currentSlotIndex: 0,
        newLeaderPlayer: newLeader.playerPda,
        newSlotIndex: 1,
      });
      await sendTransaction(ctx.svm, [transferIx], [leader.keypair]);

      // Verify leadership changed (check team account)
    });

    it('should reject leader from leaving without transfer', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Leader tries to leave - should fail (must transfer or disband)
      const leaveIx = await createTeamLeaveInstruction({
        owner: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 0,
      });
      await expectTransactionToFail(
        ctx.svm,
        [leaveIx],
        [leader.keypair]
      );
    });
  });

  // Team Disbanding Tests

  describe('Team Disbanding', () => {
    it('should disband team when only leader remains', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Disband
      const disbandIx = await createTeamDisbandInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await sendTransaction(ctx.svm, [disbandIx], [leader.keypair]);

      // Verify leader no longer in team
      const afterAccount = await fetchPlayer(ctx.svm, leader.playerPda);
      assertPlayerHasNoTeam(afterAccount!);
    });

    it('should reject disband if members remain', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team with member
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Try to disband - should fail
      const disbandIx = await createTeamDisbandInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await expectTransactionToFail(
        ctx.svm,
        [disbandIx],
        [leader.keypair]
      );
    });
  });

  // Team Settings Tests

  describe('Team Settings', () => {
    it('should set team MOTD', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const motd = 'Welcome to our team!';
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      const motdIx = await createTeamSetMotdInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { motd }
      );
      await sendTransaction(ctx.svm, [motdIx], [leader.keypair]);

      // Verify MOTD was set (check team account)
    });

    it('should update team settings', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      const settingsIx = await createTeamUpdateSettingsInstruction(
        { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { settings: 0, minLevelToJoin: 5 }
      );
      await sendTransaction(ctx.svm, [settingsIx], [leader.keypair]);
    });
  });

  // Treasury Tests

  describe('Treasury', () => {
    it('should deposit to treasury', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const depositAmount = 1000n;
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      const depositIx = await createTeamDepositTreasuryInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
        { amount: depositAmount }
      );
      await sendTransaction(ctx.svm, [depositIx], [leader.keypair]);

      // Verify treasury increased (check team account)
    });

    it('should withdraw from treasury (leader)', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Deposit first
      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 5000n }
          )
        ],
        [leader.keypair]
      );

      // Withdraw
      const withdrawIx = await createTeamWithdrawTreasuryInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { amount: 1000n }
      );
      await sendTransaction(ctx.svm, [withdrawIx], [leader.keypair]);
    });

    it('should request treasury withdrawal (member)', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY for withdrawal requests)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      // Deposit to treasury
      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 10000n }
          )
        ],
        [leader.keypair]
      );

      // Member requests withdrawal
      const requestIx = await createTeamTreasuryRequestWithdrawInstruction(
        { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
        { amount: 1000n }
      );
      await sendTransaction(ctx.svm, [requestIx], [member.keypair]);
    });

    it('should approve treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Add member
      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 10000n }
          )
        ],
        [leader.keypair]
      );

      // Request
      await sendTransaction(
        ctx.svm,
        [
          await createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: 1000n }
          )
        ],
        [member.keypair]
      );

      // Approve
      const approveIx = await createTeamTreasuryApproveRequestInstruction({
        approver: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        approverSlotIndex: 0,
        requesterSlotIndex: 1,
        requesterPlayer: member.playerPda,
        requesterRefund: member.publicKey,
      });
      await sendTransaction(ctx.svm, [approveIx], [leader.keypair]);
    });

    it('should reject treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 10000n }
          )
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: 1000n }
          )
        ],
        [member.keypair]
      );

      // Reject
      const rejectIx = await createTeamTreasuryRejectRequestInstruction({
        rejecter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        rejecterSlotIndex: 0,
        requesterPlayer: member.playerPda,
        requesterRefund: member.publicKey,
      });
      await sendTransaction(ctx.svm, [rejectIx], [leader.keypair]);
    });

    it('should update treasury settings', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      const settingsIx = await createTeamUpdateTreasurySettingsInstruction(
        { leader: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        {
          instantLimits: [1000n, 500n, 250n, 100n],
          dailyCaps: [5000n, 2500n, 1000n, 500n],
          cooldownHours: 24,
        }
      );
      await sendTransaction(ctx.svm, [settingsIx], [leader.keypair]);
    });

    it('should cancel treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer: member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 10000n }
          )
        ],
        [leader.keypair]
      );

      // Member requests withdrawal
      await sendTransaction(
        ctx.svm,
        [
          await createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: 1000n }
          )
        ],
        [member.keypair]
      );

      // Verify request exists
      const [requestPda] = await deriveTreasuryRequestPda(teamPda, member.playerPda);
      let requestAccount = await ctx.svm.getAccount(requestPda);
      expect(requestAccount.exists).toBe(true);

      // Cancel the request
      const cancelIx = await createTeamTreasuryCancelRequestInstruction({
        owner: member.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await sendTransaction(ctx.svm, [cancelIx], [member.keypair]);

      // Verify request PDA is closed
      requestAccount = await ctx.svm.getAccount(requestPda);
      expect(requestAccount.exists).toBe(false);
    });

    it('should execute approved treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer: member.playerPda,
          })
        ],
        [leader.keypair]
      );

      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ],
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ],
        [leader.keypair]
      );

      // Set treasury settings with 0 cooldown for testing
      await sendTransaction(
        ctx.svm,
        [
          await createTeamUpdateTreasurySettingsInstruction(
            { leader: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            {
              instantLimits: [100n, 100n, 100n, 100n],
              dailyCaps: [50000n, 50000n, 50000n, 50000n],
              cooldownHours: 1,
            }
          )
        ],
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.svm,
        [
          await createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: 10000n }
          )
        ],
        [leader.keypair]
      );

      // Member requests withdrawal
      await sendTransaction(
        ctx.svm,
        [
          await createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: 1000n }
          )
        ],
        [member.keypair]
      );

      // Get member cash before approve (approve auto-executes transfer)
      const memberBefore = await fetchPlayer(ctx.svm, member.playerPda);
      const cashBefore = Number(memberBefore!.cashOnHand);

      // Leader approves (which auto-executes the withdrawal)
      await sendTransaction(
        ctx.svm,
        [
          await createTeamTreasuryApproveRequestInstruction({
            approver: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            approverSlotIndex: 0,
            requesterSlotIndex: 1,
            requesterPlayer: member.playerPda,
            requesterRefund: member.publicKey,
          })
        ],
        [leader.keypair]
      );

      // Verify funds were transferred to member
      const memberAfter = await fetchPlayer(ctx.svm, member.playerPda);
      expect(Number(memberAfter!.cashOnHand)).toBeGreaterThan(cashBefore);
    });
  });

  // Open Join Tests

  describe('Open Join', () => {
    it('should join open team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Make team joinable
      await sendTransaction(
        ctx.svm,
        [
          await createTeamUpdateSettingsInstruction(
            { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            { settings: 1, minLevelToJoin: 1 }
          )
        ],
        [leader.keypair]
      );

      // Join
      const joinIx = await createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await sendTransaction(ctx.svm, [joinIx], [joiner.keypair]);

      // Verify joined
      const joinerAccount = await fetchPlayer(ctx.svm, joiner.playerPda);
      expect(joinerAccount!.team).not.toBeNull();
    });

    it('should reject join if below min level', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      // Create team
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Make team joinable with high min level
      await sendTransaction(
        ctx.svm,
        [
          await createTeamUpdateSettingsInstruction(
            { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            { settings: 1, minLevelToJoin: 50 }
          )
        ],
        [leader.keypair]
      );

      // Join should fail (joiner is level 1)
      const joinIx = await createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await expectTransactionToFail(
        ctx.svm,
        [joinIx],
        [joiner.keypair]
      );
    });

    it('should reject join if team not joinable', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = await getTeamPda(teamId);

      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ],
        [leader.keypair]
      );

      // Don't make joinable (default is false)

      const joinIx = await createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await expectTransactionToFail(
        ctx.svm,
        [joinIx],
        [joiner.keypair]
      );
    });
  });
});
