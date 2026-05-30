use crate::constants::{PLAYER_SEED, USER_SEED};
use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system;

// Re-export InventoryItem from inventory module (used by separate PlayerInventory PDA).
pub use super::inventory::InventoryItem;

// Null pubkey constant for representing None
pub const NULL_PUBKEY: Address = Address::new_from_array([0u8; 32]);

// EXTENSION FLAGS
// Bit values are arbitrary identifiers — what matters is the unlock chain in
// `prerequisite_for_extension` and that OFFSETS follow the unlock order.
pub const EXT_RESEARCH: u32 = 1 << 0;
pub const EXT_HEROES: u32 = 1 << 1;
pub const EXT_INVENTORY: u32 = 1 << 2;
pub const EXT_RALLY: u32 = 1 << 3;
pub const EXT_TEAM: u32 = 1 << 4;
pub const EXT_COSMETICS: u32 = 1 << 5;
pub const EXT_COURT: u32 = 1 << 6;

// SECTION SIZES (verified by compile-time assertions at end of file)
pub const CORE_SIZE: usize = 528;
pub const RESEARCH_SIZE: usize = 48;
pub const INVENTORY_SIZE: usize = 144;
pub const TEAM_SIZE: usize = 112;
pub const RALLY_SIZE: usize = 80;
pub const HEROES_SIZE: usize = 208;
pub const COSMETICS_SIZE: usize = 80;
pub const COURT_SIZE: usize = 48;

// OFFSETS — match the unlock chain RESEARCH → INVENTORY → TEAM → RALLY →
// HEROES → COSMETICS → COURT. Resize-on-unlock always grows to the end of the
// last unlocked section, and prerequisites guarantee earlier sections already
// exist.
pub const CORE_OFFSET: usize = 0;
pub const RESEARCH_OFFSET: usize = CORE_SIZE;
pub const INVENTORY_OFFSET: usize = RESEARCH_OFFSET + RESEARCH_SIZE;
pub const TEAM_OFFSET: usize = INVENTORY_OFFSET + INVENTORY_SIZE;
pub const RALLY_OFFSET: usize = TEAM_OFFSET + TEAM_SIZE;
pub const HEROES_OFFSET: usize = RALLY_OFFSET + RALLY_SIZE;
pub const COSMETICS_OFFSET: usize = HEROES_OFFSET + HEROES_SIZE;
pub const COURT_OFFSET: usize = COSMETICS_OFFSET + COSMETICS_SIZE;
pub const MAX_SIZE: usize = COURT_OFFSET + COURT_SIZE;

// LEAN PLAYER CORE — only fields needed from minute zero of gameplay.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerCore {
    // Identity (80 bytes, aligned for created_at)
    pub account_key: u8,      // 1
    pub game_engine: Address, // 32
    pub owner: Address,       // 32
    pub bump: u8,             // 1
    pub version: u8,          // 1
    pub _pad1: [u8; 5],       // 5 → align created_at to 8
    pub created_at: i64,      // 8

    // Name (56 bytes)
    pub name: [u8; 48],
    pub name_len: u8,
    pub _pad_name: [u8; 7],

    // Extension bitmap (8 bytes)
    pub extensions: u32,
    pub _pad_ext: [u8; 4],

    // Locked NOVI (16 bytes)
    pub locked_novi: u64,
    pub last_updated_tokens_at: i64,

    // Units (48 bytes)
    pub defensive_unit_1: u64,
    pub defensive_unit_2: u64,
    pub defensive_unit_3: u64,
    pub operative_unit_1: u64,
    pub operative_unit_2: u64,
    pub operative_unit_3: u64,

    // Equipment variety (48 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor_pieces: u64,
    pub produce: u64,
    pub vehicles: u64,

    // Cash (16 bytes)
    pub cash_on_hand: u64,
    pub cash_in_vault: u64,

    // Happiness (8 bytes)
    pub happiness_defensive: f32,
    pub happiness_operative: f32,

    // Location (72 bytes)
    pub current_lat: f64,
    pub current_long: f64,
    pub traveling_to_lat: f64,
    pub traveling_to_long: f64,
    pub arrival_time: i64,
    pub current_city: u16,
    pub travel_type: u8,
    pub _pad_loc: [u8; 5],
    pub origin_city: u16,
    pub destination_city: u16,
    pub _pad_loc2: [u8; 4],
    pub departure_time: i64,
    pub travel_speed_locked: f32,
    pub _pad_loc3: [u8; 4],

    // Subscription (16 bytes)
    pub subscription_tier: u8,
    pub _pad_sub: [u8; 7],
    pub subscription_end: i64,

    // Progression (32 bytes)
    pub level: u8,
    pub _pad_lvl: [u8; 7],
    pub current_xp: u64,
    pub reputation: u64,
    pub networth: u64,

    // Stamina (24 bytes)
    pub encounter_stamina: u64,
    pub max_encounter_stamina: u64,
    pub last_stamina_update: i64,

    // Event (8 bytes)
    pub current_event: u64,

    // Basic resources (16 bytes)
    pub gems: u64,
    pub fragments: u64,

    // Lifetime stats (56 bytes)
    pub total_attacks: u64,
    pub total_defenses: u64,
    pub total_attack_power: u64,
    pub total_encounter_attacks: u64,
    pub total_locked_novi_acquired: u64,
    pub total_sent: u64,
    pub total_received: u64,

    // Protection & flags (16 bytes)
    pub new_player_protection_until: i64,
    pub flagged_by_governance: bool,
    pub _pad_end: [u8; 7],

    // Loot counter (8 bytes)
    pub loot_counter: u64,
}

// SECTION STRUCTS — canonical storage for unlock-gated state.

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResearchSection {
    // Battle buffs (12)
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub crit_chance_bps: u16,
    pub crit_damage_bps: u16,
    pub loot_bonus_bps: u16,
    pub encounter_success_bps: u16,
    // Growth buffs (12)
    pub synchrony_bonus_bps: u16,
    pub reputation_bonus_bps: u16,
    pub stamina_bonus_bps: u16,
    pub collection_bonus_bps: u16,
    pub loot_magnetism_bps: u16,
    pub daily_reward_bps: u16,
    // Unlock flags (8)
    pub has_daily_rewards: bool,
    pub has_mining: bool,
    pub has_fishing: bool,
    pub has_fragment_drops: bool,
    pub has_gem_drops: bool,
    pub _reserved_flags: [u8; 3],
    // State (16)
    pub buff_version: u32,
    pub _pad_state: [u8; 4],
    pub last_daily_claim: i64,
}

impl ResearchSection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            attack_bps: 0,
            defense_bps: 0,
            crit_chance_bps: 0,
            crit_damage_bps: 0,
            loot_bonus_bps: 0,
            encounter_success_bps: 0,
            synchrony_bonus_bps: 0,
            reputation_bonus_bps: 0,
            stamina_bonus_bps: 0,
            collection_bonus_bps: 0,
            loot_magnetism_bps: 0,
            daily_reward_bps: 0,
            has_daily_rewards: false,
            has_mining: false,
            has_fishing: false,
            has_fragment_drops: false,
            has_gem_drops: false,
            _reserved_flags: [0; 3],
            buff_version: 0,
            _pad_state: [0; 4],
            last_daily_claim: 0,
        }
    }
}

// Counters/totals only. Actual item slots live on the separate PlayerInventory PDA.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct InventorySection {
    // Consumables (32 bytes)
    pub stamina_potions: u16,
    pub xp_boosters: u16,
    pub loot_magnets: u16,
    pub shield_tokens: u16,
    pub speed_elixirs: u16,
    pub attack_boosters: u16,
    pub defense_boosters: u16,
    pub collection_boosters: u16,
    pub rally_horns: u16,
    pub teleport_scrolls: u16,
    pub mystery_keys: u16,
    pub _reserved_consumables: [u8; 10],

    // Materials (40 bytes) — u64 for headroom
    pub common_materials: u64,
    pub uncommon_materials: u64,
    pub rare_materials: u64,
    pub epic_materials: u64,
    pub legendary_materials: u64,

    // Equipped bonus totals (8 bytes)
    pub equipped_weapon_bonus_bps: u16,
    pub equipped_armor_bonus_bps: u16,
    pub _pad_equipped: [u8; 4],

    // Shop state (32 bytes)
    pub total_shop_spent: u64,
    pub milestone_tier: u8,
    pub loyalty_streak: u8,
    pub daily_purchase_count: u8,
    pub flash_claims_today: u8,
    pub _pad_shop1: [u8; 4],
    pub last_purchase_day: u32,
    pub _pad_shop2: [u8; 4],
    pub last_daily_reset: i64,

    // Transfer tracking (24 bytes)
    pub daily_transfer_count: u16,
    pub _pad_transfer: [u8; 6],
    pub daily_transferred: u64,
    pub last_transfer_reset: i64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],
}

impl InventorySection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            stamina_potions: 0,
            xp_boosters: 0,
            loot_magnets: 0,
            shield_tokens: 0,
            speed_elixirs: 0,
            attack_boosters: 0,
            defense_boosters: 0,
            collection_boosters: 0,
            rally_horns: 0,
            teleport_scrolls: 0,
            mystery_keys: 0,
            _reserved_consumables: [0; 10],
            common_materials: 0,
            uncommon_materials: 0,
            rare_materials: 0,
            epic_materials: 0,
            legendary_materials: 0,
            equipped_weapon_bonus_bps: 0,
            equipped_armor_bonus_bps: 0,
            _pad_equipped: [0; 4],
            total_shop_spent: 0,
            milestone_tier: 0,
            loyalty_streak: 0,
            daily_purchase_count: 0,
            flash_claims_today: 0,
            _pad_shop1: [0; 4],
            last_purchase_day: 0,
            _pad_shop2: [0; 4],
            last_daily_reset: 0,
            daily_transfer_count: 0,
            _pad_transfer: [0; 6],
            daily_transferred: 0,
            last_transfer_reset: 0,
            _reserved: [0; 8],
        }
    }
}

// Team membership + reinforcement aggregates (only meaningful with a team).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamSection {
    pub team: Address,        // 32
    pub team_slot_index: u16, // 2
    pub _pad_team: [u8; 6],   // 6
    // Reinforcement units (48)
    pub reinforcement_def_1: u64,
    pub reinforcement_def_2: u64,
    pub reinforcement_def_3: u64,
    pub reinforcement_melee: u64,
    pub reinforcement_ranged: u64,
    pub reinforcement_siege: u64,
    // Reinforcement originals for survival ratio (16)
    pub reinforcement_original_units: u64,
    pub reinforcement_original_weapons: u64,
    // Reinforcement hero contribution + count (8)
    pub reinforcement_hero_defense_bps: u16,
    pub reinforcement_hero_weapon_eff_bps: u16,
    pub reinforcement_hero_armor_eff_bps: u16,
    pub reinforcement_source_count: u8,
    pub _pad_reinforcement: u8,
}

impl TeamSection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            team: NULL_PUBKEY,
            team_slot_index: 0,
            _pad_team: [0; 6],
            reinforcement_def_1: 0,
            reinforcement_def_2: 0,
            reinforcement_def_3: 0,
            reinforcement_melee: 0,
            reinforcement_ranged: 0,
            reinforcement_siege: 0,
            reinforcement_original_units: 0,
            reinforcement_original_weapons: 0,
            reinforcement_hero_defense_bps: 0,
            reinforcement_hero_weapon_eff_bps: 0,
            reinforcement_hero_armor_eff_bps: 0,
            reinforcement_source_count: 0,
            _pad_reinforcement: 0,
        }
    }
    #[inline]
    pub fn has_team(&self) -> bool {
        self.team != NULL_PUBKEY
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyStats {
    pub current_rallies_joined: u8,
    pub rallies_created_today: u8,
    pub _padding1: [u8; 6],
    pub last_rally_creation_reset: i64,
    pub total_rallies_joined: u64,
    pub total_rallies_created: u64,
    pub total_rallies_won: u64,
    pub total_rallies_lost: u64,
    pub total_rally_loot_earned: u64,
    pub total_rally_damage_dealt: u64,
    pub _reserved: [u8; 8],
}

impl RallyStats {
    pub const fn default() -> Self {
        Self {
            current_rallies_joined: 0,
            rallies_created_today: 0,
            _padding1: [0; 6],
            last_rally_creation_reset: 0,
            total_rallies_joined: 0,
            total_rallies_created: 0,
            total_rallies_won: 0,
            total_rallies_lost: 0,
            total_rally_loot_earned: 0,
            total_rally_damage_dealt: 0,
            _reserved: [0; 8],
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerRallyCaps {
    pub max_concurrent_rallies: u8,
    pub max_rallies_per_day: u8,
    pub _padding: [u8; 6],
}

impl PlayerRallyCaps {
    pub const fn default() -> Self {
        Self {
            max_concurrent_rallies: 3,
            max_rallies_per_day: 5,
            _padding: [0; 6],
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallySection {
    pub rally_caps: PlayerRallyCaps, // 8
    pub rally_stats: RallyStats,     // 72
}

impl RallySection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            rally_caps: PlayerRallyCaps::default(),
            rally_stats: RallyStats::default(),
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct HeroesSection {
    pub active_heroes: [Address; 3], // 96
    pub defensive_hero_slot: u8,     // 1
    pub meditating_hero_slot: u8,    // 1 (255 = none)
    pub _pad_slots: [u8; 6],         // 6  → 104

    // Buffs (36)
    pub hero_attack_bps: u16,
    pub hero_defense_bps: u16,
    pub hero_economy_bps: u16,
    pub hero_xp_gain_bps: u16,
    pub hero_training_cost_reduction_bps: u16,
    pub hero_collection_rate_bps: u16,
    pub hero_rally_capacity_bps: u16,
    pub hero_stamina_regen_bps: u16,
    pub hero_produce_generation_bps: u16,
    pub hero_weapon_efficiency_bps: u16,
    pub hero_armor_efficiency_bps: u16,
    pub hero_crit_chance_bps: u16,
    pub hero_encounter_damage_bps: u16,
    pub hero_loot_bonus_bps: u16,
    pub hero_synchrony_bonus_bps: u16,
    pub hero_resource_capacity_bps: u16,
    pub hero_unit_capacity_bps: u16,
    pub blessed_hero_bonus_bps: u16,
    // → 140

    // Location synergy (8)
    pub slot_location_bonus: [u16; 3],
    pub _pad_bonus: [u8; 2],
    // → 148

    // Meditation (8)
    pub meditation_started_at: i64,
    // → 156
    pub _reserved: [u8; 4],
    // → 160

    // Active ability state. Player triggers via use_ability ix; combat
    // sites consume the pending one-shot.
    //
    // Cooldown is mirrored from each hero's NFT "AbCD" attribute at lock
    // time and written back at unlock, so unlock+relock cannot reset it.
    pub ability_last_used_at: [i64; 3], // 24 per-slot, cached from NFT
    // → 184

    // Single pending one-shot effect (set by use_ability, consumed at combat)
    pub pending_effect_kind: u8, // 1   AbilityKind discriminant (0 = none)
    pub pending_effect_stat: u8, // 1   BuffStat for BuffNext kind
    pub pending_effect_param: u16, // 2   bps for BuffNext kind
    pub _pending_pad: [u8; 4],   // 4   align
    pub pending_effect_expires_at: i64, // 8   24h auto-expire so it doesn't sit forever
                                 // → 200
}

impl HeroesSection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            active_heroes: [NULL_PUBKEY; 3],
            defensive_hero_slot: 0,
            meditating_hero_slot: 255,
            _pad_slots: [0; 6],
            hero_attack_bps: 0,
            hero_defense_bps: 0,
            hero_economy_bps: 0,
            hero_xp_gain_bps: 0,
            hero_training_cost_reduction_bps: 0,
            hero_collection_rate_bps: 0,
            hero_rally_capacity_bps: 0,
            hero_stamina_regen_bps: 0,
            hero_produce_generation_bps: 0,
            hero_weapon_efficiency_bps: 0,
            hero_armor_efficiency_bps: 0,
            hero_crit_chance_bps: 0,
            hero_encounter_damage_bps: 0,
            hero_loot_bonus_bps: 0,
            hero_synchrony_bonus_bps: 0,
            hero_resource_capacity_bps: 0,
            hero_unit_capacity_bps: 0,
            blessed_hero_bonus_bps: 0,
            slot_location_bonus: [0; 3],
            _pad_bonus: [0; 2],
            meditation_started_at: 0,
            _reserved: [0; 4],
            ability_last_used_at: [0; 3],
            pending_effect_kind: 0,
            pending_effect_stat: 0,
            pending_effect_param: 0,
            _pending_pad: [0; 4],
            pending_effect_expires_at: 0,
        }
    }

    pub fn count_active_heroes(&self) -> u8 {
        self.active_heroes
            .iter()
            .filter(|h| *h != &NULL_PUBKEY)
            .count() as u8
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CosmeticsSection {
    pub equipped_avatar_frame: u16,
    pub equipped_name_color: u16,
    pub equipped_title: u16,
    pub equipped_badge: u16,
    pub equipped_attack_effect: u16,
    pub equipped_victory_pose: u16,
    pub _padding: [u8; 4],
    pub owned_frames: u64,
    pub owned_colors: u64,
    pub owned_titles: u64,
    pub owned_badges: u64,
    pub owned_effects: u64,
    pub owned_poses: u64,
    pub _reserved: [u8; 16],
}

impl CosmeticsSection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            equipped_avatar_frame: 0,
            equipped_name_color: 0,
            equipped_title: 0,
            equipped_badge: 0,
            equipped_attack_effect: 0,
            equipped_victory_pose: 0,
            _padding: [0; 4],
            owned_frames: 0,
            owned_colors: 0,
            owned_titles: 0,
            owned_badges: 0,
            owned_effects: 0,
            owned_poses: 0,
            _reserved: [0; 16],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct CourtSection {
    pub castle: Address,               // 32
    pub position_type: u8,             // 1
    pub _padding: [u8; 7],             // 7
    pub court_attack_bps: u16,         // 2
    pub court_research_speed_bps: u16, // 2
    pub court_defense_bps: u16,        // 2
    pub court_economy_bps: u16,        // 2
}

impl CourtSection {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const fn init() -> Self {
        Self {
            castle: NULL_PUBKEY,
            position_type: 0,
            _padding: [0; 7],
            court_attack_bps: 0,
            court_research_speed_bps: 0,
            court_defense_bps: 0,
            court_economy_bps: 0,
        }
    }
    pub fn is_holding_position(&self) -> bool {
        self.castle != NULL_PUBKEY
    }
    pub fn set_position(&mut self, castle: Address, position_type: u8) {
        self.castle = castle;
        self.position_type = position_type;
    }
    pub fn clear(&mut self) {
        self.castle = NULL_PUBKEY;
        self.position_type = 0;
        self.court_attack_bps = 0;
        self.court_research_speed_bps = 0;
        self.court_defense_bps = 0;
        self.court_economy_bps = 0;
    }
}

// PLAYER ACCOUNT ALIAS
pub type PlayerAccount = PlayerCore;

// Core impl — init, loaders, accessors, helpers
impl PlayerCore {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Bare init — no city, no starter resources. Generally use init_with_city instead.
    pub fn init(game_engine: Address, owner: Address, created_at: i64, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::Player as u8,
            game_engine,
            owner,
            bump,
            version: 1,
            _pad1: [0; 5],
            created_at,
            name: [0u8; 48],
            name_len: 0,
            _pad_name: [0; 7],
            extensions: 0,
            _pad_ext: [0; 4],
            locked_novi: 0,
            last_updated_tokens_at: created_at,
            defensive_unit_1: 0,
            defensive_unit_2: 0,
            defensive_unit_3: 0,
            operative_unit_1: 0,
            operative_unit_2: 0,
            operative_unit_3: 0,
            melee_weapons: 0,
            ranged_weapons: 0,
            siege_weapons: 0,
            armor_pieces: 0,
            produce: 0,
            vehicles: 0,
            cash_on_hand: 0,
            cash_in_vault: 0,
            happiness_defensive: 1.0,
            happiness_operative: 1.0,
            current_lat: 0.0,
            current_long: 0.0,
            traveling_to_lat: f64::NAN,
            traveling_to_long: f64::NAN,
            arrival_time: -1,
            current_city: 0,
            travel_type: 0,
            _pad_loc: [0; 5],
            origin_city: 0,
            destination_city: 0,
            _pad_loc2: [0; 4],
            departure_time: 0,
            travel_speed_locked: 0.0,
            _pad_loc3: [0; 4],
            subscription_tier: 0,
            _pad_sub: [0; 7],
            subscription_end: 0,
            level: 1,
            _pad_lvl: [0; 7],
            current_xp: 0,
            reputation: 0,
            networth: 0,
            encounter_stamina: 100,
            max_encounter_stamina: 100,
            last_stamina_update: created_at,
            current_event: 0,
            gems: 0,
            fragments: 0,
            total_attacks: 0,
            total_defenses: 0,
            total_attack_power: 0,
            total_encounter_attacks: 0,
            total_locked_novi_acquired: 0,
            total_sent: 0,
            total_received: 0,
            new_player_protection_until: 0,
            flagged_by_governance: false,
            _pad_end: [0; 7],
            loot_counter: 0,
        }
    }

    /// Init with starting city, coordinates, and starter resources (Rookie tier).
    /// `starter_locked_novi` is read from `GameEngine.economic_config` so each
    /// kingdom can tune onboarding generosity independently.
    pub fn init_with_city(
        game_engine: Address,
        owner: Address,
        created_at: i64,
        bump: u8,
        city_id: u16,
        latitude: f64,
        longitude: f64,
        protection_duration: i64,
        starter_locked_novi: u64,
    ) -> Self {
        let mut core = Self::init(game_engine, owner, created_at, bump);
        core.locked_novi = starter_locked_novi;
        // Starter units
        core.defensive_unit_1 = 10_000;
        core.defensive_unit_2 = 4_000;
        core.defensive_unit_3 = 2_000;
        core.operative_unit_1 = 10_000;
        core.operative_unit_2 = 4_000;
        core.operative_unit_3 = 1_000;
        // Starter equipment
        core.melee_weapons = 8_000;
        core.ranged_weapons = 4_000;
        core.siege_weapons = 2_000;
        core.armor_pieces = 8_000;
        core.produce = 50_000;
        core.vehicles = 500;
        // Starter cash
        core.cash_on_hand = 130_000_000;
        // Spawn location
        core.current_lat = latitude;
        core.current_long = longitude;
        core.current_city = city_id;
        // Starter gems
        core.gems = 10_000;
        // New player protection
        core.new_player_protection_until = created_at.saturating_add(protection_duration);
        core
    }

    // Raw loaders

    /// UNSAFE: cast raw data as a PlayerCore reference.
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: cast raw data as a mutable PlayerCore reference.
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn load_checked<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;
        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Player, "PlayerAccount")?
        };
        crate::validation::require_stored_owner(
            &loaded.owner,
            expected_owner,
            "PlayerAccount",
            account,
        )?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "PlayerAccount",
            account,
        )?;
        let expected_pda = Self::create_pda(game_engine, expected_owner, loaded.bump)?;
        crate::validation::require_pda_eq(account, &expected_pda, "PlayerAccount")?;
        Ok(loaded)
    }

    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;
        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Player,
                "PlayerAccount",
            )?
        };
        crate::validation::require_stored_owner(
            &loaded.owner,
            expected_owner,
            "PlayerAccount",
            account,
        )?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "PlayerAccount",
            account,
        )?;
        let expected_pda = Self::create_pda(game_engine, expected_owner, loaded.bump)?;
        crate::validation::require_pda_eq(account, &expected_pda, "PlayerAccount")?;
        Ok(loaded)
    }

    /// Re-acquire a mutable Player reference without re-deriving the PDA.
    /// Sound only when this exact account was already verified via
    /// load_checked / load_checked_mut earlier in the same instruction.
    pub fn load_mut_unchecked<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;
        unsafe {
            super::AccountKey::cast_mut::<Self>(account, super::AccountKey::Player, "PlayerAccount")
        }
    }

    pub fn load_checked_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;
        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Player, "PlayerAccount")?
        };
        let expected_pda = Self::create_pda(&loaded.game_engine, &loaded.owner, loaded.bump)?;
        crate::validation::require_pda_eq(account, &expected_pda, "PlayerAccount")?;
        Ok(loaded)
    }

    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;
        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Player,
                "PlayerAccount",
            )?
        };
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, &loaded.owner);
        crate::validation::require_pda_eq(account, &expected_pda, "PlayerAccount")?;
        crate::validation::require_bump_eq(loaded.bump, bump, "PlayerAccount", account)?;
        Ok(loaded)
    }

    // Section accessors
    //
    // Section memory lies immediately after CORE in the same account allocation.
    // We reach it via raw pointer arithmetic from `self`. The byte slice that
    // backs `self` is at least CORE_SIZE long, and resize-on-unlock guarantees
    // it extends through the section's end whenever that section's bit is set.

    #[inline]
    fn section_ptr<T>(&self, offset: usize) -> *const T {
        unsafe { (self as *const Self as *const u8).add(offset) as *const T }
    }

    #[inline]
    fn section_ptr_mut<T>(&mut self, offset: usize) -> *mut T {
        unsafe { (self as *mut Self as *mut u8).add(offset) as *mut T }
    }

    pub fn research(&self) -> Option<&ResearchSection> {
        if self.extensions & EXT_RESEARCH == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<ResearchSection>(RESEARCH_OFFSET) })
    }
    pub fn research_mut(&mut self) -> Option<&mut ResearchSection> {
        if self.extensions & EXT_RESEARCH == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<ResearchSection>(RESEARCH_OFFSET) })
    }
    pub fn inventory(&self) -> Option<&InventorySection> {
        if self.extensions & EXT_INVENTORY == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<InventorySection>(INVENTORY_OFFSET) })
    }
    pub fn inventory_mut(&mut self) -> Option<&mut InventorySection> {
        if self.extensions & EXT_INVENTORY == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<InventorySection>(INVENTORY_OFFSET) })
    }
    pub fn team_section(&self) -> Option<&TeamSection> {
        if self.extensions & EXT_TEAM == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<TeamSection>(TEAM_OFFSET) })
    }
    pub fn team_section_mut(&mut self) -> Option<&mut TeamSection> {
        if self.extensions & EXT_TEAM == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<TeamSection>(TEAM_OFFSET) })
    }
    pub fn rally(&self) -> Option<&RallySection> {
        if self.extensions & EXT_RALLY == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<RallySection>(RALLY_OFFSET) })
    }
    pub fn rally_mut(&mut self) -> Option<&mut RallySection> {
        if self.extensions & EXT_RALLY == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<RallySection>(RALLY_OFFSET) })
    }
    pub fn heroes(&self) -> Option<&HeroesSection> {
        if self.extensions & EXT_HEROES == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<HeroesSection>(HEROES_OFFSET) })
    }
    pub fn heroes_mut(&mut self) -> Option<&mut HeroesSection> {
        if self.extensions & EXT_HEROES == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<HeroesSection>(HEROES_OFFSET) })
    }
    pub fn cosmetics(&self) -> Option<&CosmeticsSection> {
        if self.extensions & EXT_COSMETICS == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<CosmeticsSection>(COSMETICS_OFFSET) })
    }
    pub fn cosmetics_mut(&mut self) -> Option<&mut CosmeticsSection> {
        if self.extensions & EXT_COSMETICS == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<CosmeticsSection>(COSMETICS_OFFSET) })
    }
    pub fn court(&self) -> Option<&CourtSection> {
        if self.extensions & EXT_COURT == 0 {
            return None;
        }
        Some(unsafe { &*self.section_ptr::<CourtSection>(COURT_OFFSET) })
    }
    pub fn court_mut(&mut self) -> Option<&mut CourtSection> {
        if self.extensions & EXT_COURT == 0 {
            return None;
        }
        Some(unsafe { &mut *self.section_ptr_mut::<CourtSection>(COURT_OFFSET) })
    }

    // RESEARCH FIELDS
    #[inline]
    pub fn research_attack_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.attack_bps)
    }
    #[inline]
    pub fn set_research_attack_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.attack_bps = v;
        }
    }
    #[inline]
    pub fn research_defense_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.defense_bps)
    }
    #[inline]
    pub fn set_research_defense_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.defense_bps = v;
        }
    }
    #[inline]
    pub fn research_crit_chance_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.crit_chance_bps)
    }
    #[inline]
    pub fn set_research_crit_chance_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.crit_chance_bps = v;
        }
    }
    #[inline]
    pub fn research_crit_damage_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.crit_damage_bps)
    }
    #[inline]
    pub fn set_research_crit_damage_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.crit_damage_bps = v;
        }
    }
    #[inline]
    pub fn research_loot_bonus_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.loot_bonus_bps)
    }
    #[inline]
    pub fn set_research_loot_bonus_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.loot_bonus_bps = v;
        }
    }
    #[inline]
    pub fn research_encounter_success_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.encounter_success_bps)
    }
    #[inline]
    pub fn set_research_encounter_success_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.encounter_success_bps = v;
        }
    }
    #[inline]
    pub fn research_synchrony_bonus_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.synchrony_bonus_bps)
    }
    #[inline]
    pub fn set_research_synchrony_bonus_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.synchrony_bonus_bps = v;
        }
    }
    #[inline]
    pub fn research_reputation_bonus_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.reputation_bonus_bps)
    }
    #[inline]
    pub fn set_research_reputation_bonus_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.reputation_bonus_bps = v;
        }
    }
    #[inline]
    pub fn research_stamina_bonus_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.stamina_bonus_bps)
    }
    #[inline]
    pub fn set_research_stamina_bonus_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.stamina_bonus_bps = v;
        }
    }
    #[inline]
    pub fn research_collection_bonus_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.collection_bonus_bps)
    }
    #[inline]
    pub fn set_research_collection_bonus_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.collection_bonus_bps = v;
        }
    }
    #[inline]
    pub fn research_loot_magnetism_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.loot_magnetism_bps)
    }
    #[inline]
    pub fn set_research_loot_magnetism_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.loot_magnetism_bps = v;
        }
    }
    #[inline]
    pub fn research_daily_reward_bps(&self) -> u16 {
        self.research().map_or(0, |r| r.daily_reward_bps)
    }
    #[inline]
    pub fn set_research_daily_reward_bps(&mut self, v: u16) {
        if let Some(r) = self.research_mut() {
            r.daily_reward_bps = v;
        }
    }
    #[inline]
    pub fn has_daily_rewards(&self) -> bool {
        self.research().map_or(false, |r| r.has_daily_rewards)
    }
    #[inline]
    pub fn set_has_daily_rewards(&mut self, v: bool) {
        if let Some(r) = self.research_mut() {
            r.has_daily_rewards = v;
        }
    }
    #[inline]
    pub fn has_mining(&self) -> bool {
        self.research().map_or(false, |r| r.has_mining)
    }
    #[inline]
    pub fn set_has_mining(&mut self, v: bool) {
        if let Some(r) = self.research_mut() {
            r.has_mining = v;
        }
    }
    #[inline]
    pub fn has_fishing(&self) -> bool {
        self.research().map_or(false, |r| r.has_fishing)
    }
    #[inline]
    pub fn set_has_fishing(&mut self, v: bool) {
        if let Some(r) = self.research_mut() {
            r.has_fishing = v;
        }
    }
    #[inline]
    pub fn has_fragment_drops(&self) -> bool {
        self.research().map_or(false, |r| r.has_fragment_drops)
    }
    #[inline]
    pub fn set_has_fragment_drops(&mut self, v: bool) {
        if let Some(r) = self.research_mut() {
            r.has_fragment_drops = v;
        }
    }
    #[inline]
    pub fn has_gem_drops(&self) -> bool {
        self.research().map_or(false, |r| r.has_gem_drops)
    }
    #[inline]
    pub fn set_has_gem_drops(&mut self, v: bool) {
        if let Some(r) = self.research_mut() {
            r.has_gem_drops = v;
        }
    }
    #[inline]
    pub fn research_buff_version(&self) -> u32 {
        self.research().map_or(0, |r| r.buff_version)
    }
    #[inline]
    pub fn set_research_buff_version(&mut self, v: u32) {
        if let Some(r) = self.research_mut() {
            r.buff_version = v;
        }
    }
    #[inline]
    pub fn last_daily_claim(&self) -> i64 {
        self.research().map_or(0, |r| r.last_daily_claim)
    }
    #[inline]
    pub fn set_last_daily_claim(&mut self, v: i64) {
        if let Some(r) = self.research_mut() {
            r.last_daily_claim = v;
        }
    }

    // HERO FIELDS
    #[inline]
    pub fn active_heroes_arr(&self) -> [Address; 3] {
        self.heroes().map_or([NULL_PUBKEY; 3], |h| h.active_heroes)
    }
    #[inline]
    pub fn active_hero_at(&self, slot: usize) -> Address {
        self.heroes().map_or(NULL_PUBKEY, |h| h.active_heroes[slot])
    }
    #[inline]
    pub fn set_active_hero_at(&mut self, slot: usize, addr: Address) {
        if let Some(h) = self.heroes_mut() {
            h.active_heroes[slot] = addr;
        }
    }
    #[inline]
    pub fn defensive_hero_slot(&self) -> u8 {
        self.heroes().map_or(0, |h| h.defensive_hero_slot)
    }
    #[inline]
    pub fn set_defensive_hero_slot(&mut self, v: u8) {
        if let Some(h) = self.heroes_mut() {
            h.defensive_hero_slot = v;
        }
    }
    #[inline]
    pub fn meditating_hero_slot(&self) -> u8 {
        self.heroes().map_or(255, |h| h.meditating_hero_slot)
    }
    #[inline]
    pub fn set_meditating_hero_slot(&mut self, v: u8) {
        if let Some(h) = self.heroes_mut() {
            h.meditating_hero_slot = v;
        }
    }
    #[inline]
    pub fn slot_location_bonus(&self) -> [u16; 3] {
        self.heroes().map_or([0; 3], |h| h.slot_location_bonus)
    }
    #[inline]
    pub fn slot_location_bonus_at(&self, slot: usize) -> u16 {
        self.heroes().map_or(0, |h| h.slot_location_bonus[slot])
    }
    #[inline]
    pub fn set_slot_location_bonus_at(&mut self, slot: usize, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.slot_location_bonus[slot] = v;
        }
    }
    #[inline]
    pub fn meditation_started_at(&self) -> i64 {
        self.heroes().map_or(0, |h| h.meditation_started_at)
    }
    #[inline]
    pub fn set_meditation_started_at(&mut self, v: i64) {
        if let Some(h) = self.heroes_mut() {
            h.meditation_started_at = v;
        }
    }

    #[inline]
    pub fn hero_attack_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_attack_bps)
    }
    #[inline]
    pub fn set_hero_attack_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_attack_bps = v;
        }
    }
    #[inline]
    pub fn hero_defense_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_defense_bps)
    }
    #[inline]
    pub fn set_hero_defense_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_defense_bps = v;
        }
    }
    #[inline]
    pub fn hero_economy_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_economy_bps)
    }
    #[inline]
    pub fn set_hero_economy_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_economy_bps = v;
        }
    }
    #[inline]
    pub fn hero_xp_gain_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_xp_gain_bps)
    }
    #[inline]
    pub fn set_hero_xp_gain_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_xp_gain_bps = v;
        }
    }
    #[inline]
    pub fn hero_training_cost_reduction_bps(&self) -> u16 {
        self.heroes()
            .map_or(0, |h| h.hero_training_cost_reduction_bps)
    }
    #[inline]
    pub fn set_hero_training_cost_reduction_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_training_cost_reduction_bps = v;
        }
    }
    #[inline]
    pub fn hero_collection_rate_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_collection_rate_bps)
    }
    #[inline]
    pub fn set_hero_collection_rate_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_collection_rate_bps = v;
        }
    }
    #[inline]
    pub fn hero_rally_capacity_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_rally_capacity_bps)
    }
    #[inline]
    pub fn set_hero_rally_capacity_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_rally_capacity_bps = v;
        }
    }
    #[inline]
    pub fn hero_stamina_regen_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_stamina_regen_bps)
    }
    #[inline]
    pub fn set_hero_stamina_regen_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_stamina_regen_bps = v;
        }
    }
    #[inline]
    pub fn hero_produce_generation_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_produce_generation_bps)
    }
    #[inline]
    pub fn set_hero_produce_generation_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_produce_generation_bps = v;
        }
    }
    #[inline]
    pub fn hero_weapon_efficiency_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_weapon_efficiency_bps)
    }
    #[inline]
    pub fn set_hero_weapon_efficiency_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_weapon_efficiency_bps = v;
        }
    }
    #[inline]
    pub fn hero_armor_efficiency_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_armor_efficiency_bps)
    }
    #[inline]
    pub fn set_hero_armor_efficiency_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_armor_efficiency_bps = v;
        }
    }
    #[inline]
    pub fn hero_crit_chance_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_crit_chance_bps)
    }
    #[inline]
    pub fn set_hero_crit_chance_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_crit_chance_bps = v;
        }
    }
    #[inline]
    pub fn hero_encounter_damage_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_encounter_damage_bps)
    }
    #[inline]
    pub fn set_hero_encounter_damage_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_encounter_damage_bps = v;
        }
    }
    #[inline]
    pub fn hero_loot_bonus_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_loot_bonus_bps)
    }
    #[inline]
    pub fn set_hero_loot_bonus_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_loot_bonus_bps = v;
        }
    }
    #[inline]
    pub fn hero_synchrony_bonus_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_synchrony_bonus_bps)
    }
    #[inline]
    pub fn set_hero_synchrony_bonus_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_synchrony_bonus_bps = v;
        }
    }
    #[inline]
    pub fn hero_resource_capacity_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_resource_capacity_bps)
    }
    #[inline]
    pub fn set_hero_resource_capacity_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_resource_capacity_bps = v;
        }
    }
    #[inline]
    pub fn hero_unit_capacity_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.hero_unit_capacity_bps)
    }
    #[inline]
    pub fn set_hero_unit_capacity_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.hero_unit_capacity_bps = v;
        }
    }
    #[inline]
    pub fn blessed_hero_bonus_bps(&self) -> u16 {
        self.heroes().map_or(0, |h| h.blessed_hero_bonus_bps)
    }
    #[inline]
    pub fn set_blessed_hero_bonus_bps(&mut self, v: u16) {
        if let Some(h) = self.heroes_mut() {
            h.blessed_hero_bonus_bps = v;
        }
    }

    // ABILITY FIELDS

    #[inline]
    pub fn ability_last_used_at(&self, slot: usize) -> i64 {
        self.heroes().map_or(0, |h| h.ability_last_used_at[slot])
    }
    #[inline]
    pub fn set_ability_last_used_at(&mut self, slot: usize, v: i64) {
        if let Some(h) = self.heroes_mut() {
            h.ability_last_used_at[slot] = v;
        }
    }

    #[inline]
    pub fn pending_effect_kind(&self) -> u8 {
        self.heroes().map_or(0, |h| h.pending_effect_kind)
    }
    #[inline]
    pub fn pending_effect_stat(&self) -> u8 {
        self.heroes().map_or(0, |h| h.pending_effect_stat)
    }
    #[inline]
    pub fn pending_effect_param(&self) -> u16 {
        self.heroes().map_or(0, |h| h.pending_effect_param)
    }
    #[inline]
    pub fn pending_effect_expires_at(&self) -> i64 {
        self.heroes().map_or(0, |h| h.pending_effect_expires_at)
    }
    #[inline]
    pub fn set_pending_effect(&mut self, kind: u8, stat: u8, param: u16, expires_at: i64) {
        if let Some(h) = self.heroes_mut() {
            h.pending_effect_kind = kind;
            h.pending_effect_stat = stat;
            h.pending_effect_param = param;
            h.pending_effect_expires_at = expires_at;
        }
    }
    #[inline]
    pub fn clear_pending_effect(&mut self) {
        if let Some(h) = self.heroes_mut() {
            h.pending_effect_kind = 0;
            h.pending_effect_stat = 0;
            h.pending_effect_param = 0;
            h.pending_effect_expires_at = 0;
        }
    }

    /// Returns the pending one-shot effect kind if not expired, else 0.
    /// Caller is responsible for clearing via clear_pending_effect after consuming.
    #[inline]
    pub fn live_pending_effect(&self, now: i64) -> u8 {
        let kind = self.pending_effect_kind();
        if kind == 0 {
            return 0;
        }
        if self.pending_effect_expires_at() <= now {
            return 0;
        }
        kind
    }

    // TEAM + REINFORCEMENT FIELDS
    #[inline]
    pub fn team_address(&self) -> Address {
        self.team_section().map_or(NULL_PUBKEY, |t| t.team)
    }
    #[inline]
    pub fn set_team_address(&mut self, v: Address) {
        if let Some(t) = self.team_section_mut() {
            t.team = v;
        }
    }
    #[inline]
    pub fn team_slot_index(&self) -> u16 {
        self.team_section().map_or(0, |t| t.team_slot_index)
    }
    #[inline]
    pub fn set_team_slot_index(&mut self, v: u16) {
        if let Some(t) = self.team_section_mut() {
            t.team_slot_index = v;
        }
    }
    #[inline]
    pub fn has_team(&self) -> bool {
        self.team_section().map_or(false, |t| t.has_team())
    }

    #[inline]
    pub fn reinforcement_def_1(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_def_1)
    }
    #[inline]
    pub fn set_reinforcement_def_1(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_def_1 = v;
        }
    }
    #[inline]
    pub fn reinforcement_def_2(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_def_2)
    }
    #[inline]
    pub fn set_reinforcement_def_2(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_def_2 = v;
        }
    }
    #[inline]
    pub fn reinforcement_def_3(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_def_3)
    }
    #[inline]
    pub fn set_reinforcement_def_3(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_def_3 = v;
        }
    }
    #[inline]
    pub fn reinforcement_melee(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_melee)
    }
    #[inline]
    pub fn set_reinforcement_melee(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_melee = v;
        }
    }
    #[inline]
    pub fn reinforcement_ranged(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_ranged)
    }
    #[inline]
    pub fn set_reinforcement_ranged(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_ranged = v;
        }
    }
    #[inline]
    pub fn reinforcement_siege(&self) -> u64 {
        self.team_section().map_or(0, |t| t.reinforcement_siege)
    }
    #[inline]
    pub fn set_reinforcement_siege(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_siege = v;
        }
    }
    #[inline]
    pub fn reinforcement_original_units(&self) -> u64 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_original_units)
    }
    #[inline]
    pub fn set_reinforcement_original_units(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_original_units = v;
        }
    }
    #[inline]
    pub fn reinforcement_original_weapons(&self) -> u64 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_original_weapons)
    }
    #[inline]
    pub fn set_reinforcement_original_weapons(&mut self, v: u64) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_original_weapons = v;
        }
    }
    #[inline]
    pub fn reinforcement_hero_defense_bps(&self) -> u16 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_hero_defense_bps)
    }
    #[inline]
    pub fn set_reinforcement_hero_defense_bps(&mut self, v: u16) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_hero_defense_bps = v;
        }
    }
    #[inline]
    pub fn reinforcement_hero_weapon_eff_bps(&self) -> u16 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_hero_weapon_eff_bps)
    }
    #[inline]
    pub fn set_reinforcement_hero_weapon_eff_bps(&mut self, v: u16) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_hero_weapon_eff_bps = v;
        }
    }
    #[inline]
    pub fn reinforcement_hero_armor_eff_bps(&self) -> u16 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_hero_armor_eff_bps)
    }
    #[inline]
    pub fn set_reinforcement_hero_armor_eff_bps(&mut self, v: u16) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_hero_armor_eff_bps = v;
        }
    }
    #[inline]
    pub fn reinforcement_source_count(&self) -> u8 {
        self.team_section()
            .map_or(0, |t| t.reinforcement_source_count)
    }
    #[inline]
    pub fn set_reinforcement_source_count(&mut self, v: u8) {
        if let Some(t) = self.team_section_mut() {
            t.reinforcement_source_count = v;
        }
    }

    // INVENTORY / SHOP / TRANSFER FIELDS
    #[inline]
    pub fn stamina_potions(&self) -> u16 {
        self.inventory().map_or(0, |i| i.stamina_potions)
    }
    #[inline]
    pub fn set_stamina_potions(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.stamina_potions = v;
        }
    }
    #[inline]
    pub fn xp_boosters(&self) -> u16 {
        self.inventory().map_or(0, |i| i.xp_boosters)
    }
    #[inline]
    pub fn set_xp_boosters(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.xp_boosters = v;
        }
    }
    #[inline]
    pub fn loot_magnets(&self) -> u16 {
        self.inventory().map_or(0, |i| i.loot_magnets)
    }
    #[inline]
    pub fn set_loot_magnets(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.loot_magnets = v;
        }
    }
    #[inline]
    pub fn shield_tokens(&self) -> u16 {
        self.inventory().map_or(0, |i| i.shield_tokens)
    }
    #[inline]
    pub fn set_shield_tokens(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.shield_tokens = v;
        }
    }
    #[inline]
    pub fn speed_elixirs(&self) -> u16 {
        self.inventory().map_or(0, |i| i.speed_elixirs)
    }
    #[inline]
    pub fn set_speed_elixirs(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.speed_elixirs = v;
        }
    }
    #[inline]
    pub fn attack_boosters(&self) -> u16 {
        self.inventory().map_or(0, |i| i.attack_boosters)
    }
    #[inline]
    pub fn set_attack_boosters(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.attack_boosters = v;
        }
    }
    #[inline]
    pub fn defense_boosters(&self) -> u16 {
        self.inventory().map_or(0, |i| i.defense_boosters)
    }
    #[inline]
    pub fn set_defense_boosters(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.defense_boosters = v;
        }
    }
    #[inline]
    pub fn collection_boosters(&self) -> u16 {
        self.inventory().map_or(0, |i| i.collection_boosters)
    }
    #[inline]
    pub fn set_collection_boosters(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.collection_boosters = v;
        }
    }
    #[inline]
    pub fn rally_horns(&self) -> u16 {
        self.inventory().map_or(0, |i| i.rally_horns)
    }
    #[inline]
    pub fn set_rally_horns(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.rally_horns = v;
        }
    }
    #[inline]
    pub fn teleport_scrolls(&self) -> u16 {
        self.inventory().map_or(0, |i| i.teleport_scrolls)
    }
    #[inline]
    pub fn set_teleport_scrolls(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.teleport_scrolls = v;
        }
    }
    #[inline]
    pub fn mystery_keys(&self) -> u16 {
        self.inventory().map_or(0, |i| i.mystery_keys)
    }
    #[inline]
    pub fn set_mystery_keys(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.mystery_keys = v;
        }
    }

    #[inline]
    pub fn common_materials(&self) -> u64 {
        self.inventory().map_or(0, |i| i.common_materials)
    }
    #[inline]
    pub fn set_common_materials(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.common_materials = v;
        }
    }
    #[inline]
    pub fn uncommon_materials(&self) -> u64 {
        self.inventory().map_or(0, |i| i.uncommon_materials)
    }
    #[inline]
    pub fn set_uncommon_materials(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.uncommon_materials = v;
        }
    }
    #[inline]
    pub fn rare_materials(&self) -> u64 {
        self.inventory().map_or(0, |i| i.rare_materials)
    }
    #[inline]
    pub fn set_rare_materials(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.rare_materials = v;
        }
    }
    #[inline]
    pub fn epic_materials(&self) -> u64 {
        self.inventory().map_or(0, |i| i.epic_materials)
    }
    #[inline]
    pub fn set_epic_materials(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.epic_materials = v;
        }
    }
    #[inline]
    pub fn legendary_materials(&self) -> u64 {
        self.inventory().map_or(0, |i| i.legendary_materials)
    }
    #[inline]
    pub fn set_legendary_materials(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.legendary_materials = v;
        }
    }

    #[inline]
    pub fn equipped_weapon_bonus_bps(&self) -> u16 {
        self.inventory().map_or(0, |i| i.equipped_weapon_bonus_bps)
    }
    #[inline]
    pub fn set_equipped_weapon_bonus_bps(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.equipped_weapon_bonus_bps = v;
        }
    }
    #[inline]
    pub fn equipped_armor_bonus_bps(&self) -> u16 {
        self.inventory().map_or(0, |i| i.equipped_armor_bonus_bps)
    }
    #[inline]
    pub fn set_equipped_armor_bonus_bps(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.equipped_armor_bonus_bps = v;
        }
    }

    #[inline]
    pub fn total_shop_spent(&self) -> u64 {
        self.inventory().map_or(0, |i| i.total_shop_spent)
    }
    #[inline]
    pub fn set_total_shop_spent(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.total_shop_spent = v;
        }
    }
    #[inline]
    pub fn milestone_tier(&self) -> u8 {
        self.inventory().map_or(0, |i| i.milestone_tier)
    }
    #[inline]
    pub fn set_milestone_tier(&mut self, v: u8) {
        if let Some(i) = self.inventory_mut() {
            i.milestone_tier = v;
        }
    }
    #[inline]
    pub fn loyalty_streak(&self) -> u8 {
        self.inventory().map_or(0, |i| i.loyalty_streak)
    }
    #[inline]
    pub fn set_loyalty_streak(&mut self, v: u8) {
        if let Some(i) = self.inventory_mut() {
            i.loyalty_streak = v;
        }
    }
    #[inline]
    pub fn daily_purchase_count(&self) -> u8 {
        self.inventory().map_or(0, |i| i.daily_purchase_count)
    }
    #[inline]
    pub fn set_daily_purchase_count(&mut self, v: u8) {
        if let Some(i) = self.inventory_mut() {
            i.daily_purchase_count = v;
        }
    }
    #[inline]
    pub fn flash_claims_today(&self) -> u8 {
        self.inventory().map_or(0, |i| i.flash_claims_today)
    }
    #[inline]
    pub fn set_flash_claims_today(&mut self, v: u8) {
        if let Some(i) = self.inventory_mut() {
            i.flash_claims_today = v;
        }
    }
    #[inline]
    pub fn last_purchase_day(&self) -> u32 {
        self.inventory().map_or(0, |i| i.last_purchase_day)
    }
    #[inline]
    pub fn set_last_purchase_day(&mut self, v: u32) {
        if let Some(i) = self.inventory_mut() {
            i.last_purchase_day = v;
        }
    }
    #[inline]
    pub fn last_daily_reset(&self) -> i64 {
        self.inventory().map_or(0, |i| i.last_daily_reset)
    }
    #[inline]
    pub fn set_last_daily_reset(&mut self, v: i64) {
        if let Some(i) = self.inventory_mut() {
            i.last_daily_reset = v;
        }
    }

    #[inline]
    pub fn daily_transfer_count(&self) -> u16 {
        self.inventory().map_or(0, |i| i.daily_transfer_count)
    }
    #[inline]
    pub fn set_daily_transfer_count(&mut self, v: u16) {
        if let Some(i) = self.inventory_mut() {
            i.daily_transfer_count = v;
        }
    }
    #[inline]
    pub fn daily_transferred(&self) -> u64 {
        self.inventory().map_or(0, |i| i.daily_transferred)
    }
    #[inline]
    pub fn set_daily_transferred(&mut self, v: u64) {
        if let Some(i) = self.inventory_mut() {
            i.daily_transferred = v;
        }
    }
    #[inline]
    pub fn last_transfer_reset(&self) -> i64 {
        self.inventory().map_or(0, |i| i.last_transfer_reset)
    }
    #[inline]
    pub fn set_last_transfer_reset(&mut self, v: i64) {
        if let Some(i) = self.inventory_mut() {
            i.last_transfer_reset = v;
        }
    }

    // RALLY FIELDS (rally_caps & rally_stats accessed via section, but expose copies for legacy callers)
    #[inline]
    pub fn rally_caps(&self) -> PlayerRallyCaps {
        self.rally()
            .map_or(PlayerRallyCaps::default(), |r| r.rally_caps)
    }
    #[inline]
    pub fn rally_stats(&self) -> RallyStats {
        self.rally()
            .map_or(RallyStats::default(), |r| r.rally_stats)
    }
    /// Mutable accessor for RallyStats (None if EXT_RALLY not unlocked).
    #[inline]
    pub fn rally_stats_mut(&mut self) -> Option<&mut RallyStats> {
        self.rally_mut().map(|r| &mut r.rally_stats)
    }
    /// Mutable accessor for PlayerRallyCaps (None if EXT_RALLY not unlocked).
    #[inline]
    pub fn rally_caps_mut(&mut self) -> Option<&mut PlayerRallyCaps> {
        self.rally_mut().map(|r| &mut r.rally_caps)
    }

    // General helpers

    pub fn is_owner(&self, owner: &Address) -> bool {
        &self.owner == owner
    }
    pub fn has_extension(&self, ext: u32) -> bool {
        self.extensions & ext != 0
    }

    pub fn get_effective_tier(&self, now: i64) -> u8 {
        if self.subscription_end > now {
            self.subscription_tier.min(3)
        } else {
            0
        }
    }
    pub fn is_subscription_active(&self, now: i64) -> bool {
        self.subscription_end > now && self.subscription_tier > 0
    }

    pub fn account_age_days(&self, now: i64) -> u32 {
        ((now - self.created_at) / 86400) as u32
    }
    pub fn is_traveling(&self) -> bool {
        self.arrival_time != -1
    }
    pub fn has_arrived(&self, now: i64) -> bool {
        if self.arrival_time == -1 {
            true
        } else {
            now >= self.arrival_time
        }
    }

    pub fn total_defensive_units(&self) -> u64 {
        self.defensive_unit_1
            .saturating_add(self.defensive_unit_2)
            .saturating_add(self.defensive_unit_3)
    }
    pub fn total_operative_units(&self) -> u64 {
        self.operative_unit_1
            .saturating_add(self.operative_unit_2)
            .saturating_add(self.operative_unit_3)
    }
    pub fn total_units(&self) -> u64 {
        self.total_defensive_units()
            .saturating_add(self.total_operative_units())
    }
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }

    pub fn total_reinforcement_units(&self) -> u64 {
        self.reinforcement_def_1()
            .saturating_add(self.reinforcement_def_2())
            .saturating_add(self.reinforcement_def_3())
    }
    pub fn total_defense_with_reinforcements(&self) -> u64 {
        self.total_defensive_units()
            .saturating_add(self.total_reinforcement_units())
    }
    pub fn total_reinforcement_weapons(&self) -> u64 {
        self.reinforcement_melee()
            .saturating_add(self.reinforcement_ranged())
            .saturating_add(self.reinforcement_siege())
    }
    pub fn total_weapons_with_reinforcements(&self) -> u64 {
        self.total_weapons()
            .saturating_add(self.total_reinforcement_weapons())
    }
    pub fn reinforcement_survival_ratio(&self) -> (u64, u64) {
        let orig_units = self.reinforcement_original_units();
        let orig_weapons = self.reinforcement_original_weapons();
        let unit_ratio = if orig_units > 0 {
            self.total_reinforcement_units()
                .saturating_mul(10000)
                .checked_div(orig_units)
                .unwrap_or(10000)
        } else {
            10000
        };
        let weapon_ratio = if orig_weapons > 0 {
            self.total_reinforcement_weapons()
                .saturating_mul(10000)
                .checked_div(orig_weapons)
                .unwrap_or(10000)
        } else {
            10000
        };
        (unit_ratio, weapon_ratio)
    }

    pub fn get_travel_type(&self) -> crate::types::TravelType {
        use crate::types::TravelType;
        match self.travel_type {
            1 => TravelType::Intracity,
            2 => TravelType::Intercity,
            _ => TravelType::None,
        }
    }
    pub fn is_traveling_intercity(&self) -> bool {
        self.travel_type == 2
    }
    pub fn is_traveling_intracity(&self) -> bool {
        self.travel_type == 1
    }
    pub fn is_traveling_any(&self) -> bool {
        self.travel_type != 0
    }

    // Meditation helpers (read/write through HeroesSection)
    #[inline]
    pub fn is_hero_meditating(&self) -> bool {
        self.meditating_hero_slot() != 255 && self.meditation_started_at() > 0
    }
    #[inline]
    pub fn is_slot_meditating(&self, slot: u8) -> bool {
        self.meditating_hero_slot() == slot && self.meditation_started_at() > 0
    }
    pub fn get_meditating_hero(&self) -> Option<Address> {
        let h = self.heroes()?;
        if h.meditating_hero_slot < 3 && h.meditation_started_at > 0 {
            Some(h.active_heroes[h.meditating_hero_slot as usize])
        } else {
            None
        }
    }
    pub fn start_meditation(&mut self, slot: u8, now: i64) -> bool {
        if slot >= 3 {
            return false;
        }
        let Some(h) = self.heroes_mut() else {
            return false;
        };
        if h.active_heroes[slot as usize] == NULL_PUBKEY {
            return false;
        }
        h.meditating_hero_slot = slot;
        h.meditation_started_at = now;
        true
    }
    pub fn end_meditation(&mut self, now: i64, max_duration_seconds: i64) -> Option<i64> {
        let h = self.heroes_mut()?;
        if h.meditating_hero_slot == 255 || h.meditation_started_at <= 0 {
            return None;
        }
        let elapsed = now.saturating_sub(h.meditation_started_at);
        let capped = elapsed.min(max_duration_seconds);
        h.meditating_hero_slot = 255;
        h.meditation_started_at = 0;
        Some(capped)
    }

    pub fn derive_pda(game_engine: &Address, owner: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[PLAYER_SEED, game_engine.as_ref(), owner.as_ref()],
            &crate::ID,
        )
    }
    pub fn create_pda(
        game_engine: &Address,
        owner: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                PLAYER_SEED,
                game_engine.as_ref(),
                owner.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
    pub fn validate_pda(account: &AccountView, player_data: &PlayerAccount) -> ProgramResult {
        let expected = Self::create_pda(
            &player_data.game_engine,
            &player_data.owner,
            player_data.bump,
        )?;
        if account.address() != &expected {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }

    // Name methods
    #[inline]
    pub fn get_name(&self) -> &[u8] {
        &self.name[..self.name_len as usize]
    }
    pub fn set_name_from_domain(&mut self, domain: &[u8], tld: &[u8]) -> bool {
        let total_len = domain.len() + tld.len();
        if total_len > 48 {
            return false;
        }
        self.name = [0u8; 48];
        self.name[..domain.len()].copy_from_slice(domain);
        self.name[domain.len()..total_len].copy_from_slice(tld);
        self.name_len = total_len as u8;
        true
    }
    pub fn set_default_name(&mut self, player_number: u64) {
        const PREFIX: &[u8] = b"Player #";
        let prefix_len = PREFIX.len();
        self.name = [0u8; 48];
        self.name[..prefix_len].copy_from_slice(PREFIX);
        let mut num = player_number;
        let mut digits = [0u8; 20];
        let mut digit_count = 0;
        if num == 0 {
            digits[0] = b'0';
            digit_count = 1;
        } else {
            while num > 0 {
                digits[digit_count] = b'0' + (num % 10) as u8;
                num /= 10;
                digit_count += 1;
            }
        }
        for i in 0..digit_count {
            self.name[prefix_len + i] = digits[digit_count - 1 - i];
        }
        self.name_len = (prefix_len + digit_count) as u8;
    }
    pub fn clear_name(&mut self) {
        self.name = [0u8; 48];
        self.name_len = 0;
    }
    pub fn has_custom_name(&self) -> bool {
        if self.name_len < 8 {
            return false;
        }
        &self.name[..8] != b"Player #"
    }
}

// HELPERS — size_for_extensions, resize, unlock

/// Calculate required account size for given extensions, following the unlock chain.
pub fn size_for_extensions(ext: u32) -> usize {
    if ext & EXT_COURT != 0 {
        COURT_OFFSET + COURT_SIZE
    } else if ext & EXT_COSMETICS != 0 {
        COSMETICS_OFFSET + COSMETICS_SIZE
    } else if ext & EXT_HEROES != 0 {
        HEROES_OFFSET + HEROES_SIZE
    } else if ext & EXT_RALLY != 0 {
        RALLY_OFFSET + RALLY_SIZE
    } else if ext & EXT_TEAM != 0 {
        TEAM_OFFSET + TEAM_SIZE
    } else if ext & EXT_INVENTORY != 0 {
        INVENTORY_OFFSET + INVENTORY_SIZE
    } else if ext & EXT_RESEARCH != 0 {
        RESEARCH_OFFSET + RESEARCH_SIZE
    } else {
        CORE_SIZE
    }
}

/// Resize a player account and transfer additional rent from payer.
pub fn resize_player_account(
    account: &AccountView,
    payer: &AccountView,
    new_size: usize,
) -> Result<(), ProgramError> {
    let current_size = account.data_len();
    if new_size <= current_size {
        return Ok(());
    }
    let rent = Rent::get()?;
    let current_lamports = account.lamports();
    let required_lamports = rent.try_minimum_balance(new_size)?;
    let lamports_needed = required_lamports.saturating_sub(current_lamports);
    if lamports_needed > 0 {
        pinocchio_system::instructions::Transfer {
            from: payer,
            to: account,
            lamports: lamports_needed,
        }
        .invoke()?;
    }
    account.resize(new_size)?;
    Ok(())
}

/// Initialize section bytes at the given offset using its `init()`.
unsafe fn write_section_init(data: &mut [u8], offset: usize, ext: u32) {
    match ext {
        EXT_RESEARCH => {
            *(data.as_mut_ptr().add(offset) as *mut ResearchSection) = ResearchSection::init()
        }
        EXT_INVENTORY => {
            *(data.as_mut_ptr().add(offset) as *mut InventorySection) = InventorySection::init()
        }
        EXT_TEAM => *(data.as_mut_ptr().add(offset) as *mut TeamSection) = TeamSection::init(),
        EXT_RALLY => *(data.as_mut_ptr().add(offset) as *mut RallySection) = RallySection::init(),
        EXT_HEROES => {
            *(data.as_mut_ptr().add(offset) as *mut HeroesSection) = HeroesSection::init()
        }
        EXT_COSMETICS => {
            *(data.as_mut_ptr().add(offset) as *mut CosmeticsSection) = CosmeticsSection::init()
        }
        EXT_COURT => *(data.as_mut_ptr().add(offset) as *mut CourtSection) = CourtSection::init(),
        _ => {}
    }
}

/// Unlock chain: returns prerequisite extension, if any.
pub fn prerequisite_for_extension(ext: u32) -> Option<u32> {
    match ext {
        EXT_RESEARCH => None,
        EXT_INVENTORY => Some(EXT_RESEARCH),
        EXT_TEAM => Some(EXT_INVENTORY),
        EXT_RALLY => Some(EXT_TEAM),
        EXT_HEROES => Some(EXT_RALLY),
        EXT_COSMETICS => Some(EXT_HEROES),
        EXT_COURT => Some(EXT_COSMETICS),
        _ => None,
    }
}

pub fn extension_prerequisite_error(ext: u32) -> crate::error::GameError {
    use crate::error::GameError;
    match ext {
        EXT_RESEARCH => GameError::ExtensionPrerequisiteNotMet,
        EXT_INVENTORY => GameError::ResearchNotUnlocked,
        EXT_TEAM => GameError::InventoryNotUnlocked,
        EXT_RALLY => GameError::TeamNotUnlocked,
        EXT_HEROES => GameError::RallyNotUnlocked,
        EXT_COSMETICS => GameError::HeroesNotUnlocked,
        EXT_COURT => GameError::CosmeticsNotUnlocked,
        _ => GameError::ExtensionPrerequisiteNotMet,
    }
}

/// Ensure an extension is unlocked, allocating it and any missing
/// prerequisite sections.
///
/// Sections are laid out contiguously, so a section's bytes cannot exist
/// unless every earlier section in the chain does. Rather than erroring when
/// a prerequisite is missing, this cascades down the chain and allocates the
/// (empty, zero-initialized) storage for everything before `ext` — so a
/// feature is never gated behind having *used* an earlier, unrelated feature.
/// Genuine gameplay gates stay explicit via `require_extension`.
///
/// Returns `true` if `ext` itself was newly unlocked, `false` if already set.
/// Caller must NOT hold any active borrows on `account` when calling.
pub fn unlock_extension_if_eligible(
    account: &AccountView,
    payer: &AccountView,
    ext: u32,
) -> Result<bool, ProgramError> {
    // Already unlocked — nothing to do.
    {
        let data = account.try_borrow()?;
        let player = unsafe { PlayerCore::load(&data) };
        if player.extensions & ext != 0 {
            return Ok(false);
        }
    }

    let offset = match ext {
        EXT_RESEARCH => RESEARCH_OFFSET,
        EXT_INVENTORY => INVENTORY_OFFSET,
        EXT_TEAM => TEAM_OFFSET,
        EXT_RALLY => RALLY_OFFSET,
        EXT_HEROES => HEROES_OFFSET,
        EXT_COSMETICS => COSMETICS_OFFSET,
        EXT_COURT => COURT_OFFSET,
        _ => return Err(crate::error::GameError::ExtensionPrerequisiteNotMet.into()),
    };

    // Cascade: allocate the prerequisite chain first so this section's bytes
    // sit on top of an already-allocated buffer.
    if let Some(prereq) = prerequisite_for_extension(ext) {
        unlock_extension_if_eligible(account, payer, prereq)?;
    }

    let new_extensions = {
        let data = account.try_borrow()?;
        unsafe { PlayerCore::load(&data) }.extensions | ext
    };
    resize_player_account(account, payer, size_for_extensions(new_extensions))?;

    {
        let mut data = account.try_borrow_mut()?;
        unsafe {
            write_section_init(&mut data, offset, ext);
        }
        let player = unsafe { PlayerCore::load_mut(&mut data) };
        player.extensions = new_extensions;
    }
    Ok(true)
}

/// Require that an extension is unlocked.
pub fn require_extension(player: &PlayerCore, ext: u32) -> Result<(), ProgramError> {
    if player.extensions & ext != 0 {
        Ok(())
    } else {
        Err(extension_prerequisite_error(ext).into())
    }
}

// USER ACCOUNT (unchanged)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct UserAccount {
    pub account_key: u8,
    pub owner: Address,
    pub player: Address,
    pub bump: u8,
    pub _padding1: [u8; 7],
    pub reserved_novi: u64,
    pub reserved_novi_earned_at: i64,
    pub total_events_participated: u64,
    pub total_events_won: u64,
    pub total_reserved_earned: u64,
    pub last_withdrawal: i64,
    pub novi_purchase_streak: u16,
    pub novi_last_purchase_day: u32,
    pub novi_purchased_today: u64,
    pub _padding2: [u8; 2],
}

impl UserAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn load_checked<'a>(
        account: &'a AccountView,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::User, "UserAccount")?
        };
        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }
        let expected_pda = Self::create_pda(expected_owner, loaded.bump)?;
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }
        Ok(loaded)
    }

    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(account, super::AccountKey::User, "UserAccount")?
        };
        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }
        let expected_pda = Self::create_pda(expected_owner, loaded.bump)?;
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }
        Ok(loaded)
    }

    /// Like `load_checked` but with no caller-provided owner assertion —
    /// validates program owner + discriminator + canonical PDA derived
    /// from the stored owner + bump. Use when the instruction is
    /// permissionless or signs against the on-account owner field directly.
    pub fn load_checked_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::User, "UserAccount")?
        };
        let expected_pda = Self::create_pda(&loaded.owner, loaded.bump)?;
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }
        Ok(loaded)
    }

    /// Mutable variant of `load_checked_by_key`.
    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(account, super::AccountKey::User, "UserAccount")?
        };
        let expected_pda = Self::create_pda(&loaded.owner, loaded.bump)?;
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }
        Ok(loaded)
    }

    pub fn init(owner: Address, player: Address, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::User as u8,
            owner,
            player,
            bump,
            _padding1: [0; 7],
            reserved_novi: 0,
            reserved_novi_earned_at: 0,
            total_events_participated: 0,
            total_events_won: 0,
            total_reserved_earned: 0,
            last_withdrawal: 0,
            novi_purchase_streak: 0,
            novi_last_purchase_day: 0,
            novi_purchased_today: 0,
            _padding2: [0; 2],
        }
    }

    pub fn derive_pda(owner: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[USER_SEED, owner.as_ref()], &crate::ID)
    }

    pub fn create_pda(owner: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[USER_SEED, owner.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    pub fn validate_pda(account: &AccountView, user_data: &UserAccount) -> ProgramResult {
        let expected = Self::create_pda(&user_data.owner, user_data.bump)?;
        if account.address() != &expected {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }
}

// COMPILE-TIME SIZE ASSERTIONS
const _: [(); CORE_SIZE] = [(); core::mem::size_of::<PlayerCore>()];
const _: [(); RESEARCH_SIZE] = [(); core::mem::size_of::<ResearchSection>()];
const _: [(); INVENTORY_SIZE] = [(); core::mem::size_of::<InventorySection>()];
const _: [(); TEAM_SIZE] = [(); core::mem::size_of::<TeamSection>()];
const _: [(); RALLY_SIZE] = [(); core::mem::size_of::<RallySection>()];
const _: [(); HEROES_SIZE] = [(); core::mem::size_of::<HeroesSection>()];
const _: [(); COSMETICS_SIZE] = [(); core::mem::size_of::<CosmeticsSection>()];
const _: [(); COURT_SIZE] = [(); core::mem::size_of::<CourtSection>()];

const _: () = assert!(RESEARCH_OFFSET == CORE_SIZE);
const _: () = assert!(INVENTORY_OFFSET == RESEARCH_OFFSET + RESEARCH_SIZE);
const _: () = assert!(TEAM_OFFSET == INVENTORY_OFFSET + INVENTORY_SIZE);
const _: () = assert!(RALLY_OFFSET == TEAM_OFFSET + TEAM_SIZE);
const _: () = assert!(HEROES_OFFSET == RALLY_OFFSET + RALLY_SIZE);
const _: () = assert!(COSMETICS_OFFSET == HEROES_OFFSET + HEROES_SIZE);
const _: () = assert!(COURT_OFFSET == COSMETICS_OFFSET + COSMETICS_SIZE);
const _: () = assert!(MAX_SIZE == COURT_OFFSET + COURT_SIZE);
