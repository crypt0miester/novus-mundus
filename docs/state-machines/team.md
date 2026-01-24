# Team System State Machine

## Overview

The Team system manages guilds/alliances where players coordinate rallies, share reinforcements, and access team treasury. Teams have a hierarchical structure with roles and permissions.

---

## 1. Team Lifecycle

### States

| State | Description |
|-------|-------------|
| `NonExistent` | Team PDA doesn't exist |
| `Active` | Team operational |
| `Disbanded` | Team marked for deletion |

### State Diagram

```
┌────────────────┐  create_team    ┌────────────────┐
│                │ ─────────────> │                │
│  NonExistent   │                │     Active     │
│                │                │                │
└────────────────┘                └───────┬────────┘
       ▲                                  │
       │                                  │ disband_team
       │ account closure                  ▼
       │                          ┌────────────────┐
       └──────────────────────────│                │
                                  │   Disbanded    │
                                  │                │
                                  └────────────────┘
```

### Transitions

#### `NonExistent` → `Active`
```
Trigger: create_team
Guards:
  - Creator not on any team
  - Team name unique
  - Sufficient NOVI for creation cost
Actions:
  - Create TeamAccount PDA: [TEAM_SEED, team_id]
  - Set creator as leader (role = 3)
  - Set team name
  - Initialize member count = 1
  - Update creator.team = team_pubkey
  - Update creator.team_slot_index = 0
  - Emit TeamCreated
```

#### `Active` → `Disbanded`
```
Trigger: disband_team
Guards:
  - Caller is leader
  - All members except leader have left
  - Treasury is empty
Actions:
  - Mark team as disbanded
  - Clear leader's team reference
  - Emit TeamDisbanded
```

---

## 2. Membership Lifecycle

### States

| State | Description |
|-------|-------------|
| `NotMember` | Player not on any team |
| `Invited` | Pending invite exists |
| `Member` | Active team member |

### Roles

| Role | Value | Permissions |
|------|-------|-------------|
| Member | 0 | Basic access |
| Officer | 1 | Invite, kick lower ranks |
| Co-Leader | 2 | Treasury access, promote |
| Leader | 3 | Full control, disband |

### State Diagram

```
┌────────────────┐  receive_invite  ┌────────────────┐
│                │ ───────────────> │                │
│   NotMember    │                  │    Invited     │
│                │ <─────────────── │                │
└───────┬────────┘  decline_invite  └───────┬────────┘
        │                                   │
        │ join_team                         │ accept_invite
        │ (open team)                       │
        ▼                                   ▼
┌────────────────────────────────────────────────────┐
│                      Member                         │
│  ┌────────┐  promote  ┌─────────┐  promote  ┌────┐ │
│  │ Member │ ────────> │ Officer │ ────────> │CoL │ │
│  │(role=0)│ <──────── │(role=1) │ <──────── │ (2)│ │
│  └────────┘  demote   └─────────┘  demote   └────┘ │
└────────────────────────────────────────────────────┘
        │
        │ leave_team / kick_member
        ▼
┌────────────────┐
│   NotMember    │
└────────────────┘
```

### Transitions

#### `NotMember` → `Invited`
```
Trigger: invite_to_team
Guards:
  - Caller has Officer+ role
  - Target not on any team
  - No pending invite to target
  - Team not at member cap
Actions:
  - Create TeamInviteAccount PDA
  - Set expiration time
  - Emit InviteSent
```

#### `Invited` → `Member`
```
Trigger: accept_invite
Guards:
  - Valid invite exists
  - Invite not expired
  - Team not disbanded
  - Team not at member cap
Actions:
  - Find empty slot in team.members
  - Set player.team = team_pubkey
  - Set player.team_slot_index = slot
  - Increment team.member_count
  - Close invite account
  - Emit MemberJoined
```

#### `Invited` → `NotMember`
```
Trigger: decline_invite
Guards:
  - Valid invite exists
Actions:
  - Close invite account
  - Emit InviteDeclined
```

#### `NotMember` → `Member` (Open Join)
```
Trigger: join_team
Guards:
  - Team is open (join_type = Open)
  - Player not on any team
  - Team not at member cap
Actions:
  - Same as accept_invite
  - Emit MemberJoined
```

#### `Member` → `NotMember`
```
Trigger: leave_team
Guards:
  - Player is team member
  - Player is not leader (leader must disband or transfer)
Actions:
  - Clear team.members[slot]
  - Decrement team.member_count
  - Clear player.team
  - Clear player.team_slot_index
  - Emit MemberLeft
```

---

## 3. Leadership Transfer

### Transition

#### Transfer Leadership
```
Trigger: transfer_leadership
Guards:
  - Caller is leader
  - Target is team member
Actions:
  - Set target role = Leader (3)
  - Set caller role = Co-Leader (2)
  - Emit LeadershipTransferred
```

---

## 4. Role Management

### Promote
```
Trigger: promote_member
Guards:
  - Caller.role > target.role
  - target.role < 2 (cannot promote to leader)
Actions:
  - Increment target role
  - Emit MemberPromoted
```

### Demote
```
Trigger: demote_member
Guards:
  - Caller.role > target.role
  - target.role > 0
Actions:
  - Decrement target role
  - Emit MemberDemoted
```

### Kick
```
Trigger: kick_member
Guards:
  - Caller.role > target.role
  - Target != leader
Actions:
  - Clear target from team
  - Decrement member_count
  - Clear target's player.team
  - Emit MemberKicked
```

---

## 5. Treasury System

### States

| State | Description |
|-------|-------------|
| `NoRequest` | No withdrawal pending |
| `RequestPending` | Withdrawal request active |

### Transitions

#### Deposit
```
Trigger: deposit_treasury
Guards:
  - Player is team member
  - Amount > 0
Actions:
  - Transfer NOVI from player to team treasury
  - Emit TreasuryDeposit
```

#### Request Withdrawal
```
Trigger: treasury_request_withdraw
Guards:
  - Caller is Co-Leader+
  - Amount <= treasury balance
  - No pending request
Actions:
  - Create withdrawal request
  - Set required_approvals based on settings
  - Emit WithdrawalRequested
```

#### Approve Request
```
Trigger: treasury_approve_request
Guards:
  - Valid request exists
  - Caller is Co-Leader+
  - Caller hasn't already approved
Actions:
  - Add approval
  - If approvals >= required:
    - Mark ready for execution
  - Emit WithdrawalApproved
```

#### Execute Request
```
Trigger: treasury_execute_request
Guards:
  - Request has sufficient approvals
  - Caller is requester
Actions:
  - Transfer NOVI from treasury to recipient
  - Clear request
  - Emit WithdrawalExecuted
```

#### Reject/Cancel Request
```
Trigger: treasury_reject_request / treasury_cancel_request
Guards:
  - Valid request exists
  - Caller has permission (reject: Co-Leader+, cancel: requester)
Actions:
  - Clear request
  - Emit WithdrawalRejected / WithdrawalCancelled
```

---

## 6. Team Settings

### Configurable Settings

| Setting | Options |
|---------|---------|
| Join Type | Open, InviteOnly |
| Min Level | 1-100 |
| Treasury Approvals | 1-3 required |
| MOTD | Message of the Day |

### Update Settings
```
Trigger: update_team_settings
Guards:
  - Caller is Co-Leader+
Actions:
  - Update specified settings
  - Emit SettingsUpdated
```

### Set MOTD
```
Trigger: set_team_motd
Guards:
  - Caller is Officer+
Actions:
  - Update team.motd
  - Emit MOTDUpdated
```

---

## 7. Account Structures

### TeamAccount (296 bytes)
```rust
pub struct TeamAccount {
    pub id: u64,
    pub leader: Pubkey,
    pub name: [u8; 32],
    pub name_len: u8,
    pub created_at: i64,
    pub member_count: u8,
    pub max_members: u8,
    pub join_type: u8,
    pub min_join_level: u8,
    pub is_disbanded: bool,

    // Treasury
    pub treasury_balance: u64,
    pub treasury_approvals_required: u8,

    // Current withdrawal request
    pub withdrawal_amount: u64,
    pub withdrawal_recipient: Pubkey,
    pub withdrawal_approvals: u8,
    pub withdrawal_approved_by: [bool; 8],

    // Settings
    pub motd: [u8; 128],
    pub motd_len: u8,

    // Member slots (role per slot)
    pub member_roles: [u8; 50],  // MAX_TEAM_SIZE

    pub bump: u8,
}
```

### TeamInviteAccount (80 bytes)
```rust
pub struct TeamInviteAccount {
    pub team: Pubkey,
    pub invitee: Pubkey,
    pub inviter: Pubkey,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}
```

### PlayerAccount Team Fields
```rust
pub team: Pubkey,           // NULL_PUBKEY if not on team
pub team_slot_index: u8,    // Index in team.members array
```

---

## 8. Invariants

```
1. Player can only be on one team
2. Team must have exactly one leader
3. Leader cannot leave (must transfer or disband)
4. Member count matches actual members
5. Role hierarchy: Leader > Co-Leader > Officer > Member
6. Can only promote to one rank below own
7. Cannot kick equal or higher rank
8. Treasury requires approval for withdrawals
9. Disbanded teams cannot accept new members
10. Team name must be unique
```
