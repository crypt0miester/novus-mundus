# Team System Redesign

## Overview

This document outlines the redesign of the team system to be more efficient and flexible:
- **TeamAccount**: Reduced from ~1800 bytes to ~160 bytes (no inline members array)
- **TeamMemberSlot**: New PDA per member (deterministic, no getProgramAccounts needed)
- **TeamInviteAccount**: New PDA for invites (replaces inline invite in PlayerCore)
- **PlayerCore**: Updated team fields (add rank/slot, remove invite fields)

---

## 1. Constants (constants.rs)

### New Seeds
```rust
pub const TEAM_SLOT_SEED: &[u8] = b"team_slot";
pub const TEAM_INVITE_SEED: &[u8] = b"team_invite";
```

---

## 2. TeamAccount (state/team.rs)

### Current Structure (~1800 bytes)
```rust
pub struct TeamAccount {
    pub id: u64,                    // 8
    pub leader: Pubkey,             // 32
    pub name: [u8; 32],             // 32
    pub name_len: u8,               // 1
    pub disbanded: bool,            // 1
    pub bump: u8,                   // 1
    pub _padding1: [u8; 5],         // 5
    pub members: [Pubkey; 50],      // 1600 <-- REMOVED
    pub member_count: u8,           // 1
    pub _padding2: [u8; 7],         // 7
    pub created_at: i64,            // 8
    pub treasury: u64,              // 8
    pub _reserved: [u8; 64],        // 64
}
```

### New Structure (~160 bytes)
```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamAccount {
    // === IDENTITY (42 bytes) ===
    pub id: u64,                    // 8 - Unique team ID (for PDA derivation)
    pub leader: Pubkey,             // 32 - Team leader's player account pubkey
    pub bump: u8,                   // 1 - PDA bump seed
    pub disbanded: bool,            // 1 - True if team has been disbanded

    // === NAME (34 bytes) ===
    pub name: [u8; 32],             // 32 - Team name (UTF-8)
    pub name_len: u8,               // 1 - Actual name length
    pub _padding1: u8,              // 1 - Alignment

    // === MEMBERSHIP (8 bytes) ===
    pub member_count: u16,          // 2 - Current member count
    pub max_members: u16,           // 2 - Max members (tier-based, can be upgraded)
    pub _padding2: [u8; 4],         // 4 - Alignment

    // === TIMESTAMPS (16 bytes) ===
    pub created_at: i64,            // 8 - Team creation timestamp
    pub last_activity: i64,         // 8 - Last activity (for inactive team cleanup)

    // === TREASURY (8 bytes) ===
    pub treasury: u64,              // 8 - Current treasury balance

    // === SETTINGS (8 bytes) ===
    pub settings: u8,               // 1 - Bitfield: auto_accept, public, etc.
    pub min_level_to_join: u8,      // 1 - Minimum player level to join
    pub _padding3: [u8; 6],         // 6 - Alignment

    // === MOTD (48 bytes) ===
    pub motd: [u8; 44],             // 44 - Message of the day
    pub motd_len: u8,               // 1 - MOTD length
    pub _padding4: [u8; 3],         // 3 - Alignment
}

impl TeamAccount {
    pub const LEN: usize = 164; // Verified by static assertion

    // Settings bitfield constants
    pub const SETTING_PUBLIC: u8 = 1 << 0;        // Anyone can join (no invite needed)
    pub const SETTING_AUTO_ACCEPT: u8 = 1 << 1;   // Auto-accept join requests
}
```

### PDA Derivation (unchanged)
- Seeds: `[TEAM_SEED, team_id_le_bytes]`
- Example: `[b"team", &team_id.to_le_bytes()]`

---

## 3. TeamMemberSlot (state/team.rs) - NEW

Each team member gets their own PDA account. Deterministic slot indices allow efficient batch fetching.

### Structure (56 bytes)
```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamMemberSlot {
    // === IDENTITY (11 bytes) ===
    pub team_id: u64,               // 8 - Team this slot belongs to
    pub slot_index: u16,            // 2 - Slot index (0 to max_members-1)
    pub bump: u8,                   // 1 - PDA bump seed

    // === MEMBER (32 bytes) ===
    pub player: Pubkey,             // 32 - Player account pubkey (not wallet!)

    // === TIMESTAMPS (8 bytes) ===
    pub joined_at: i64,             // 8 - When member joined

    // === RESERVED (5 bytes) ===
    pub _reserved: [u8; 5],         // 5 - Future use
}

impl TeamMemberSlot {
    pub const LEN: usize = 56;
}
```

### Account Lifecycle
- **Account exists** = slot is occupied
- **Account is null** = slot is empty
- When member leaves/kicked → account is **closed** (rent returned)
- No zombie accounts with empty flags

### PDA Derivation
- Seeds: `[TEAM_SLOT_SEED, team_id_le_bytes, slot_index_le_bytes]`
- Example: `[b"team_slot", &team_id.to_le_bytes(), &slot_index.to_le_bytes()]`

### Client Usage
```typescript
// Fetch all members efficiently (no getProgramAccounts!)
const team = await program.account.teamAccount.fetch(teamPda);
const slotPdas = [];

for (let i = 0; i < team.maxMembers; i++) {
  const [slotPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("team_slot"), team.id.toArrayLike(Buffer, "le", 8), new BN(i).toArrayLike(Buffer, "le", 2)],
    programId
  );
  slotPdas.push(slotPda);
}

// Batch fetch all slots in one RPC call
const slots = await connection.getMultipleAccountsInfo(slotPdas);

// null = empty slot, non-null = occupied
const members = slots
  .map((s, i) => s ? { slot: i, data: parseSlot(s.data) } : null)
  .filter(Boolean); // Filter out nulls (empty slots)

// Find first empty slot for new member
const firstEmptySlot = slots.findIndex(s => s === null);
```

---

## 4. TeamInviteAccount (state/team.rs) - NEW

Replaces `pending_team_invite` in PlayerCore. Allows multiple teams to invite the same user.

### Structure (96 bytes)
```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamInviteAccount {
    // === IDENTITY (65 bytes) ===
    pub team: Pubkey,               // 32 - Team account pubkey
    pub invitee: Pubkey,            // 32 - Invitee's player account pubkey
    pub bump: u8,                   // 1 - PDA bump seed

    // === INVITE INFO (41 bytes) ===
    pub inviter: Pubkey,            // 32 - Who sent the invite (for UI display)
    pub created_at: i64,            // 8 - When invite was created
    pub expires_at: i64,            // 8 - When invite expires (0 = never)

    // === RESERVED (8 bytes) ===
    pub _reserved: [u8; 8],         // 8 - Future use (message, etc.)
}

impl TeamInviteAccount {
    pub const LEN: usize = 96; // Padded to 96 for alignment
}
```

### PDA Derivation
- Seeds: `[TEAM_INVITE_SEED, team_pubkey, invitee_pubkey]`
- Example: `[b"team_invite", team.key().as_ref(), invitee.key().as_ref()]`

### Lifecycle
1. **Create**: Leader/officer calls `invite_to_team` - creates TeamInviteAccount
2. **Accept**: Invitee calls `join_team` - closes TeamInviteAccount, creates TeamMemberSlot
3. **Decline**: Invitee calls `decline_invite` - closes TeamInviteAccount
4. **Cancel**: Leader/officer calls `cancel_invite` - closes TeamInviteAccount
5. **Expire**: Anyone can call `cleanup_expired_invite` after expiry - closes account

### Client Usage
```typescript
// Check if user has pending invite from a specific team
const [invitePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("team_invite"), teamPubkey.toBuffer(), playerPubkey.toBuffer()],
  programId
);

const invite = await connection.getAccountInfo(invitePda);
const hasInvite = invite !== null;
```

---

## 5. PlayerCore Changes (state/player.rs)

### Current Team Fields
```rust
// Team (48 bytes) - mirrored from TeamSection
pub team: Pubkey,                   // 32 bytes
pub has_team: bool,                 // 1 byte      <-- REMOVED (redundant)
pub _padding_team: [u8; 7],         // 7 bytes
pub pending_team_invite: Pubkey,    // 32 bytes    <-- REMOVED
pub team_invite_expires_at: i64,    // 8 bytes     <-- REMOVED
```

### New Team Fields
```rust
// Team (32 bytes) - 48 bytes saved!
pub team: Pubkey,                   // 32 bytes - Team account pubkey (NULL_PUBKEY if none)
```

### Checking Team Membership
```rust
// In code:
let has_team = player.team != NULL_PUBKEY;

// To check if leader:
let is_leader = player.team != NULL_PUBKEY && team.leader == *player_account.key();
```

### Size Impact
- **Before**: 48 bytes for team fields
- **After**: 32 bytes for team fields
- **Savings**: 16 bytes per PlayerCore

---

## 6. TeamSection Changes (state/player.rs)

### Current Structure (88 bytes)
```rust
pub struct TeamSection {
    pub team: Pubkey,               // 32
    pub has_team: bool,             // 1    <-- REMOVED
    pub _padding1: [u8; 7],         // 7
    pub pending_team_invite: Pubkey,// 32   <-- REMOVED
    pub team_invite_expires_at: i64,// 8    <-- REMOVED
    pub _reserved: [u8; 4],         // 4
}
```

### New Structure (40 bytes)
```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamSection {
    // === MEMBERSHIP (32 bytes) ===
    pub team: Pubkey,               // 32 - Team account pubkey (NULL_PUBKEY if none)

    // === RESERVED (8 bytes) ===
    pub _reserved: [u8; 8],         // 8 - Future use
}

impl TeamSection {
    pub const LEN: usize = 40;
}
```

### Size Constants Update
```rust
pub const TEAM_SIZE: usize = 40;  // Was 88, now 40 (48 bytes saved!)
```

**Note**: This changes offsets for COSMETICS_OFFSET and MAX_SIZE. Need to update:
- `COSMETICS_OFFSET = TEAM_OFFSET + TEAM_SIZE` (will be 48 bytes smaller)
- `MAX_SIZE = COSMETICS_OFFSET + COSMETICS_SIZE` (will be 48 bytes smaller)

---

## 7. Summary of Changes

### Files to Modify
1. `constants.rs` - Add TEAM_SLOT_SEED, TEAM_INVITE_SEED
2. `state/team.rs` - Rewrite TeamAccount, add TeamMemberSlot, add TeamInviteAccount
3. `state/player.rs` - Update PlayerCore team fields, update TeamSection, update size constants
4. `state/mod.rs` - Export new types

### Account Sizes
| Account | Before | After | Change |
|---------|--------|-------|--------|
| TeamAccount | ~1800 bytes | 164 bytes | -91% |
| TeamMemberSlot | N/A | 56 bytes | NEW |
| TeamInviteAccount | N/A | 96 bytes | NEW |
| PlayerCore | 1056 bytes | 1040 bytes | -16 bytes |
| TeamSection | 88 bytes | 40 bytes | -48 bytes |

### Rent Costs (approximate at 6.96 lamports/byte)
| Account | Before | After |
|---------|--------|-------|
| TeamAccount | ~12,500 lamports | ~1,150 lamports |
| 50-member team total | ~12,500 lamports | ~1,150 + (50 × 450) = ~23,650 lamports |

**Note**: Total rent for a full 50-member team is higher with the new system, BUT:
- Each member pays their own slot rent (~450 lamports)
- Team creator only pays ~1,150 lamports upfront
- Empty slots don't cost anything
- Slots are closed when members leave (rent returned)

---

## 8. Migration Notes

Since the program is not deployed yet, no migration is needed. Just update the structs and recompile.

---

## 9. Processor Changes Required

After implementing the state changes, these processors need updating:

### Team Processors to Update
- `create.rs` - Initialize new TeamAccount format
- `join.rs` - Create TeamMemberSlot, close TeamInviteAccount
- `leave.rs` - Close TeamMemberSlot, update team.member_count
- `kick.rs` - Close target's TeamMemberSlot
- `disband.rs` - Close all TeamMemberSlots
- `invite.rs` - Create TeamInviteAccount (NEW instruction)
- `cancel_invite.rs` - Close TeamInviteAccount (NEW instruction)
- `decline_invite.rs` - Close TeamInviteAccount (NEW instruction)
- `withdraw_treasury.rs` - Check if player is leader via team.leader
- `deposit_treasury.rs` - Check player.team != NULL_PUBKEY
- `transfer_leadership.rs` - Update team.leader (NEW instruction)
- `set_motd.rs` - Update team.motd (NEW instruction)
- `update_settings.rs` - Update team.settings, team.min_level_to_join (NEW instruction)

### Other Processors to Check
- Any processor that reads `pending_team_invite` or `team_invite_expires_at` from PlayerCore
- Any processor that reads `has_team` from PlayerCore (replace with `team != NULL_PUBKEY`)

---

## 10. New Instructions Detail

### set_motd

Sets or clears the team's message of the day.

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | team | | ✓ | Team account to update |
| 1 | leader | ✓ | | Team leader's wallet |
| 2 | leader_player | | | Leader's PlayerAccount (to verify membership) |

**Instruction Data:**
```rust
// [0] motd_len: u8 (0-44, 0 = clear MOTD)
// [1..1+motd_len] motd: UTF-8 bytes
```

**Validation:**
1. `leader` is signer
2. `leader_player.owner == leader.key()`
3. `leader_player.team == team.key()`
4. `team.leader == leader_player.key()`
5. `motd_len <= 44`

**Logic:**
```rust
team.motd[..motd_len].copy_from_slice(&instruction_data[1..1+motd_len]);
team.motd_len = motd_len;
```

---

### update_settings

Updates team settings (public/private, min level, etc).

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | team | | ✓ | Team account to update |
| 1 | leader | ✓ | | Team leader's wallet |
| 2 | leader_player | | | Leader's PlayerAccount |

**Instruction Data:**
```rust
// [0] settings: u8 (bitfield)
// [1] min_level_to_join: u8
```

**Settings Bitfield:**
```rust
pub const SETTING_PUBLIC: u8 = 1 << 0;      // Anyone can join without invite
pub const SETTING_AUTO_ACCEPT: u8 = 1 << 1; // Auto-accept join requests (future)
```

---

### invite

Creates an invite for a player to join the team.

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | team | | | Team account |
| 1 | inviter | ✓ | ✓ | Inviter's wallet (pays rent) |
| 2 | inviter_player | | | Inviter's PlayerAccount |
| 3 | invitee_player | | | Invitee's PlayerAccount |
| 4 | invite | | ✓ | TeamInviteAccount PDA (created) |
| 5 | system_program | | | System program |

**Instruction Data:**
```rust
// [0..8] expires_in_seconds: i64 (0 = use default 7 days)
```

**Validation:**
1. Inviter is team leader (check `team.leader == inviter_player.key()`)
2. Invitee not already in a team (`invitee_player.team == NULL_PUBKEY`)
3. Team not full (`team.member_count < team.max_members`)
4. Invite PDA doesn't already exist

---

### cancel_invite

Leader cancels a pending invite.

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | team | | | Team account |
| 1 | leader | ✓ | ✓ | Leader's wallet (receives rent) |
| 2 | leader_player | | | Leader's PlayerAccount |
| 3 | invite | | ✓ | TeamInviteAccount PDA (closed) |

**Logic:**
1. Verify leader is team leader
2. Verify invite.team == team.key()
3. Close invite account, refund rent to leader

---

### decline_invite

Invitee declines a pending invite.

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | invitee | ✓ | ✓ | Invitee's wallet (receives rent) |
| 1 | invitee_player | | | Invitee's PlayerAccount |
| 2 | invite | | ✓ | TeamInviteAccount PDA (closed) |

**Logic:**
1. Verify invitee owns invitee_player
2. Verify invite.invitee == invitee_player.key()
3. Close invite account, refund rent to invitee

---

### transfer_leadership

Transfer team leadership to another member.

**Accounts:**
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | team | | ✓ | Team account |
| 1 | current_leader | ✓ | | Current leader's wallet |
| 2 | current_leader_player | | | Current leader's PlayerAccount |
| 3 | new_leader_player | | | New leader's PlayerAccount |
| 4 | new_leader_slot | | | New leader's TeamMemberSlot (verify membership) |

**Validation:**
1. `team.leader == current_leader_player.key()`
2. `new_leader_player.team == team.key()`
3. `new_leader_slot.player == new_leader_player.key()`

**Logic:**
```rust
team.leader = *new_leader_player.key();
```
