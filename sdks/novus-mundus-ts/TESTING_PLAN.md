# Novus Mundus End-to-End Testing Plan

## Overview

This document outlines a comprehensive E2E testing strategy for all game systems. Tests are organized by feature domain, with each test flow covering the complete lifecycle of that feature.

## Test Infrastructure

### Test Fixtures
```
tests/
├── fixtures/
│   ├── setup.ts           # Global test setup (game engine, cities, etc.)
│   ├── players.ts         # Test player factory
│   ├── heroes.ts          # Hero minting helpers
│   └── time.ts            # Clock manipulation for time-based tests
├── utils/
│   ├── assertions.ts      # Custom assertions for game state
│   ├── transactions.ts    # TX helpers (send, confirm, parse events)
│   └── accounts.ts        # Account fetching & deserialization
├── e2e/
│   ├── 01-player.test.ts
│   ├── 02-economy.test.ts
│   ├── 03-combat.test.ts
│   ├── ... (all test files)
└── integration/
    └── full-game-flow.test.ts  # Complete game simulation
```

### Test Wallet Strategy
- **DAO Authority**: Single wallet for admin operations
- **Treasury**: Receives all payments
- **Player Pool**: 10+ test wallets for multiplayer scenarios
- **Attacker/Defender**: Dedicated wallets for combat tests

---

## Test Suites

### 1. Player Lifecycle (`01-player.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `player:init` | Initialize new player in city | Player PDA created, starter resources granted, location set |
| `player:init:duplicate` | Reject duplicate player init | Transaction fails with AlreadyInitialized |
| `player:init:invalid-city` | Reject invalid starting city | Transaction fails with CityNotFound |
| `player:starter-resources` | Verify starter pack (Rookie tier) | 100 locked NOVI, units, equipment, protection timer |
| `player:protection` | New player protection (24h) | Cannot be attacked, can attack others |
| `player:protection:expire` | Protection expires after 24h | Advance clock, verify attackable |

**Flows:**
```
1. Init Player → Verify State → Check Location → Verify NOVI Balance
2. Init Player → Wait 24h → Verify Protection Expired
```

---

### 2. Economy (`02-economy.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `economy:collect-resources` | Collect hourly resources | Resources increase based on buildings |
| `economy:collect:cooldown` | Reject early collection | Must wait full interval |
| `economy:hire-units` | Hire defensive/operative units | NOVI deducted, units added |
| `economy:hire:insufficient-funds` | Reject insufficient NOVI | Transaction fails |
| `economy:purchase-equipment` | Buy equipment with NOVI | Equipment inventory updated |
| `economy:purchase-stamina` | Buy stamina refill | Stamina restored, NOVI deducted |
| `economy:transfer-cash` | Transfer cash between players | Sender/receiver balances updated |
| `economy:vault-transfer` | Move resources to/from vault | Protected vs available resources |
| `economy:mint-for-prize` | Mint NOVI for event prize | Only authorized callers |

**Flows:**
```
1. Init → Build Resource Building → Wait → Collect → Verify Increase
2. Init → Earn NOVI → Hire Units → Verify Army Size
3. Player A → Transfer Cash → Player B → Verify Both Balances
```

---

### 3. Combat (`03-combat.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `combat:attack-player` | PvP attack | Combat resolved, loot transferred, events emitted |
| `combat:attack:protected` | Attack protected player | Transaction fails |
| `combat:attack:same-team` | Attack teammate | Transaction fails |
| `combat:attack:self` | Attack self | Transaction fails |
| `combat:attack:insufficient-stamina` | Attack without stamina | Transaction fails |
| `combat:attack-encounter` | PvE encounter attack | Encounter defeated, rewards claimed |
| `combat:win-scenario` | Attacker wins | Defender loses resources, attacker gains |
| `combat:lose-scenario` | Defender wins | Attacker loses army, no loot |
| `combat:draw-scenario` | Draw result | Minimal losses both sides |

**Flows:**
```
1. Setup Attacker (strong) + Defender (weak) → Attack → Verify Attacker Wins
2. Setup Attacker (weak) + Defender (strong) → Attack → Verify Defender Wins
3. Spawn Encounter → Attack → Defeat → Claim Rewards
```

---

### 4. Team/Guild (`04-team.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `team:create` | Create new team | Team PDA, leader slot, treasury |
| `team:create:duplicate-name` | Reject duplicate team name | Transaction fails |
| `team:join` | Join open team | Member slot created |
| `team:join:full` | Join full team | Transaction fails |
| `team:leave` | Leave team | Slot freed, member count updated |
| `team:disband` | Leader disbands team | All slots closed, team marked inactive |
| `team:invite` | Send invite | Invite PDA created |
| `team:accept-invite` | Accept invite | Member added, invite closed |
| `team:decline-invite` | Decline invite | Invite closed |
| `team:cancel-invite` | Cancel sent invite | Invite closed |
| `team:kick` | Kick member | Member removed |
| `team:promote` | Promote to officer | Role updated |
| `team:demote` | Demote to member | Role updated |
| `team:transfer-leadership` | Transfer leader role | New leader, old becomes officer |
| `team:set-motd` | Set message of the day | MOTD updated |
| `team:treasury:deposit` | Deposit to treasury | Treasury balance increased |
| `team:treasury:withdraw` | Withdraw (leader only) | Treasury balance decreased |
| `team:treasury:request` | Request withdrawal | Request PDA created |
| `team:treasury:approve` | Approve request | Approval count increased |
| `team:treasury:reject` | Reject request | Request closed |
| `team:treasury:execute` | Execute approved request | Funds transferred |

**Flows:**
```
1. Create Team → Invite Player B → Accept → Verify 2 Members
2. Create Team → Add 3 Members → Kick 1 → Verify Count
3. Leader → Deposit Treasury → Request Withdraw → Approve → Execute
```

---

### 5. Travel (`05-travel.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `travel:intracity:start` | Start intracity movement | Travel state set, ETA calculated |
| `travel:intracity:complete` | Complete intracity travel | Location updated, travel cleared |
| `travel:intracity:cancel` | Cancel intracity travel | Travel cleared, location unchanged |
| `travel:intercity:start` | Start intercity movement | Travel state, longer duration |
| `travel:intercity:complete` | Complete intercity travel | City changed |
| `travel:intercity:cancel` | Cancel intercity travel | Return to origin |
| `travel:intercity:teleport` | Instant teleport (paid) | Immediate city change, NOVI deducted |
| `travel:speedup` | Speed up travel | ETA reduced, NOVI deducted |
| `travel:complete:early` | Complete before ETA | Transaction fails |

**Flows:**
```
1. Start Intracity → Wait → Complete → Verify New Location
2. Start Intercity → Cancel → Verify Original City
3. Start Intercity → Teleport → Verify Instant Arrival
```

---

### 6. Rally (`06-rally.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `rally:create` | Create rally against target | Rally PDA, creator as participant |
| `rally:join` | Join existing rally | Participant PDA, troop commitment |
| `rally:leave` | Leave rally | Troops returned |
| `rally:cancel` | Creator cancels | All troops returned |
| `rally:execute` | Execute rally attack | Combined attack, loot distributed |
| `rally:execute:early` | Execute before timer | Transaction fails |
| `rally:process-return` | Process returning troops | Troops restored to players |
| `rally:speedup` | Speed up rally timer | Timer reduced |
| `rally:close` | Close completed rally | Cleanup participant accounts |

**Flows:**
```
1. Create Rally → 3 Players Join → Execute → Distribute Loot → Close
2. Create Rally → Join → Cancel → Verify Troops Returned
```

---

### 7. Reinforcement (`07-reinforcement.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `reinforce:send` | Send troops to ally | Reinforcement PDA, travel time |
| `reinforce:process-arrival` | Troops arrive | Added to defender's defense |
| `reinforce:recall` | Recall own troops | Start return journey |
| `reinforce:relieve` | Host relieves troops | Troops sent home |
| `reinforce:process-return` | Troops return home | Added back to sender |
| `reinforce:speedup` | Speed up travel | ETA reduced |
| `reinforce:send:enemy` | Send to non-ally | Transaction fails |

**Flows:**
```
1. Player A → Send to B → Arrive → B Gets Attacked → Reinforcements Help
2. Send → Arrive → Recall → Return → Verify Restored
```

---

### 8. Research (`08-research.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `research:create-progress` | Initialize research progress | Progress PDA created |
| `research:start` | Start research | Timer set, NOVI deducted |
| `research:start:prereq-missing` | Start without prereq | Transaction fails |
| `research:complete` | Complete research | Level increased, buffs applied |
| `research:complete:early` | Complete before timer | Transaction fails |
| `research:cancel` | Cancel in-progress | Partial refund |
| `research:speedup` | Speed up with NOVI | Timer reduced |
| `research:ascend` | Prestige reset | Levels reset, bonus multiplier |

**Flows:**
```
1. Start Research → Wait → Complete → Verify Buff Applied
2. Start → Speedup → Complete Early
3. Max All Research → Ascend → Verify Multiplier
```

---

### 9. Hero NFTs (`09-hero.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `hero:mint` | Mint hero NFT | NFT created, attributes set |
| `hero:mint:max-supply` | Mint beyond max supply | Transaction fails |
| `hero:mint:level-requirement` | Mint without level req | Transaction fails |
| `hero:lock` | Lock hero for activity | NFT transferred to escrow |
| `hero:unlock` | Unlock hero | NFT returned to owner |
| `hero:level-up` | Level up hero | XP consumed, stats increased |
| `hero:assign-defensive` | Assign to defense | Defense bonus applied |

**Flows:**
```
1. Mint Hero → Level Up → Assign Defensive → Verify Defense Bonus
2. Mint → Lock for Expedition → Complete Expedition → Unlock
```

---

### 10. Shop (`10-shop.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `shop:init-config` | Initialize shop config | Config PDA created |
| `shop:create-item` | Create shop item | Item PDA created |
| `shop:update-item` | Update item price | Item updated |
| `shop:purchase-item` | Purchase item | Payment processed, item delivered |
| `shop:purchase:sold-out` | Purchase sold out item | Transaction fails |
| `shop:create-bundle` | Create item bundle | Bundle PDA created |
| `shop:purchase-bundle` | Purchase bundle | All items delivered |
| `shop:flash-sale:create` | Create flash sale | Sale with timer |
| `shop:flash-sale:purchase` | Purchase flash sale | Discounted price |
| `shop:flash-sale:expired` | Purchase expired sale | Transaction fails |
| `shop:daily-deal` | Purchase daily deal | Special pricing |
| `shop:novi:purchase` | Purchase NOVI with SOL | NOVI minted, SOL transferred |
| `shop:novi:streak` | Consecutive day bonus | Increasing bonus |
| `shop:novi:daily-cap` | Exceed daily cap | Transaction fails |
| `shop:allowed-token:create` | Add allowed payment token | Token registered |
| `shop:purchase:alt-token` | Purchase with USDC | Token converted via oracle |

**Flows:**
```
1. Create Item → Purchase → Verify Inventory
2. Create Flash Sale → Purchase Before Expiry → Verify Discount
3. Day 1 Buy NOVI → Day 2 Buy → Day 3 Buy → Verify Streak Bonus
```

---

### 11. Estate (`11-estate.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `estate:create` | Create player estate | Estate PDA, initial plots |
| `estate:buy-plot` | Purchase additional plot | Plot count increased |
| `estate:build` | Start building | Timer set, slot occupied |
| `estate:complete` | Complete building | Building active |
| `estate:upgrade` | Upgrade building | Higher level, better stats |
| `estate:daily-claim` | Claim daily rewards | Resources added |
| `estate:daily-activity` | Complete daily activity | Activity bonus |
| `estate:convert-materials` | Convert materials | Resource transformation |

**Flows:**
```
1. Create Estate → Build Farm → Complete → Collect Resources
2. Build → Upgrade to Level 5 → Verify Production Increase
```

---

### 12. Forge (`12-forge.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `forge:initialize` | Initialize forge | Forge PDA created |
| `forge:start-craft` | Start crafting item | Materials consumed, timer set |
| `forge:strike` | Strike to progress | Quality chance increased |
| `forge:equip` | Equip crafted item | Stats applied |
| `forge:abandon` | Abandon craft | Partial material refund |

**Flows:**
```
1. Start Craft → Strike 3x → Complete → Equip → Verify Stats
2. Start Craft → Abandon → Verify Refund
```

---

### 13. Expedition (`13-expedition.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `expedition:start` | Start expedition | Hero locked, timer set |
| `expedition:start:hero-locked` | Start with locked hero | Transaction fails |
| `expedition:strike` | Strike during expedition | Bonus loot chance |
| `expedition:claim` | Claim rewards | Loot distributed, hero unlocked |
| `expedition:abort` | Abort early | Hero unlocked, no rewards |
| `expedition:speedup` | Speed up expedition | Timer reduced |

**Flows:**
```
1. Mint Hero → Start Expedition → Strike 2x → Claim → Verify Loot
2. Start → Abort → Verify Hero Unlocked
```

---

### 14. Arena (`14-arena.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `arena:create-season` | Create new season | Season PDA, prize pool |
| `arena:join` | Join season | Participant PDA, entry fee paid |
| `arena:update-loadout` | Update hero loadout | Loadout saved |
| `arena:challenge` | Challenge opponent | Match resolved, rankings updated |
| `arena:challenge:cooldown` | Challenge during cooldown | Transaction fails |
| `arena:daily-reward` | Claim daily participation | Reward based on rank |
| `arena:master-reward` | Claim master tier reward | Elite rewards |
| `arena:close-season` | Close and distribute | Final rankings, prizes paid |

**Flows:**
```
1. Create Season → 5 Players Join → Multiple Challenges → Close → Verify Rankings
2. Join → Win 10 Matches → Reach Master → Claim Special Reward
```

---

### 15. Dungeon (`15-dungeon.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `dungeon:create-template` | Create dungeon template | Template configured |
| `dungeon:create-leaderboard` | Create leaderboard | Leaderboard PDA |
| `dungeon:enter` | Enter dungeon | Run PDA, hero locked |
| `dungeon:attack` | Attack enemy | Damage dealt, enemy HP reduced |
| `dungeon:attack-multi` | Multi-target attack | AOE damage |
| `dungeon:interact` | Interact with object | Event triggered |
| `dungeon:choose-relic` | Choose relic reward | Buff applied |
| `dungeon:flee` | Flee from combat | Exit with partial rewards |
| `dungeon:resume` | Resume saved run | State restored |
| `dungeon:claim` | Complete and claim | Full rewards, leaderboard updated |
| `dungeon:leaderboard-prize` | Claim leaderboard prize | Top player rewards |

**Flows:**
```
1. Enter → Clear 5 Floors → Choose Relics → Claim → Verify Score
2. Enter → Die on Floor 3 → Verify Partial Rewards
3. Full Season → Multiple Runs → End Season → Claim Leaderboard
```

---

### 16. Castle (`16-castle.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `castle:create` | Create castle (admin) | Castle PDA |
| `castle:claim-vacant` | Claim empty castle | Become king |
| `castle:attack` | Attack castle | Siege mechanics |
| `castle:initiate-upgrade` | Start upgrade | Timer, resources locked |
| `castle:complete-upgrade` | Complete upgrade | Tier increased |
| `castle:cancel-upgrade` | Cancel upgrade | Partial refund |
| `castle:join-garrison` | Join garrison | Defensive contribution |
| `castle:leave-garrison` | Leave garrison | Troops withdrawn |
| `castle:relieve-garrison` | King relieves garrison | Remove defender |
| `castle:appoint-court` | Appoint court member | Position filled |
| `castle:dismiss-court` | Dismiss court member | Position vacated |
| `castle:resign-court` | Resign from court | Self-removal |
| `castle:claim-rewards` | King claims rewards | Treasury distribution |
| `castle:claim-garrison-loot` | Garrison claims loot | Defender rewards |
| `castle:finalize-transition` | Complete takeover | New king installed |
| `castle:force-remove-king` | Remove inactive king | Admin function |

**Flows:**
```
1. Create Castle → Player Claims → Builds Garrison → Defends Attack
2. Attack Castle → Win → Finalize Transition → Become New King
3. King → Appoint Court → Distribute Rewards → Dismiss Court
```

---

### 17. Sanctuary (`17-sanctuary.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `sanctuary:start-meditation` | Start hero meditation | Hero locked, timer set |
| `sanctuary:claim-meditation` | Claim meditation rewards | Buffs applied, hero unlocked |
| `sanctuary:claim:early` | Claim before complete | Transaction fails |

**Flows:**
```
1. Lock Hero → Meditate 24h → Claim → Verify Permanent Buffs
```

---

### 18. Subscription (`18-subscription.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `subscription:purchase` | Purchase subscription | Tier set, duration started |
| `subscription:purchase:upgrade` | Upgrade tier | Higher benefits |
| `subscription:benefits` | Verify tier benefits | Correct multipliers |
| `subscription:downgrade-expired` | Auto-downgrade on expiry | Tier reduced |

**Flows:**
```
1. Purchase Bronze → Verify Benefits → Upgrade to Gold → Verify New Benefits
2. Purchase → Wait Expiry → Verify Auto-Downgrade
```

---

### 19. Events (`19-event.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `event:create` | Create game event | Event PDA, parameters set |
| `event:join` | Join event | Participant registered |
| `event:scoring` | Score accumulation | Points tracked |
| `event:finalize` | Finalize event | Rankings calculated |
| `event:claim-prize` | Claim event prize | Rewards distributed |

**Flows:**
```
1. Create Event → 10 Players Join → Accumulate Scores → Finalize → Top 3 Claim
```

---

### 20. Name Service (`20-name.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `name:set-player` | Set player name | Domain linked |
| `name:update-player` | Update player name | New domain linked |
| `name:remove-player` | Remove player name | Domain unlinked |
| `name:set-team` | Set team name | Team domain |
| `name:update-team` | Update team name | New team domain |
| `name:remove-team` | Remove team name | Domain unlinked |
| `name:duplicate` | Use taken name | Transaction fails |

**Flows:**
```
1. Register Domain → Set Player Name → Verify Lookup
2. Set Name → Update to New Name → Verify Change
```

---

### 21. Token Operations (`21-token.test.ts`)

| Test | Description | Assertions |
|------|-------------|------------|
| `token:reserved-to-locked` | Convert reserved NOVI | Locked balance increased |
| `token:withdraw-reserved` | Withdraw reserved NOVI | Tokens transferred |
| `token:withdraw:insufficient` | Withdraw more than reserved | Transaction fails |

---

## Integration Test: Full Game Flow

```typescript
// tests/integration/full-game-flow.test.ts

describe('Full Game Simulation', () => {
  it('simulates 7-day gameplay', async () => {
    // Day 1: Onboarding
    // - Initialize 5 players
    // - Each mints 1 hero
    // - Each creates estate
    // - 3 players form a team

    // Day 2: Economy
    // - All players collect resources
    // - Purchase equipment
    // - Start research

    // Day 3: Combat
    // - PvP attacks between non-team members
    // - Spawn and defeat encounters
    // - Complete research

    // Day 4: Team Activities
    // - Create rally against strongest player
    // - Execute rally
    // - Send reinforcements

    // Day 5: Advanced Features
    // - Start expeditions
    // - Enter dungeon
    // - Join arena season

    // Day 6: Castle Warfare
    // - Claim castle
    // - Build garrison
    // - Attack rival castle

    // Day 7: Rewards
    // - Claim all pending rewards
    // - Finalize event
    // - Close arena season
    // - Verify final standings
  });
});
```

---

## Test Utilities Needed

### 1. Clock Manipulation
```typescript
// Advance blockchain time for testing time-based mechanics
async function advanceTime(connection: Connection, seconds: number): Promise<void>;
async function advanceToSlot(connection: Connection, slot: number): Promise<void>;
```

### 2. State Assertions
```typescript
// Custom assertions for game state
function assertPlayerResources(player: PlayerAccount, expected: Resources): void;
function assertCombatResult(event: CombatEvent, winner: 'attacker' | 'defender'): void;
function assertTeamMemberCount(team: TeamAccount, count: number): void;
```

### 3. Event Parsing
```typescript
// Parse events from transaction logs
function parseEventsFromTx(connection: Connection, sig: string): GameEvent[];
function findEvent<T>(events: GameEvent[], type: string): T | undefined;
```

### 4. Account Snapshots
```typescript
// Snapshot and diff account state
function snapshotPlayer(connection: Connection, player: PublicKey): Promise<PlayerSnapshot>;
function diffSnapshots(before: PlayerSnapshot, after: PlayerSnapshot): PlayerDiff;
```

---

## CI/CD Integration

### GitHub Actions Workflow
```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Build program
        run: cargo build-sbf

      - name: Start validator
        run: |
          solana-test-validator &
          sleep 5

      - name: Deploy program
        run: solana program deploy target/deploy/novus_mundus.so

      - name: Run setup
        run: bun run setup:local

      - name: Run E2E tests
        run: bun test tests/e2e/

      - name: Run integration tests
        run: bun test tests/integration/
```

---

## Test Coverage Goals

| Domain | Unit Tests | E2E Tests | Target Coverage |
|--------|-----------|-----------|-----------------|
| Player | 15 | 6 | 95% |
| Economy | 20 | 8 | 90% |
| Combat | 25 | 9 | 95% |
| Team | 30 | 21 | 90% |
| Travel | 15 | 9 | 90% |
| Rally | 20 | 8 | 85% |
| Reinforcement | 15 | 7 | 85% |
| Research | 15 | 8 | 90% |
| Hero | 15 | 7 | 90% |
| Shop | 25 | 15 | 90% |
| Estate | 15 | 8 | 85% |
| Forge | 12 | 5 | 85% |
| Expedition | 12 | 6 | 85% |
| Arena | 18 | 8 | 85% |
| Dungeon | 25 | 11 | 85% |
| Castle | 30 | 17 | 80% |
| Sanctuary | 6 | 3 | 90% |
| Subscription | 10 | 4 | 90% |
| Events | 12 | 5 | 85% |
| Name Service | 12 | 7 | 90% |
| **TOTAL** | **348** | **172** | **~88%** |

---

## Priority Order for Implementation

### Phase 1: Core (Week 1)
1. Player lifecycle
2. Economy basics
3. Combat (PvP + PvE)

### Phase 2: Social (Week 2)
4. Team/Guild
5. Rally
6. Reinforcement

### Phase 3: Progression (Week 3)
7. Research
8. Hero NFTs
9. Estate
10. Forge

### Phase 4: Activities (Week 4)
11. Travel
12. Expedition
13. Sanctuary

### Phase 5: Competitive (Week 5)
14. Arena
15. Dungeon
16. Events

### Phase 6: Advanced (Week 6)
17. Castle system
18. Shop (full)
19. Subscription
20. Name service
21. Integration tests
