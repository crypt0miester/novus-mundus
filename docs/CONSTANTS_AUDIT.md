# Constants.rs Audit

**File:** `programs/novus_mundus/src/constants.rs`

**Summary:** Out of ~250 constants, roughly 46% are dead code (never referenced outside the file). The remaining split into structural constants that must stay compile-time (PDA seeds, math, enums) and tunable gameplay values that should move to GameEngine for on-chain configurability.

| Category | Count | Action |
|----------|-------|--------|
| Dead code | ~115 | Remove |
| Compile-time structural | ~60 | Keep in constants.rs |
| Tunable gameplay values | ~75 | Migrate to GameEngine |

---

## Section 1: DEAD CODE -- Safe to Remove (~115 constants)

These are never referenced outside `constants.rs`. Many were "designed but never implemented" or replaced by proper Rust enums. Removing them requires no code changes since nothing references them.

### Time Constants (4 dead)

| Constant | Line | Notes |
|----------|------|-------|
| CLAIM_COOLDOWN | 8 | Never referenced |
| LOCATION_CLAIM_DURATION | 10 | Never referenced |
| INACTIVE_ACCOUNT_THRESHOLD | 11 | Never referenced |
| ATTACK_IMMUNITY_DURATION | 12 | Never referenced |

### Account Size Limits (3 dead)

| Constant | Line | Notes |
|----------|------|-------|
| MAX_TEAM_NAME_LENGTH | 18 | Never referenced |
| MAX_LOCATION_NAME_LENGTH | 19 | Never referenced |
| MAX_EVENT_DESCRIPTION_LENGTH | 21 | Never referenced |

### Vector Capacity Limits (9 dead, 100%)

| Constant | Line |
|----------|------|
| MAX_TEAM_MEMBERS | 26 |
| MAX_TEAM_INVITES | 27 |
| MAX_PLAYERS_AT_LOCATION | 28 |
| MAX_ENCOUNTERS_AT_LOCATION | 29 |
| MAX_RALLY_PARTICIPANTS | 30 |
| MAX_ENCOUNTER_ATTACKERS | 31 |
| MAX_ACHIEVEMENTS_TRACKED | 32 |
| MAX_EVENT_WINNERS | 33 |
| MAX_ALLOWED_TEAMS_FOR_ENCOUNTER | 34 |

### Rally System (1 dead)

| Constant | Line | Notes |
|----------|------|-------|
| DEFAULT_MAX_RALLY_PARTICIPANTS | 40 | Never referenced |

### Subscription Tier Indices (3 dead)

| Constant | Line | Notes |
|----------|------|-------|
| TIER_EXPERT | 53 | Never referenced outside constants.rs |
| TIER_EPIC | 54 | Never referenced outside constants.rs |
| TIER_LEGENDARY | 55 | Never referenced outside constants.rs |

### Economic Constants (4 dead, 100%)

| Constant | Line |
|----------|------|
| DECIMAL_MULTIPLIER | 70 |
| MIN_BURN_AMOUNT | 71 |
| DEFAULT_BURN_TO_MINT_RATIO_NUMERATOR | 72 |
| DEFAULT_BURN_TO_MINT_RATIO_DENOMINATOR | 73 |

### Golden Ratio (2 dead)

| Constant | Line | Notes |
|----------|------|-------|
| PHI_CUBED | 97 | Never referenced outside constants.rs |
| GOLDEN_ANGLE | 113 | Never referenced |

### Combat Constants (10 dead, 100%)

| Constant | Line |
|----------|------|
| ATTACK_SUCCESS_THRESHOLD | 118 |
| MAX_STEAL_PERCENTAGE | 119 |
| UNIT_LOSS_PERCENTAGE_WINNER | 120 |
| UNIT_LOSS_PERCENTAGE_LOSER | 121 |
| OPERATIVE_FALLBACK_PENALTY_BPS | 129 |
| FALLBACK_LOOT_BONUS_BPS | 134 |
| CRIT_HIT_THRESHOLD_BPS | 138 |
| MAX_REINFORCEMENT_SLOTS | 141 |
| BASE_REINFORCEMENT_SLOTS | 143 |
| BASE_REINFORCEMENT_SEND_BPS | 144 |

### Rally/Reinforcement Status Enums (10 dead, 100%)

Replaced by proper Rust enums.

| Constant | Line |
|----------|------|
| RALLY_STATUS_GATHERING | 147 |
| RALLY_STATUS_MARCHING | 148 |
| RALLY_STATUS_BATTLING | 149 |
| RALLY_STATUS_RETURNING | 150 |
| RALLY_STATUS_COMPLETED | 151 |
| RALLY_STATUS_CANCELLED | 152 |
| REINFORCEMENT_STATUS_TRAVELING | 155 |
| REINFORCEMENT_STATUS_STATIONED | 156 |
| REINFORCEMENT_STATUS_RETURNING | 157 |
| REINFORCEMENT_STATUS_COMPLETED | 158 |

### Weapon Combat (1 dead)

| Constant | Line | Notes |
|----------|------|-------|
| WEAPON_RECOVERY_RATE_BPS | 171 | Never referenced outside constants.rs |

### Progression Constants (8 dead, 100%)

| Constant | Line |
|----------|------|
| MAX_LEVEL | 192 |
| BASE_XP_PER_LEVEL | 193 |
| XP_EXPONENT | 194 |
| REPUTATION_NOVICE | 197 |
| REPUTATION_APPRENTICE | 198 |
| REPUTATION_JOURNEYMAN | 199 |
| REPUTATION_MASTER | 200 |
| REPUTATION_LEGENDARY | 201 |

### Location Constants (7 dead, 100%)

| Constant | Line | Notes |
|----------|------|-------|
| MIN_LATITUDE | 206 | |
| MAX_LATITUDE | 207 | |
| MIN_LONGITUDE | 208 | |
| MAX_LONGITUDE | 209 | |
| EARTH_RADIUS_KM | 210 | Shadowed by local copy in logic/location.rs |
| TELEPORT_COST_PER_1000KM | 213 | |
| MAX_TELEPORT_DISTANCE_KM | 214 | |

### Encounter Max Attackers (6 dead, 100%)

| Constant | Line |
|----------|------|
| ENCOUNTER_COMMON_MAX_ATTACKERS | 219 |
| ENCOUNTER_UNCOMMON_MAX_ATTACKERS | 220 |
| ENCOUNTER_RARE_MAX_ATTACKERS | 221 |
| ENCOUNTER_EPIC_MAX_ATTACKERS | 222 |
| ENCOUNTER_LEGENDARY_MAX_ATTACKERS | 223 |
| ENCOUNTER_WORLD_EVENT_MAX_ATTACKERS | 224 |

### Resource Collection / Happiness / Transfer (8 dead, 100%)

| Constant | Line |
|----------|------|
| COLLECTION_COOLDOWN | 229 |
| BASE_COLLECTION_AMOUNT | 230 |
| MAX_HAPPINESS | 235 |
| MIN_HAPPINESS | 236 |
| HAPPINESS_DECAY_PER_DAY | 237 |
| MIN_HAPPINESS_TO_COLLECT | 238 |
| MAX_TRANSFER_RATIO | 243 |
| TRANSFER_RATIO_PRECISION | 244 |

### Theme Modifiers (5 dead, 100%)

| Constant | Line |
|----------|------|
| THEME_NONE_BONUS | 249 |
| THEME_ATTACK_BONUS | 250 |
| THEME_DEFENSE_BONUS | 251 |
| THEME_ECONOMY_BONUS | 252 |
| THEME_HAPPINESS_BONUS | 253 |

### Unit Count Constants (3 dead)

| Constant | Line |
|----------|------|
| NUM_DEFENSIVE_UNITS | 258 |
| NUM_OPERATIVE_UNITS | 259 |
| TOTAL_UNIT_TYPES | 260 |

### Combat Power (5 dead)

| Constant | Line | Notes |
|----------|------|-------|
| OPERATIVE_UNIT_1_POWER | 351 | Only DEFENSIVE_UNIT_*_POWER used in arena |
| OPERATIVE_UNIT_2_POWER | 352 | Only DEFENSIVE_UNIT_*_POWER used in arena |
| OPERATIVE_UNIT_3_POWER | 353 | Only DEFENSIVE_UNIT_*_POWER used in arena |
| WEAPON_POWER_MULTIPLIER | 354 | |
| VEHICLE_POWER_MULTIPLIER | 355 | |

### Resource Pricing (3 dead, 100%)

| Constant | Line |
|----------|------|
| WEAPON_PRICE | 340 |
| PRODUCE_PRICE | 341 |
| VEHICLE_PRICE | 342 |

### Validation Constants (2 dead)

| Constant | Line |
|----------|------|
| MIN_TEAM_NAME_LENGTH | 333 |
| MIN_LOCATION_NAME_LENGTH | 334 |

### Expedition (4 dead)

| Constant | Line | Notes |
|----------|------|-------|
| EXPEDITION_NONE | 500 | |
| MINING_GEMS_PER_OP_HOUR | 511 | |
| FISHING_PRODUCE_PER_OP_HOUR | 525 | |
| STRIKES_PER_HOUR | 540 | |

### Arena (1 dead)

| Constant | Line | Notes |
|----------|------|-------|
| ARENA_LOADOUT_VALIDATION_EXPIRY | 584 | Self-referential only |

### Dungeon (4 dead)

| Constant | Line | Notes |
|----------|------|-------|
| DUNGEON_DEFAULT_CHECKPOINT_INTERVAL | 643 | |
| DUNGEON_FAIL_PRE_CHECKPOINT_BPS | 651 | |
| DUNGEON_FAIL_POST_CHECKPOINT_BPS | 652 | |
| DUNGEON_REWARD_SCALING_BPS | 787 | DUNGEON_FLOOR_MULTIPLIERS used instead |

### Relic (2 dead)

| Constant | Line | Notes |
|----------|------|-------|
| SYNERGY_NONE | 683 | Never referenced outside constants.rs |
| SYNERGY_META | 682 | Only self-referenced in RELIC_SYNERGY_TAGS array |

### Castle (18+ dead)

Code uses `CastleTier` enum and direct values instead.

| Constant | Line | Notes |
|----------|------|-------|
| CASTLE_TIER_OUTPOST | 830 | CastleTier enum used instead |
| CASTLE_TIER_KEEP | 831 | CastleTier enum used instead |
| CASTLE_TIER_FORTRESS | 832 | CastleTier enum used instead |
| CASTLE_TIER_STRONGHOLD | 833 | CastleTier enum used instead |
| CASTLE_TIER_CITADEL | 834 | CastleTier enum used instead |
| MAX_GARRISON_SIZE | 848 | |
| MAX_COURT_SIZE | 849 | |
| FORTIFICATION_BONUS_PER_LEVEL | 864 | |
| TREASURY_BONUS_PER_LEVEL | 865 | |
| ARMORY_BONUS_PER_LEVEL | 866 | |
| RALLY_TARGET_CASTLE | 872 | |
| COURT_POSITION_ADVISOR | 875 | |
| COURT_POSITION_STEWARD | 876 | |
| COURT_POSITION_CAPTAIN | 877 | |
| COURT_POSITION_HERALD | 878 | |
| COURT_POSITION_MARSHAL | 879 | |
| ADVISOR_ATTACK_BPS | 882 | |
| STEWARD_ECONOMY_BPS | 883 | |
| CAPTAIN_DEFENSE_BPS | 884 | |
| HERALD_MORALE_BPS | 885 | |
| MARSHAL_RALLY_CAPACITY_BPS | 886 | |
| CASTLE_UPGRADE_NONE | 889 | |

### Other (3 dead)

| Constant | Line | Notes |
|----------|------|-------|
| TOTAL_INITIAL_CITIES | 493 | |
| CityType re-export | 418 | Everyone imports from state:: instead |
| CRAFTED_EQUIPMENT_SEED | 307 | Dead PDA seed, never used |

---

## Section 2: KEEP as Compile-Time Constants (~60 constants)

These must remain hardcoded. They are structural, not tunable.

### PDA Seeds (46 used, 1 dead)

All `*_SEED` constants are used in their respective state accounts and processor instructions. These define on-chain account derivation and **cannot change without breaking all existing accounts**.

**Used seeds:**

| Seed | Status |
|------|--------|
| GAME_ENGINE_SEED | Used |
| NOVI_MINT_SEED | Used |
| PLAYER_SEED | Used |
| USER_SEED | Used |
| CITY_SEED | Used |
| TEAM_SEED | Used |
| TEAM_SLOT_SEED | Used |
| TEAM_INVITE_SEED | Used |
| TREASURY_REQUEST_SEED | Used |
| LOCATION_SEED | Used |
| RALLY_SEED | Used |
| ENCOUNTER_SEED | Used |
| EVENT_SEED | Used |
| EVENT_PARTICIPATION_SEED | Used |
| PROGRESSION_SEED | Used |
| LOOT_SEED | Used |
| RESEARCH_SEED | Used |
| RESEARCH_TEMPLATE_SEED | Used |
| HERO_TEMPLATE_SEED | Used |
| HERO_COLLECTION_SEED | Used |
| HERO_MINT_RECEIPT_SEED | Used |
| RALLY_PARTICIPANT_SEED | Used |
| REINFORCEMENT_SEED | Used |
| GARRISON_SEED | Used |
| SHOP_CONFIG_SEED | Used |
| SHOP_ITEM_SEED | Used |
| BUNDLE_SEED | Used |
| DAILY_DEAL_SEED | Used |
| FLASH_SALE_SEED | Used |
| WEEKLY_SALE_SEED | Used |
| SEASONAL_SALE_SEED | Used |
| DAO_PROMOTION_SEED | Used |
| PLAYER_PURCHASE_SEED | Used |
| INVENTORY_SEED | Used |
| ALLOWED_TOKEN_SEED | Used |
| ESTATE_SEED | Used |
| EXPEDITION_SEED | Used |
| ARENA_SEASON_SEED | Used |
| ARENA_PARTICIPANT_SEED | Used |
| ARENA_LOADOUT_SEED | Used |
| DUNGEON_TEMPLATE_SEED | Used |
| DUNGEON_RUN_SEED | Used |
| DUNGEON_LEADERBOARD_SEED | Used |
| CASTLE_SEED | Used |
| COURT_SEED | Used |
| KING_REGISTRY_SEED | Used |
| TEAM_CASTLE_REWARD_SEED | Used |

**Dead seed:**

| Seed | Status |
|------|--------|
| CRAFTED_EQUIPMENT_SEED | Dead -- listed in Section 1 |

### Golden Ratio Mathematical Constants (6 used)

These are irrational numbers used in deterministic game math. Not tunable.

| Constant | Value | Used in |
|----------|-------|---------|
| PHI | 1.618... | time_cycle.rs, golden_math.rs |
| GOLDEN_ROOT | 1.272... | time_cycle.rs, golden_math.rs, rewards.rs |
| PHI_SQUARED | 2.618... | time_cycle.rs, golden_math.rs |
| PHI_INVERSE | 0.618... | time_cycle.rs |
| PHI_SQUARED_INVERSE | 0.382... | time_cycle.rs |
| PHI_CUBED_INVERSE | 0.236... | time_cycle.rs |

### Relic Data Tables (4 used)

Complex cross-referenced arrays used in the dungeon system. Content-heavy, not simple tuning values.

| Constant | Used in |
|----------|---------|
| RELIC_SYNERGY_TAGS | state/dungeon.rs |
| RELIC_EFFECTS | helpers/dungeon.rs |
| SYNERGY_2_BONUS_BPS | helpers/dungeon.rs |
| SYNERGY_3_BONUS_BPS | helpers/dungeon.rs |

### Dungeon Precomputed Tables (3 used)

Derived from math formulas, precomputed for on-chain efficiency.

| Constant | Used in |
|----------|---------|
| DUNGEON_FLOOR_MULTIPLIERS | helpers/dungeon.rs |
| DUNGEON_UNIT_POWER | helpers/dungeon.rs |
| DUNGEON_UNIT_HEALTH | helpers/dungeon.rs |

### Prize Distributions (2 used)

Fixed arrays that must sum to 10000 bps. Could theoretically move to GameEngine but complex to validate on-chain.

| Constant | Used in |
|----------|---------|
| PRIZE_DISTRIBUTION | event/claim_prize.rs, dungeon/claim_leaderboard_prize.rs |
| ARENA_PRIZE_DISTRIBUTION | arena/claim_master_reward.rs |

### City Data (1 used)

| Constant | Used in | Notes |
|----------|---------|-------|
| INITIAL_CITIES | batch_cities.rs | Initialization only |

### Status/Type Enum Values (used)

Protocol-level state machine values. Changing these would break existing on-chain accounts.

| Group | Constants | Count | Used in |
|-------|-----------|-------|---------|
| Castle Status | CASTLE_STATUS_VACANT through CASTLE_STATUS_TRANSITIONING | 5 | castle processors |
| Castle Upgrade | CASTLE_UPGRADE_FORTIFICATION through CASTLE_UPGRADE_ARMORY | 5 | initiate_upgrade.rs, complete_upgrade.rs |
| Expedition Type | EXPEDITION_MINING, EXPEDITION_FISHING | 2 | expedition processors |
| Synergy Type | SYNERGY_OFFENSE through SYNERGY_HERO | 8 | helpers/dungeon.rs |

### Other Structural Constants

| Constant | Used in | Notes |
|----------|---------|-------|
| DISCRIMINATOR_SIZE | Various | Account size calculations |
| SECONDS_PER_DAY | Various | Time reference (also shadowed in some files) |
| SECONDS_PER_HOUR | Various | Time reference (also shadowed/imported in expedition, estate) |
| TIER_ROOKIE | team/create.rs | Index value |
| MAX_EVENT_NAME_LENGTH | event/create.rs | Validation |
| MIN_EVENT_NAME_LENGTH | event/create.rs | Validation |

---

## Section 3: SHOULD MOVE TO GameEngine (~75 constants)

These are currently used in the code but represent tunable gameplay values. If they already exist as fields in GameEngine, the code should read from GameEngine instead. If they do not exist in GameEngine yet, they need new fields added.

### Stamina System

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| ENCOUNTER_STAMINA_COSTS | [10, 25, 50, 100, 250, 500] | logic/stamina.rs:101 | gameplay_config |
| STAMINA_REGEN_INTERVAL | 300 (5 min) | logic/stamina.rs:47,52 | gameplay_config |
| MAX_STAMINA_BY_TIER | [100, 500, 1000, 10000] | logic/stamina.rs:161-162 | subscription_tiers or gameplay_config |

### Combat Ranges

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| ENCOUNTER_ATTACK_RANGE_METERS | 10.0 | combat/attack_encounter.rs:181 | gameplay_config |
| PVP_ATTACK_RANGE_METERS | 15.0 | combat/attack_player.rs:210 | gameplay_config |
| CASTLE_ATTACK_RANGE_METERS | 50.0 | attack_castle.rs:123 | gameplay_config |

### Weapon Combat

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| WEAPON_LOOT_RATE_BPS | 6000 (60%) | logic/combat.rs:158 | economic_config |
| ARMORY_RAID_WITH_OPERATIVES_BPS | 2500 (25%) | logic/combat.rs:162 | economic_config |
| ARMORY_RAID_UNDEFENDED_BPS | 5000 (50%) | logic/combat.rs:164 | economic_config |
| DAMAGE_PER_SIEGE_WEAPON | 500 | logic/combat.rs:131, combat/attack_encounter.rs:293 | economic_config |
| SIEGE_CAPTURE_RATE_BPS | 8000 (80%) | logic/combat.rs:171 | economic_config |

### Unit Power (Arena)

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| DEFENSIVE_UNIT_1_POWER | 10 | arena/challenge_player.rs:357 | economic_config |
| DEFENSIVE_UNIT_2_POWER | 25 | arena/challenge_player.rs:358 | economic_config |
| DEFENSIVE_UNIT_3_POWER | 60 | arena/challenge_player.rs:359 | economic_config |

### Arena System

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| ARENA_SEASON_DURATION | 604800 (7 days) | arena/create_season.rs:141 | arena_config (new) |
| ARENA_CLAIM_DEADLINE | 2592000 (30 days) | arena/create_season.rs:142 | arena_config |
| ARENA_MAX_DAILY_BATTLES | 10 | arena/challenge_player.rs:212 | arena_config |
| ARENA_MAX_BATTLES_PER_OPPONENT | 2 | arena/challenge_player.rs:222 | arena_config |
| ARENA_MIN_BATTLES_FOR_DAILY_REWARD | 5 | arena/claim_daily_reward.rs:126 | arena_config |
| ARENA_MATCH_EXPIRY_SECONDS | 300 | arena/challenge_player.rs:194 | arena_config |
| ARENA_STARTING_ELO | 1000 | arena/join_season.rs:161 | arena_config |
| ARENA_ELO_K_FACTOR | 32 | arena/challenge_player.rs:525-526 | arena_config |
| ARENA_DAILY_BASE_REWARD | 1000 (100 NOVI) | arena/claim_daily_reward.rs:200 | arena_config |
| ARENA_MIN_POINTS_FOR_LEADERBOARD | 500 | arena/create_season.rs:177 | arena_config |
| ARENA_MELEE_WEAPON_POWER | 10 | arena/challenge_player.rs:363 | arena_config |
| ARENA_RANGED_WEAPON_POWER | 16 | arena/challenge_player.rs:364 | arena_config |
| ARENA_SIEGE_WEAPON_POWER | 26 | arena/challenge_player.rs:365 | arena_config |
| ARENA_ARMOR_POWER | 5 | arena/challenge_player.rs:366 | arena_config |
| ARENA_BASE_WIN_POINTS | 100 | arena/challenge_player.rs:463,465 | arena_config |
| ARENA_BASE_LOSS_POINTS | 20 | arena/challenge_player.rs:463,465 | arena_config |
| ARENA_DRAW_POINTS | 50 | arena/challenge_player.rs:459 | arena_config |
| ARENA_UNDERDOG_BONUS_BPS | 500 (5%) | arena/challenge_player.rs:477 | arena_config |

### Expedition System

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| EXPEDITION_MAX_TIER | 4 | expedition/start.rs:133 | expedition_config (new) |
| MINING_DURATION_HOURS | [1,2,4,8,16] | expedition state + processors | expedition_config |
| MINING_RARE_CHANCE_BPS | [100,300,500,1000,2000] | expedition/claim.rs:329 | expedition_config |
| MINING_WORKSHOP_REQ | [1,5,10,15,20] | expedition/start.rs:166 | expedition_config |
| MINING_NOVI_COST | [100,500,2000,8000,30000] | expedition/start.rs:169 | expedition_config |
| MINING_FRAGMENT_BONUS | [1,3,8,20,50] | expedition/claim.rs:354 | expedition_config |
| FISHING_DURATION_HOURS | [1,2,4,8,16] | expedition state + processors | expedition_config |
| FISHING_RARE_CHANCE_BPS | [100,300,500,1000,2000] | expedition/claim.rs:331 | expedition_config |
| FISHING_DOCK_REQ | [1,5,10,15,20] | expedition/start.rs:177 | expedition_config |
| FISHING_NOVI_COST | [100,500,2000,8000,30000] | expedition/start.rs:180 | expedition_config |
| FISHING_FRAGMENT_BONUS | [1,2,5,12,30] | expedition/claim.rs:365 | expedition_config |
| RARE_FIND_MULTIPLIER | 5 | expedition/claim.rs:342 | expedition_config |
| PERFECT_SCORE_THRESHOLD | 80 | expedition/claim.rs:256 | expedition_config |
| PERFECT_EXPEDITION_BONUS_BPS | 2500 (25%) | expedition/claim.rs:258,262 | expedition_config |
| OPERATIVE_TIER_1_MULTIPLIER_BPS | 10000 (1.0x) | expedition/claim.rs:160 | expedition_config |
| OPERATIVE_TIER_2_MULTIPLIER_BPS | 15000 (1.5x) | expedition/claim.rs:161 | expedition_config |
| OPERATIVE_TIER_3_MULTIPLIER_BPS | 20000 (2.0x) | expedition/claim.rs:162 | expedition_config |

### Dungeon System

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| DUNGEON_MAX_MULTI_ATTACKS | 5 | dungeon/attack_multi.rs:39 | dungeon_config (new) |
| DUNGEON_FLEE_PENALTY_BPS | [7000,6000,5000,4000] | helpers/dungeon.rs:596 | dungeon_config |
| DUNGEON_REST_HEAL_PERCENT | 20 | dungeon/interact.rs:214 | dungeon_config |
| DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS | 20000 (2x) | dungeon/interact.rs:170 | dungeon_config |
| DUNGEON_TRAP_XP_BONUS_BPS | 15000 (1.5x) | dungeon/interact.rs:224 | dungeon_config |
| DUNGEON_TRAP_DAMAGE_PERCENT | 10 | dungeon/interact.rs:219 | dungeon_config |
| DUNGEON_RESUME_GEM_COST | 500 | dungeon/resume.rs:95 | dungeon_config |
| All 7 DARKNESS_* constants | various | helpers/dungeon.rs:313-371 | dungeon_config |

### Castle System

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| CASTLE_CONTEST_DURATION | 0 (test) / 7200 (prod) | claim_vacant_castle.rs, rally/execute.rs | castle_config (new) |
| CASTLE_PROTECTION_DURATION | 864000 (10 days) | create_castle.rs:212 | castle_config |
| MAX_CASTLES_PER_KING | 5 | claim_vacant_castle.rs:168 | castle_config |
| GARRISON_CAP_BY_TIER | [5,10,15,25] | claim_vacant_castle.rs:198 | castle_config |
| CASTLE_TIER_MULTIPLIER_BPS | [2500,5000,10000,15000,20000] | create_castle.rs:215 | castle_config |
| KING_LOOT_CUT_BPS | 1500 (15%) | create_castle.rs:216 | castle_config |
| MAX_FORTIFICATION_LEVEL | various | initiate_upgrade.rs:119-123 | castle_config |
| MAX_TREASURY_LEVEL | various | initiate_upgrade.rs:119-123 | castle_config |
| MAX_ARMORY_LEVEL | various | initiate_upgrade.rs:119-123 | castle_config |
| KING_NOVI_PER_DAY | various | create_castle.rs:217-222 | castle_config |
| KING_CASH_PER_DAY | various | create_castle.rs:217-222 | castle_config |
| MEMBER_NOVI_PER_DAY | various | create_castle.rs:217-222 | castle_config |
| MEMBER_CASH_PER_DAY | various | create_castle.rs:217-222 | castle_config |

### Encounter Scaling

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| BASE_ENCOUNTERS_PER_CITY | 3 | state/city.rs:162 | gameplay_config |
| ENCOUNTERS_PER_PLAYER_COUNT | 10 | state/city.rs:163 | gameplay_config |
| MAX_ENCOUNTERS_PER_CITY | 50 | state/city.rs:165 | gameplay_config |

### Rally/Team

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| DEFAULT_RALLY_RECRUITING_DURATION | 3600 (1 hr) | rally/create.rs:173 | gameplay_config |
| MIN_RALLY_PARTICIPANTS | 2 | rally/execute.rs:133 | gameplay_config |
| MAX_TEAM_MEMBERS_BY_TIER | [5,10,25,50] | team/create.rs:188 | subscription_tiers |
| TEAM_INVITE_EXPIRY | 604800 (7 days) | team/invite.rs:185 | gameplay_config |
| INTRACITY_WALKING_SPEED_KMH | 5.0 | rally processors | gameplay_config |

### Economy

| Constant | Value | Used in | Suggested GameEngine section |
|----------|-------|---------|------------------------------|
| STARTER_LOCKED_NOVI | 1000000 | initialization/player.rs:384 | economic_config |
| RESERVED_NOVI_VESTING_PERIOD | 604800 (7 days) | token/withdraw_reserved.rs:121 | economic_config |
| MAX_REINFORCEMENT_RECEIVE | 10000 | reinforcement/send.rs:216 | gameplay_config |

---

## Section 4: Action Plan

### Phase 1: Remove Dead Code

Delete all ~115 dead constants from `constants.rs`. No code changes needed since nothing references them. This is a pure cleanup step with zero risk of breaking anything.

### Phase 2: Migrate Tunable Constants to GameEngine

For each group of constants that should move:

1. Add new config structs/fields to GameEngine state:
   - `arena_config` (new section)
   - `expedition_config` (new section)
   - `dungeon_config` (new section)
   - `castle_config` (new section)
   - Extend existing `gameplay_config` and `economic_config`
2. Initialize default values in `create_game_engine()`
3. Update processor code to read from GameEngine instead of constants
4. Add DAO update instructions for each new config section
5. Remove migrated constants from `constants.rs`

### Phase 3: Keep Structural Constants

PDA seeds, math constants, enum values, data tables, and prize distributions remain in `constants.rs` as compile-time constants. These are structural to the protocol and cannot be changed without breaking existing on-chain state.
