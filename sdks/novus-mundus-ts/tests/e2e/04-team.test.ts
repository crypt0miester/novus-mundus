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
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

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

// ============================================================
// Test Suite
// ============================================================

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
  function getTeamPda(teamId: number): PublicKey {
    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);
    return teamPda;
  }

  // ============================================================
  // Team Creation Tests
  // ============================================================

  describe('Team Creation', () => {
    it('should create a new team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();

      const ix = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );

      const tx = new Transaction().add(ix);

      await sendTransaction(ctx.connection, tx, [leader.keypair]);

      // Verify player is now in a team
      const playerAccount = await fetchPlayer(ctx.connection, leader.playerPda);
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
      const ix1 = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId: teamId1 },
        { name: teamName1 }
      );
      const tx1 = new Transaction().add(ix1);

      await sendTransaction(ctx.connection, tx1, [leader.keypair]);

      // Try to create second team - should fail
      const ix2 = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId: teamId2 },
        { name: teamName2 }
      );
      const tx2 = new Transaction().add(ix2);
      await expectTransactionToFail(ctx.connection, tx2, [leader.keypair]);
    });

    it('should reject empty team name', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamId = uniqueTeamId();

      const ix = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: '' }
      );

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [leader.keypair]);
    });

    it('should reject team name exceeding max length', async () => {
      const longName = 'A'.repeat(33); // 32 is max
      const teamId = uniqueTeamId();

      // SDK validates client-side and throws before sending tx
      expect(() => {
        createTeamCreateInstruction(
          { owner: Keypair.generate().publicKey, gameEngine: ctx.gameEngine, teamId },
          { name: longName }
        );
      }).toThrow('Team name too long');
    });
  });

  // ============================================================
  // Invitation Tests
  // ============================================================

  describe('Invitations', () => {
    it('should invite player to team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team
      const createIx = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      const createTx = new Transaction().add(createIx);
      await sendTransaction(ctx.connection, createTx, [leader.keypair]);

      // Invite member
      const inviteIx = createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0, // Leader is at slot 0
        inviteePlayer: invitee.playerPda,
      });
      const inviteTx = new Transaction().add(inviteIx);
      await sendTransaction(ctx.connection, inviteTx, [leader.keypair]);

      // Verify invite was created
      const invite = await fetchTeamInvite(ctx.connection, teamPda, invitee.playerPda);
      expect(invite).not.toBeNull();
    });

    it('should accept team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team
      const createIx = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.connection, new Transaction().add(createIx), [leader.keypair]);

      // Invite
      const inviteIx = createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.connection, new Transaction().add(inviteIx), [leader.keypair]);

      // Accept
      const acceptIx = createTeamAcceptInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1, // Slot 0 is leader
        inviteRefund: leader.publicKey, // Refund to inviter
      });
      await sendTransaction(ctx.connection, new Transaction().add(acceptIx), [invitee.keypair]);

      // Verify member is in team
      const inviteeAccount = await fetchPlayer(ctx.connection, invitee.playerPda);
      expect(inviteeAccount).not.toBeNull();
      expect(inviteeAccount!.team).not.toBeNull();
    });

    it('should decline team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create and invite
      const createIx = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.connection, new Transaction().add(createIx), [leader.keypair]);

      const inviteIx = createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.connection, new Transaction().add(inviteIx), [leader.keypair]);

      // Decline
      const declineIx = createTeamDeclineInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        inviterRefund: leader.publicKey, // Refund to inviter
      });
      await sendTransaction(ctx.connection, new Transaction().add(declineIx), [invitee.keypair]);

      // Verify still not in team
      const inviteeAccount = await fetchPlayer(ctx.connection, invitee.playerPda);
      expect(inviteeAccount).not.toBeNull();
      assertPlayerHasNoTeam(inviteeAccount!);
    });

    it('should cancel team invitation', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const invitee = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create and invite
      const createIx = createTeamCreateInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: teamName }
      );
      await sendTransaction(ctx.connection, new Transaction().add(createIx), [leader.keypair]);

      const inviteIx = createTeamInviteInstruction({
        inviter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        inviterSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.connection, new Transaction().add(inviteIx), [leader.keypair]);

      // Cancel (by inviter)
      const cancelIx = createTeamCancelInviteInstruction({
        member: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        memberSlotIndex: 0,
        inviteePlayer: invitee.playerPda,
      });
      await sendTransaction(ctx.connection, new Transaction().add(cancelIx), [leader.keypair]);

      // Verify invite is cancelled (accepting should fail)
      const acceptIx = createTeamAcceptInviteInstruction({
        owner: invitee.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
        inviteRefund: leader.publicKey,
      });
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(acceptIx),
        [invitee.keypair]
      );
    });
  });

  // ============================================================
  // Member Management Tests
  // ============================================================

  describe('Member Management', () => {
    it('should kick member from team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team and add member
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Kick member
      const kickIx = createTeamKickMemberInstruction({
        kicker: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        kickerSlotIndex: 0,
        kickedPlayer: member.playerPda,
        kickedSlotIndex: 1,
        kickedOwner: member.publicKey,
      });
      await sendTransaction(ctx.connection, new Transaction().add(kickIx), [leader.keypair]);

      // Verify member is no longer in team
      const memberAccount = await fetchPlayer(ctx.connection, member.playerPda);
      assertPlayerHasNoTeam(memberAccount!);
    });

    it('should allow member to leave team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team and add member
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Member leaves
      const leaveIx = createTeamLeaveInstruction({
        owner: member.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await sendTransaction(ctx.connection, new Transaction().add(leaveIx), [member.keypair]);

      // Verify member left
      const memberAccount = await fetchPlayer(ctx.connection, member.playerPda);
      assertPlayerHasNoTeam(memberAccount!);
    });

    it('should promote member to officer', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote
      const promoteIx = createTeamPromoteMemberInstruction(
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
      await sendTransaction(ctx.connection, new Transaction().add(promoteIx), [leader.keypair]);

      // Verify member role changed (would need to check team member slot)
    });

    it('should demote officer to member', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const officer = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team and promote
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:officer.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: officer.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [officer.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
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
        ),
        [leader.keypair]
      );

      // Demote
      const demoteIx = createTeamDemoteMemberInstruction(
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
      await sendTransaction(ctx.connection, new Transaction().add(demoteIx), [leader.keypair]);
    });

    it('should transfer leadership', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const newLeader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:newLeader.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: newLeader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [newLeader.keypair]
      );

      // Transfer leadership
      const transferIx = createTeamTransferLeadershipInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        currentSlotIndex: 0,
        newLeaderPlayer: newLeader.playerPda,
        newSlotIndex: 1,
      });
      await sendTransaction(ctx.connection, new Transaction().add(transferIx), [leader.keypair]);

      // Verify leadership changed (check team account)
    });

    it('should reject leader from leaving without transfer', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Leader tries to leave - should fail (must transfer or disband)
      const leaveIx = createTeamLeaveInstruction({
        owner: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 0,
      });
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(leaveIx),
        [leader.keypair]
      );
    });
  });

  // ============================================================
  // Team Disbanding Tests
  // ============================================================

  describe('Team Disbanding', () => {
    it('should disband team when only leader remains', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Disband
      const disbandIx = createTeamDisbandInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await sendTransaction(ctx.connection, new Transaction().add(disbandIx), [leader.keypair]);

      // Verify leader no longer in team
      const afterAccount = await fetchPlayer(ctx.connection, leader.playerPda);
      assertPlayerHasNoTeam(afterAccount!);
    });

    it('should reject disband if members remain', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team with member
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Try to disband - should fail
      const disbandIx = createTeamDisbandInstruction({
        leader: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(disbandIx),
        [leader.keypair]
      );
    });
  });

  // ============================================================
  // Team Settings Tests
  // ============================================================

  describe('Team Settings', () => {
    it('should set team MOTD', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const motd = 'Welcome to our team!';
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      const motdIx = createTeamSetMotdInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { motd }
      );
      await sendTransaction(ctx.connection, new Transaction().add(motdIx), [leader.keypair]);

      // Verify MOTD was set (check team account)
    });

    it('should update team settings', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      const settingsIx = createTeamUpdateSettingsInstruction(
        { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { settings: 0, minLevelToJoin: 5 }
      );
      await sendTransaction(ctx.connection, new Transaction().add(settingsIx), [leader.keypair]);
    });
  });

  // ============================================================
  // Treasury Tests
  // ============================================================

  describe('Treasury', () => {
    it('should deposit to treasury', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const depositAmount = new BN(1000);
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      const depositIx = createTeamDepositTreasuryInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
        { amount: depositAmount }
      );
      await sendTransaction(ctx.connection, new Transaction().add(depositIx), [leader.keypair]);

      // Verify treasury increased (check team account)
    });

    it('should withdraw from treasury (leader)', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Deposit first
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(5000) }
          )
        ),
        [leader.keypair]
      );

      // Withdraw
      const withdrawIx = createTeamWithdrawTreasuryInstruction(
        { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        { amount: new BN(1000) }
      );
      await sendTransaction(ctx.connection, new Transaction().add(withdrawIx), [leader.keypair]);
    });

    it('should request treasury withdrawal (member)', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY for withdrawal requests)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ),
        [leader.keypair]
      );

      // Deposit to treasury
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(10000) }
          )
        ),
        [leader.keypair]
      );

      // Member requests withdrawal
      const requestIx = createTeamTreasuryRequestWithdrawInstruction(
        { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
        { amount: new BN(1000) }
      );
      await sendTransaction(ctx.connection, new Transaction().add(requestIx), [member.keypair]);
    });

    it('should approve treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Add member
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ),
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(10000) }
          )
        ),
        [leader.keypair]
      );

      // Request
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: new BN(1000) }
          )
        ),
        [member.keypair]
      );

      // Approve
      const approveIx = createTeamTreasuryApproveRequestInstruction({
        approver: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        approverSlotIndex: 0,
        requesterPlayer: member.playerPda,
        requesterRefund: member.publicKey,
      });
      await sendTransaction(ctx.connection, new Transaction().add(approveIx), [leader.keypair]);
    });

    it('should reject treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer:member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(10000) }
          )
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: new BN(1000) }
          )
        ),
        [member.keypair]
      );

      // Reject
      const rejectIx = createTeamTreasuryRejectRequestInstruction({
        rejecter: leader.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        rejecterSlotIndex: 0,
        requesterPlayer: member.playerPda,
        requesterRefund: member.publicKey,
      });
      await sendTransaction(ctx.connection, new Transaction().add(rejectIx), [leader.keypair]);
    });

    it('should update treasury settings', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      const settingsIx = createTeamUpdateTreasurySettingsInstruction(
        { leader: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
        {
          instantLimits: [new BN(1000), new BN(500), new BN(250), new BN(100)],
          dailyCaps: [new BN(5000), new BN(2500), new BN(1000), new BN(500)],
          cooldownHours: 24,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(settingsIx), [leader.keypair]);
    });

    it('should cancel treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer: member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ),
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(10000) }
          )
        ),
        [leader.keypair]
      );

      // Member requests withdrawal
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: new BN(1000) }
          )
        ),
        [member.keypair]
      );

      // Verify request exists
      const [requestPda] = deriveTreasuryRequestPda(teamPda, member.playerPda);
      let requestAccount = await ctx.connection.getAccountInfo(requestPda);
      expect(requestAccount).not.toBeNull();

      // Cancel the request
      const cancelIx = createTeamTreasuryCancelRequestInstruction({
        owner: member.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
      });
      await sendTransaction(ctx.connection, new Transaction().add(cancelIx), [member.keypair]);

      // Verify request PDA is closed
      requestAccount = await ctx.connection.getAccountInfo(requestPda);
      expect(requestAccount).toBeNull();
    });

    it('should execute approved treasury request', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const member = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Setup team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            inviter: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            inviterSlotIndex: 0,
            inviteePlayer: member.playerPda,
          })
        ),
        [leader.keypair]
      );

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({ owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1, inviteRefund: leader.publicKey })
        ),
        [member.keypair]
      );

      // Promote member to rank 1 (needs PERM_TREASURY)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamPromoteMemberInstruction(
            { promoter: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, promoterSlotIndex: 0, targetSlotIndex: 1 },
            { newRank: 1 }
          )
        ),
        [leader.keypair]
      );

      // Set treasury settings with 0 cooldown for testing
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamUpdateTreasurySettingsInstruction(
            { leader: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            {
              instantLimits: [new BN(100), new BN(100), new BN(100), new BN(100)],
              dailyCaps: [new BN(50000), new BN(50000), new BN(50000), new BN(50000)],
              cooldownHours: 1,
            }
          )
        ),
        [leader.keypair]
      );

      // Deposit
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamDepositTreasuryInstruction(
            { owner: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId },
            { amount: new BN(10000) }
          )
        ),
        [leader.keypair]
      );

      // Member requests withdrawal
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamTreasuryRequestWithdrawInstruction(
            { owner: member.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 1 },
            { amount: new BN(1000) }
          )
        ),
        [member.keypair]
      );

      // Get member cash before approve (approve auto-executes transfer)
      const memberBefore = await fetchPlayer(ctx.connection, member.playerPda);
      const cashBefore = memberBefore!.cashOnHand.toNumber();

      // Leader approves (which auto-executes the withdrawal)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamTreasuryApproveRequestInstruction({
            approver: leader.publicKey,
            gameEngine: ctx.gameEngine,
            team: teamPda,
            teamId,
            approverSlotIndex: 0,
            requesterPlayer: member.playerPda,
            requesterRefund: member.publicKey,
          })
        ),
        [leader.keypair]
      );

      // Verify funds were transferred to member
      const memberAfter = await fetchPlayer(ctx.connection, member.playerPda);
      expect(memberAfter!.cashOnHand.toNumber()).toBeGreaterThan(cashBefore);
    });
  });

  // ============================================================
  // Open Join Tests
  // ============================================================

  describe('Open Join', () => {
    it('should join open team', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Make team joinable
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamUpdateSettingsInstruction(
            { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            { settings: 1, minLevelToJoin: 1 }
          )
        ),
        [leader.keypair]
      );

      // Join
      const joinIx = createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await sendTransaction(ctx.connection, new Transaction().add(joinIx), [joiner.keypair]);

      // Verify joined
      const joinerAccount = await fetchPlayer(ctx.connection, joiner.playerPda);
      expect(joinerAccount!.team).not.toBeNull();
    });

    it('should reject join if below min level', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      // Create team
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Make team joinable with high min level
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamUpdateSettingsInstruction(
            { member: leader.publicKey, gameEngine: ctx.gameEngine, team: teamPda, teamId, slotIndex: 0 },
            { settings: 1, minLevelToJoin: 50 }
          )
        ),
        [leader.keypair]
      );

      // Join should fail (joiner is level 1)
      const joinIx = createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(joinIx),
        [joiner.keypair]
      );
    });

    it('should reject join if team not joinable', async () => {
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      const joiner = await factory.createPlayer({ initialize: true, createEstate: true });
      const teamName = uniqueTeamName();
      const teamId = uniqueTeamId();
      const teamPda = getTeamPda(teamId);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction({ owner: leader.publicKey, gameEngine: ctx.gameEngine, teamId }, { name: teamName })
        ),
        [leader.keypair]
      );

      // Don't make joinable (default is false)

      const joinIx = createTeamJoinInstruction({
        owner: joiner.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: 1,
      });
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(joinIx),
        [joiner.keypair]
      );
    });
  });
});
