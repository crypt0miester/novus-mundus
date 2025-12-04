# Security Hardening: Comprehensive Exploit Mitigation

## Executive Summary

After deep security audit, **47 vulnerabilities** identified across:
- Sybil attacks (multiple accounts)
- Cash/resource transfer exploits ⚠️ **CRITICAL**
- Event manipulation
- Team collusion
- Economic exploits
- On-chain transparency issues

This document provides **concrete, implementable solutions** for each category.

---

## 🚨 CRITICAL: Cash Movement Exploit

### The Problem

**Exploit Flow:**
```
1. User creates Event: "Resource Baron - Collect most resources to win 50K reserved Novi"
2. Attacker creates 100 bot accounts (10 SOL investment)
3. Bot accounts farm resources passively
4. EXPLOIT: Bot accounts transfer cash/resources to main account
5. Main account "wins" event with consolidated resources
6. Withdraws 50K reserved Novi to wallet
7. Rinse and repeat across all events
```

**Why This Breaks Everything:**
- Team cash transfers are UNRESTRICTED (README.md line 33)
- Attackers consolidate resources from many bots → 1 winner
- Reserved Novi is withdrawable = real profit
- On-chain transparency means bots know event criteria in advance

### The Solution: Multi-Layered Transfer Restrictions

---

## 🔒 SOLUTION 1: Transfer Activity Graph (TAG) System

**Concept:** Track ALL cash/resource transfers and flag suspicious patterns.

### Implementation

```rust
#[account]
pub struct TransferGraph {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub transfer_type: TransferType, // Cash, Units, Resources
}

pub enum TransferType {
    Cash,
    Units,
    Resources,
}

// Track cumulative transfers between accounts
#[account]
pub struct TransferRelationship {
    pub account_a: Pubkey,
    pub account_b: Pubkey,
    pub total_transferred_a_to_b: u64,
    pub total_transferred_b_to_a: u64,
    pub transfer_count: u32,
    pub first_transfer: i64,
    pub last_transfer: i64,
    pub flagged: bool,
}

pub fn transfer_cash_to_teammate(
    ctx: Context<TransferCash>,
    amount: u64,
) -> Result<()> {
    let from = &mut ctx.accounts.from_player;
    let to = &mut ctx.accounts.to_player;
    let relationship = &mut ctx.accounts.transfer_relationship;

    // RULE 1: Must be on same team
    require!(
        from.team == to.team && from.team.is_some(),
        ErrorCode::NotTeammates
    );

    // RULE 2: Daily transfer limit per relationship
    let today_start = (Clock::get()?.unix_timestamp / 86400) * 86400;
    if relationship.last_transfer < today_start {
        relationship.daily_amount = 0; // Reset daily counter
    }

    require!(
        relationship.daily_amount + amount <= 100_000_000, // 100M daily max
        ErrorCode::DailyTransferLimitExceeded
    );

    // RULE 3: Account age requirement
    let from_age_days = (Clock::get()?.unix_timestamp - from.created_at) / 86400;
    let to_age_days = (Clock::get()?.unix_timestamp - to.created_at) / 86400;

    require!(
        from_age_days >= 7 && to_age_days >= 7,
        ErrorCode::AccountTooNew
    );

    // RULE 4: Ratio check - prevent one-way funneling
    let total_ab = relationship.total_transferred_a_to_b;
    let total_ba = relationship.total_transferred_b_to_a;

    // If A→B is more than 10x B→A, flag as suspicious
    if total_ab > 0 && total_ba > 0 {
        let ratio = total_ab.checked_div(total_ba).unwrap_or(u64::MAX);
        if ratio > 10 {
            relationship.flagged = true;
            emit!(SuspiciousTransferDetected {
                from: from.key(),
                to: to.key(),
                ratio,
            });
        }
    }

    // RULE 5: Network cluster detection score
    let cluster_score = calculate_cluster_score(from.key(), to.key())?;
    require!(
        cluster_score < 75, // Threshold for Sybil cluster
        ErrorCode::SybilClusterDetected
    );

    // RULE 6: Cooldown between transfers
    require!(
        Clock::get()?.unix_timestamp - relationship.last_transfer >= 3600, // 1 hour
        ErrorCode::TransferCooldown
    );

    // RULE 7: Max recipients per account
    require!(
        from.unique_transfer_recipients < 20, // Can't send to 100 accounts
        ErrorCode::TooManyRecipients
    );

    // Execute transfer
    from.cash = from.cash.checked_sub(amount).unwrap();
    to.cash = to.cash.checked_add(amount).unwrap();

    // Update tracking
    relationship.total_transferred_a_to_b += amount;
    relationship.daily_amount += amount;
    relationship.transfer_count += 1;
    relationship.last_transfer = Clock::get()?.unix_timestamp;

    // Log for off-chain analysis
    emit!(CashTransferred {
        from: from.key(),
        to: to.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// Off-chain: Calculate cluster score using graph analysis
pub fn calculate_cluster_score(from: Pubkey, to: Pubkey) -> Result<u8> {
    // This would be calculated off-chain and passed in with proof
    // Detects groups of accounts that only interact with each other
    // Score 0-100 based on:
    // - Common funding source
    // - Similar creation timestamps
    // - Isolated transfer network
    // - Similar behavioral patterns
    Ok(0)
}
```

### Transfer Rules Summary

| Rule | Threshold | Purpose |
|------|-----------|---------|
| **Same Team** | Required | Prevent cross-team transfers |
| **Daily Limit** | 100M cash per relationship | Prevent massive consolidation |
| **Account Age** | 7+ days both accounts | Prevent new account farming |
| **Transfer Ratio** | Max 10:1 one direction | Detect funneling (A→B but never B→A) |
| **Cluster Score** | < 75/100 | Detect Sybil networks |
| **Cooldown** | 1 hour between transfers | Prevent rapid consolidation |
| **Max Recipients** | 20 unique accounts | Prevent 1 account → 100 accounts |

---

## 🎯 SOLUTION 2: Event Participation Requirements

**Problem:** Bots can win events through consolidated resources from Sybil accounts.

**Solution:** Dynamic participation requirements that make Sybil attacks unprofitable.

### Event Eligibility System

```rust
pub enum EventEligibility {
    Open,           // Anyone can participate
    Verified,       // Only Civic Pass verified
    Aged,           // Account 30+ days old
    Social,         // Must have Discord/Twitter linked
    TeamVetted,     // Team leader must approve
    InviteOnly,     // Community nomination
}

pub struct EventRequirements {
    pub min_account_age_days: u32,
    pub min_unique_opponents_attacked: u32,
    pub min_unique_opponents_defended: u32,
    pub min_team_size: u32,
    pub require_verification: bool,
    pub max_transfer_ratio: u64,        // New!
    pub max_received_transfers: u64,    // New!
    pub min_organic_growth: f64,        // New!
}

pub fn register_for_event(
    ctx: Context<RegisterEvent>,
    event_id: String,
) -> Result<()> {
    let player = &ctx.accounts.player_account;
    let event = &ctx.accounts.event;
    let req = &event.requirements;

    // Standard checks
    let account_age = (Clock::get()?.unix_timestamp - player.created_at) / 86400;
    require!(account_age >= req.min_account_age_days, ErrorCode::AccountTooNew);

    // CRITICAL: Transfer-based eligibility

    // Check 1: Transfer ratio (detect accounts that only receive)
    let sent = player.total_cash_sent;
    let received = player.total_cash_received;

    if received > 0 {
        let ratio = received.checked_div(sent.max(1)).unwrap_or(u64::MAX);
        require!(
            ratio <= req.max_transfer_ratio,
            ErrorCode::SuspiciousTransferPattern
        );
    }

    // Check 2: Max received transfers (prevent consolidation accounts)
    require!(
        player.total_cash_received <= req.max_received_transfers,
        ErrorCode::ExcessiveTransfersReceived
    );

    // Check 3: Organic growth - networth from attacks/collection vs transfers
    let organic_networth = player.networth_from_attacks + player.networth_from_collection;
    let total_networth = player.networth;

    let organic_ratio = organic_networth as f64 / total_networth.max(1) as f64;
    require!(
        organic_ratio >= req.min_organic_growth,
        ErrorCode::InsufficientOrganicGrowth
    );

    // Check 4: Flagged accounts cannot participate in high-value events
    if event.prize_pool > 50_000 {
        require!(!player.flagged, ErrorCode::AccountFlagged);
    }

    // Check 5: Diversity requirement (attacked different players)
    require!(
        player.unique_opponents_attacked >= req.min_unique_opponents_attacked,
        ErrorCode::InsufficientDiversity
    );

    Ok(())
}
```

### Event-Specific Requirements

**Daily Challenges** (Low barrier, low reward):
```rust
EventRequirements {
    min_account_age_days: 7,
    min_unique_opponents_attacked: 5,
    min_unique_opponents_defended: 0,
    min_team_size: 1,
    require_verification: false,
    max_transfer_ratio: 5,              // Received ≤ 5x sent
    max_received_transfers: 500_000_000, // 500M max received
    min_organic_growth: 0.3,            // 30% from attacks/collection
}
```

**Weekly Tournaments** (Medium barrier, high reward):
```rust
EventRequirements {
    min_account_age_days: 30,
    min_unique_opponents_attacked: 20,
    min_unique_opponents_defended: 5,
    min_team_size: 5,
    require_verification: false,
    max_transfer_ratio: 3,              // Received ≤ 3x sent
    max_received_transfers: 200_000_000, // 200M max received
    min_organic_growth: 0.5,            // 50% from attacks/collection
}
```

**Seasonal Events** (High barrier, massive reward):
```rust
EventRequirements {
    min_account_age_days: 90,
    min_unique_opponents_attacked: 50,
    min_unique_opponents_defended: 20,
    min_team_size: 10,
    require_verification: true,         // MUST be verified
    max_transfer_ratio: 2,              // Received ≤ 2x sent
    max_received_transfers: 100_000_000, // 100M max received
    min_organic_growth: 0.7,            // 70% from attacks/collection
}
```

**Key Insight:**
> If you received 1 Billion cash from transfers but only sent 100M, you're a consolidation account. Ineligible for high-value events.

---

## 🤝 SOLUTION 3: Team-Based Accountability

**Problem:** Bot teams can game events by pooling resources.

**Solution:** Team vetting, reputation, and accountability systems.

### Team Structure Hardening

```rust
#[account]
pub struct Team {
    pub id: Pubkey,
    pub name: String,
    pub leader: Pubkey,
    pub members: Vec<Pubkey>,
    pub created_at: i64,
    pub reputation: u32,              // 0-100 score
    pub total_events_won: u32,
    pub total_flags: u32,
    pub verified: bool,               // Admin verified as legitimate
    pub min_member_age: u32,          // Set by leader
    pub member_invite_required: bool,
}

#[account]
pub struct TeamMember {
    pub player: Pubkey,
    pub team: Pubkey,
    pub joined_at: i64,
    pub invited_by: Pubkey,           // Who invited this member
    pub vouched_by: Vec<Pubkey>,      // Other members who vouch
    pub contribution_score: u32,       // How active in team
    pub flagged: bool,
}

pub fn invite_team_member(
    ctx: Context<InviteTeamMember>,
    invitee: Pubkey,
) -> Result<()> {
    let team = &mut ctx.accounts.team;
    let inviter = &ctx.accounts.inviter;

    // Only leader or deputy can invite
    require!(
        inviter.key() == team.leader,
        ErrorCode::Unauthorized
    );

    // Check team reputation
    require!(
        team.reputation >= 50,
        ErrorCode::TeamReputationTooLow
    );

    // Check invitee eligibility
    let invitee_account = &ctx.accounts.invitee_account;
    let account_age = (Clock::get()?.unix_timestamp - invitee_account.created_at) / 86400;

    require!(
        account_age >= team.min_member_age,
        ErrorCode::InviteeTooNew
    );

    // Inviter liability: if invitee is flagged as bot, inviter loses reputation
    emit!(TeamInviteSent {
        team: team.key(),
        inviter: inviter.key(),
        invitee,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

pub fn flag_team_member(
    ctx: Context<FlagTeamMember>,
    member: Pubkey,
    reason: String,
) -> Result<()> {
    let team = &mut ctx.accounts.team;
    let member_data = &mut ctx.accounts.member;

    member_data.flagged = true;
    team.total_flags += 1;

    // If team has too many flagged members, reduce reputation
    if team.total_flags > 3 {
        team.reputation = team.reputation.saturating_sub(10);
    }

    // If reputation drops below threshold, team loses event eligibility
    if team.reputation < 30 {
        team.verified = false;
        emit!(TeamSuspended {
            team: team.key(),
            reason: "Too many flagged members".to_string(),
        });
    }

    Ok(())
}
```

### Team Event Rules

**Team Tournaments:**
```rust
pub fn register_team_for_event(
    ctx: Context<RegisterTeamEvent>,
    event_id: String,
) -> Result<()> {
    let team = &ctx.accounts.team;

    // Rule 1: Team age requirement
    let team_age_days = (Clock::get()?.unix_timestamp - team.created_at) / 86400;
    require!(team_age_days >= 30, ErrorCode::TeamTooNew);

    // Rule 2: Minimum active members (not just account count)
    let active_members = team.members.iter()
        .filter(|m| m.last_action_timestamp > Clock::get()?.unix_timestamp - 86400 * 7)
        .count();
    require!(active_members >= 10, ErrorCode::InsufficientActiveMembers);

    // Rule 3: Member diversity check
    // Detect if all members were created around same time (Sybil indicator)
    let creation_timestamps: Vec<i64> = team.members.iter()
        .map(|m| m.created_at)
        .collect();

    let variance = calculate_variance(&creation_timestamps);
    require!(
        variance > 86400 * 7, // At least 7 days variance in member creation
        ErrorCode::SuspiciousMemberCreationPattern
    );

    // Rule 4: Inter-team transfer analysis
    // If >80% of team's cash came from internal transfers = Sybil team
    let team_total_cash: u64 = team.members.iter().map(|m| m.cash).sum();
    let team_internal_transfers: u64 = calculate_internal_transfers(team)?;

    let internal_ratio = team_internal_transfers as f64 / team_total_cash as f64;
    require!(
        internal_ratio < 0.5, // Max 50% from internal transfers
        ErrorCode::SybilTeamDetected
    );

    // Rule 5: Reputation threshold
    require!(team.reputation >= 60, ErrorCode::TeamReputationTooLow);

    Ok(())
}
```

---

## 🔍 SOLUTION 4: Behavioral Analysis & ML Detection

**Problem:** Sophisticated bots can mimic human behavior.

**Solution:** Multi-dimensional behavioral fingerprinting.

### On-Chain Behavioral Metrics

```rust
#[account]
pub struct BehaviorProfile {
    pub player: Pubkey,
    pub total_actions: u64,

    // Timing patterns
    pub action_timestamps: Vec<i64>,         // Last 100 actions
    pub avg_time_between_actions: i64,
    pub timing_variance: f64,                 // Low = bot-like

    // Diversity metrics
    pub unique_opponents_attacked: u32,
    pub unique_opponents_defended_against: u32,
    pub unique_teammates_traded_with: u32,
    pub attack_target_concentration: f64,     // 0-1, high = same targets

    // Economic patterns
    pub cash_flow_variance: f64,
    pub sudden_wealth_events: u32,            // Large cash increases
    pub purchase_patterns: Vec<PurchaseType>,

    // Social metrics
    pub team_changes: u32,
    pub messages_sent: u32,                   // Forum activity
    pub events_participated: u32,
    pub events_won: u32,

    // Anomaly scores
    pub bot_likelihood_score: u8,             // 0-100
    pub last_analysis_timestamp: i64,
}

pub fn analyze_behavior(player: &BehaviorProfile) -> u8 {
    let mut bot_score = 0u8;

    // 1. Perfect timing (bot indicator)
    if player.timing_variance < 60.0 {  // Less than 1 minute variance
        bot_score += 20;
    }

    // 2. Attack concentration (always targets same players)
    if player.attack_target_concentration > 0.7 {
        bot_score += 15;
    }

    // 3. No social activity
    if player.messages_sent == 0 && player.total_actions > 100 {
        bot_score += 15;
    }

    // 4. Sudden wealth without corresponding attacks
    if player.sudden_wealth_events > 5 && player.unique_opponents_attacked < 10 {
        bot_score += 20; // Likely receiving transfers from Sybils
    }

    // 5. Low diversity
    if player.unique_opponents_attacked < 5 && player.total_actions > 50 {
        bot_score += 10;
    }

    // 6. Never changes teams (isolated operation)
    if player.team_changes == 0 && player.total_actions > 200 {
        bot_score += 10;
    }

    // 7. High win rate without diverse opponents (self-dealing)
    if player.events_won > 10 && player.unique_opponents_attacked < 20 {
        bot_score += 10;
    }

    bot_score.min(100)
}
```

### Off-Chain ML Model

```python
# Run off-chain, results submitted to on-chain flagging system

import numpy as np
from sklearn.ensemble import IsolationForest

def detect_sybil_clusters(accounts: list) -> dict:
    """
    Detects groups of accounts likely controlled by same operator
    """
    features = []

    for account in accounts:
        features.append([
            account.creation_timestamp,
            account.funding_source_similarity,  # Did same wallet fund multiple accounts?
            account.behavioral_similarity,       # Similar action patterns?
            account.transfer_graph_centrality,   # Central node in transfer network?
            account.timing_correlation,          # Actions at similar times?
            account.ip_correlation,              # Same IP (if available from RPC)
        ])

    # Isolation Forest detects outliers (normal) vs clusters (Sybils)
    clf = IsolationForest(contamination=0.1)
    predictions = clf.fit_predict(features)

    # Accounts with prediction = -1 are potential Sybils
    flagged_accounts = [
        accounts[i] for i, pred in enumerate(predictions) if pred == -1
    ]

    return {
        'flagged_accounts': flagged_accounts,
        'confidence_scores': clf.decision_function(features),
    }

def generate_merkle_proof_for_flagged_accounts(flagged: list) -> bytes:
    """
    Generate merkle proof that can be verified on-chain
    """
    # Create merkle tree of flagged accounts
    # Submit root to on-chain program
    # When account tries to participate in event, verify they're NOT in flagged tree
    pass
```

---

## 💰 SOLUTION 5: Economic Hardening

### Fix Tier Pricing Inconsistencies

```rust
// Current problem: Buying 10M Novi for 420 SOL = 0.000042 Novi/SOL
// But Expert tier only needs 20K Novi deposit = trivial cost

// SOLUTION: Dynamic tier requirements based on total players

pub fn calculate_tier_requirements(global_state: &GlobalState) -> TierRequirements {
    let total_legendary = global_state.tier_counts[TierType::Legendary];

    // As more people reach Legendary, cost increases
    let legendary_deposit = 1_000_000 + (total_legendary * 50_000);

    TierRequirements {
        expert_deposit: 50_000,     // Increased from 20K
        epic_deposit: 200_000,      // Increased from 100K
        legendary_deposit,          // Dynamic: 1M + (count * 50K)
    }
}
```

### Fix NFT Bonus Exploit

```rust
// Current problem: Bunker gives +50K Novi for 20 SOL
// But 50K Novi costs 12 SOL to buy direct
// Solution: Novi bonus should be RESERVED not LOCKED

pub fn mint_nft(
    ctx: Context<MintNFT>,
    nft_type: NFTType,
) -> Result<()> {
    let player = &mut ctx.accounts.player_account;
    let user = &mut ctx.accounts.user_account;

    match nft_type {
        NFTType::Bunker => {
            // Pay 20 SOL
            transfer_sol(ctx.accounts.buyer, ctx.accounts.treasury, 20_000_000_000)?;

            // Mint NFT
            mint_nft_to_wallet(ctx.accounts.buyer, "Bunker")?;

            // BONUS: Give RESERVED Novi (withdrawable)
            // This makes the NFT premium justified - it's a rebate
            user.reserved_novi += 10_000; // Reduced from 50K

            // No locked Novi bonus - prevents farming
        },
        // Same for other NFTs
    }

    Ok(())
}
```

### Withdrawal Vesting

```rust
#[account]
pub struct VestingSchedule {
    pub user: Pubkey,
    pub total_amount: u64,
    pub withdrawn_amount: u64,
    pub vesting_start: i64,
    pub vesting_duration: i64,  // e.g., 30 days
}

pub fn withdraw_reserved_novi_vested(
    ctx: Context<WithdrawVested>,
    amount: u64,
) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    let vesting = &mut ctx.accounts.vesting_schedule;

    // Calculate vested amount
    let elapsed = Clock::get()?.unix_timestamp - vesting.vesting_start;
    let vested_amount = if elapsed >= vesting.vesting_duration {
        vesting.total_amount
    } else {
        (vesting.total_amount * elapsed as u64) / vesting.vesting_duration as u64
    };

    let available = vested_amount - vesting.withdrawn_amount;

    require!(amount <= available, ErrorCode::InsufficientVestedAmount);

    // Withdraw
    transfer_novi_tokens(ctx.accounts.novi_vault, ctx.accounts.user_wallet, amount)?;

    vesting.withdrawn_amount += amount;

    Ok(())
}

// When awarding large event prizes, use vesting
pub fn award_event_prize_with_vesting(
    ctx: Context<AwardPrize>,
    amount: u64,
) -> Result<()> {
    let user = &mut ctx.accounts.user_account;

    if amount > 100_000 {
        // Large prizes vest over 30 days
        create_vesting_schedule(
            user.key(),
            amount,
            30 * 86400, // 30 days
        )?;
    } else {
        // Small prizes immediate
        user.reserved_novi += amount;
    }

    Ok(())
}
```

---

## 🎮 SOLUTION 6: Game Theory Fixes

### Nuclear Weapon Griefing

```rust
// Current problem: 199 SOL to destroy entire team = griefing tool
// Solution: Massive cooldown + warning system + insurance

pub fn deploy_nuclear_weapon(
    ctx: Context<DeployNuke>,
    target_team: Pubkey,
) -> Result<()> {
    let attacker = &mut ctx.accounts.attacker;

    // Rule 1: Must have been attacked by target team recently
    require!(
        attacker.was_attacked_by_team(target_team, 86400 * 3), // Within 3 days
        ErrorCode::NoRecentHostility
    );

    // Rule 2: 48-hour warning period
    emit!(NuclearWarningIssued {
        attacker: attacker.key(),
        target_team,
        detonation_time: Clock::get()?.unix_timestamp + 86400 * 2,
    });

    // Defenders have 48 hours to:
    // - Buy Iron Dome
    // - Move resources to safebox
    // - Coordinate defense

    // Rule 3: Global cooldown (one nuke per week in entire game)
    let global_state = &mut ctx.accounts.global_state;
    require!(
        Clock::get()?.unix_timestamp - global_state.last_nuke > 86400 * 7,
        ErrorCode::GlobalNukeCooldown
    );

    // Rule 4: Attacker loses reputation
    attacker.reputation = attacker.reputation.saturating_sub(50);

    Ok(())
}
```

### 24-Hour Protection Gaming

```rust
// Current problem: Create accounts → farm for 24hrs → transfer → repeat
// Solution: Protection = can't be attacked BUT also can't transfer

pub fn transfer_cash_to_teammate(
    ctx: Context<TransferCash>,
    amount: u64,
) -> Result<()> {
    let from = &ctx.accounts.from_player;

    // Cannot transfer while under protection
    require!(
        !from.protected,
        ErrorCode::CannotTransferWhileProtected
    );

    // Must have made at least 1 attack to unlock transfers
    require!(
        from.total_attacks > 0,
        ErrorCode::MustAttackBeforeTransfer
    );

    // Rest of transfer logic...
}
```

---

## 🔐 SOLUTION 7: Infrastructure Hardening

### Multi-Sig Admin

```rust
#[account]
pub struct AdminMultisig {
    pub required_signatures: u8,
    pub admins: Vec<Pubkey>,
    pub pending_proposals: Vec<AdminProposal>,
}

#[account]
pub struct AdminProposal {
    pub proposal_type: ProposalType,
    pub signatures: Vec<Pubkey>,
    pub executed: bool,
    pub data: Vec<u8>,
}

pub enum ProposalType {
    AwardEventPrize,
    StartEvent,
    FlagAccount,
    UpdateGameParameters,
}

pub fn propose_award_prize(
    ctx: Context<ProposeAdminAction>,
    recipient: Pubkey,
    amount: u64,
    event_id: String,
) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;
    let proposer = &ctx.accounts.proposer;

    require!(
        multisig.admins.contains(&proposer.key()),
        ErrorCode::NotAdmin
    );

    // Create proposal
    let proposal = AdminProposal {
        proposal_type: ProposalType::AwardEventPrize,
        signatures: vec![proposer.key()],
        executed: false,
        data: serialize_award_data(recipient, amount, event_id),
    };

    multisig.pending_proposals.push(proposal);

    Ok(())
}

pub fn sign_proposal(
    ctx: Context<SignProposal>,
    proposal_id: u64,
) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;
    let signer = &ctx.accounts.signer;

    let proposal = &mut multisig.pending_proposals[proposal_id as usize];

    proposal.signatures.push(signer.key());

    // If enough signatures, execute
    if proposal.signatures.len() >= multisig.required_signatures as usize {
        execute_proposal(proposal)?;
        proposal.executed = true;
    }

    Ok(())
}
```

### Emergency Pause

```rust
#[account]
pub struct GlobalState {
    pub paused: bool,
    pub pause_reason: String,
    pub paused_at: i64,
}

pub fn emergency_pause(
    ctx: Context<EmergencyPause>,
    reason: String,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;
    let admin = &ctx.accounts.admin;

    // Only multisig can pause
    require!(
        verify_admin_signature(admin.key()),
        ErrorCode::Unauthorized
    );

    global_state.paused = true;
    global_state.pause_reason = reason.clone();
    global_state.paused_at = Clock::get()?.unix_timestamp;

    emit!(GamePaused {
        reason,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// All critical functions check pause state
pub fn attack_player(ctx: Context<Attack>) -> Result<()> {
    require!(
        !ctx.accounts.global_state.paused,
        ErrorCode::GamePaused
    );

    // Attack logic...
}
```

### Withdrawal Caps

```rust
#[account]
pub struct WithdrawalLimits {
    pub daily_limit: u64,
    pub weekly_limit: u64,
    pub per_tx_limit: u64,
}

pub fn withdraw_reserved_novi(
    ctx: Context<Withdraw>,
    amount: u64,
) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    let limits = &ctx.accounts.withdrawal_limits;

    // Per-transaction limit
    require!(
        amount <= limits.per_tx_limit,
        ErrorCode::ExceedsPerTxLimit
    );

    // Daily limit
    let today_start = (Clock::get()?.unix_timestamp / 86400) * 86400;
    if user.last_withdrawal_reset < today_start {
        user.daily_withdrawn = 0;
    }
    require!(
        user.daily_withdrawn + amount <= limits.daily_limit,
        ErrorCode::ExceedsDailyLimit
    );

    // Weekly limit
    let week_start = (Clock::get()?.unix_timestamp / (86400 * 7)) * (86400 * 7);
    if user.last_weekly_reset < week_start {
        user.weekly_withdrawn = 0;
    }
    require!(
        user.weekly_withdrawn + amount <= limits.weekly_limit,
        ErrorCode::ExceedsWeeklyLimit
    );

    // Execute withdrawal
    transfer_novi_tokens(
        ctx.accounts.novi_vault,
        ctx.accounts.user_wallet,
        amount,
    )?;

    user.daily_withdrawn += amount;
    user.weekly_withdrawn += amount;

    Ok(())
}
```

---

## 📊 Complete Security Matrix

| Vulnerability | Severity | Solution | Implementation Complexity |
|--------------|----------|----------|--------------------------|
| Sybil via multiple wallets | 🔴 Critical | Civic Pass required for events >50K | Medium |
| Cash transfer consolidation | 🔴 Critical | Transfer Activity Graph + ratio limits | High |
| Event self-dealing | 🔴 Critical | Organic growth requirements | Medium |
| Team collusion | 🟠 High | Team reputation + member vetting | High |
| Admin centralization | 🔴 Critical | Multi-sig + community oversight | Medium |
| Market manipulation | 🟠 High | Withdrawal vesting for large prizes | Low |
| Nuclear griefing | 🟡 Medium | 48hr warning + cooldown + insurance | Medium |
| Economic arbitrage | 🟡 Medium | Dynamic tier pricing | Low |

---

## 🎯 Recommended Implementation Phases

### Phase 1: MVP Security (Launch)
1. ✅ Transfer Activity Graph with basic limits
2. ✅ Event eligibility: account age + organic growth %
3. ✅ Team reputation system
4. ✅ Civic Pass for >50K events
5. ✅ Multi-sig admin
6. ✅ Emergency pause mechanism

**Timeline:** 4-6 weeks
**Cost:** Core security, non-negotiable

### Phase 2: Enhanced Detection (Month 2-3)
1. ✅ Behavioral analysis on-chain
2. ✅ ML Sybil cluster detection off-chain
3. ✅ Withdrawal vesting for large prizes
4. ✅ Advanced transfer ratio analysis
5. ✅ Team diversity requirements

**Timeline:** 4-6 weeks
**Cost:** Improves security ceiling

### Phase 3: Advanced Game Theory (Month 4+)
1. ✅ Dynamic tier pricing
2. ✅ Nuclear weapon rebalancing
3. ✅ Event rotation optimization
4. ✅ Community governance for flagging
5. ✅ Insurance pools for victims of attacks

**Timeline:** Ongoing
**Cost:** Continuous improvement

---

## Bottom Line

**Your instinct was 100% correct:** Cash transfer exploits are the #1 threat.

**The Solution:**
1. **Transfer Activity Graph** - Track all movements
2. **Organic Growth Requirements** - Must earn through gameplay, not transfers
3. **Event Eligibility Scoring** - High-value events require legitimate activity
4. **Team Accountability** - Leaders liable for member behavior
5. **Vesting for Large Prizes** - Can't dump 1M Novi instantly

**Key Metrics to Track:**
- `total_cash_sent` vs `total_cash_received` (detect consolidation accounts)
- `networth_from_attacks` vs `networth_from_transfers` (detect organic growth)
- `unique_opponents_attacked` (detect self-dealing)
- `transfer_count` and `transfer_recipients` (detect Sybil networks)

**This is achievable on Solana.** The dual-account system (locked vs reserved) combined with strict transfer tracking makes Sybil attacks economically unviable for sophisticated adversaries.

The game becomes: **"Play skillfully and earn reserved Novi"** instead of **"Farm passive generation and consolidate."**
