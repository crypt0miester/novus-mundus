use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        REINFORCEMENT_SEED, MAX_REINFORCEMENT_RECEIVE,
    },
    error::GameError,
    state::{
        PlayerAccount, GameEngine, CityAccount, ReinforcementAccount,
        ReinforcementStatus, ReinforcementTarget, BuffStat, NULL_PUBKEY,
        TeamAccount,
    },
    logic::location::calculate_intercity_travel_time,
    utils::{read_u8, read_u64},
    validation::{require_signer, require_writable, require_owner},
    helpers::nft_parser::{parse_nft_buffs, ParsedBuff},
    emit,
    events::reinforcement::ReinforcementSent,
};

/// Send defensive units, weapons, and optionally a hero to reinforce a teammate
///
/// Creates a ReinforcementAccount and deducts resources from sender.
/// Resources travel to destination and become active upon arrival (via process_arrival crank).
///
/// # Requirements
/// - Sender and destination must be on the same team
/// - Sender must have enough defensive units and weapons
/// - Destination must have capacity for more reinforcements
/// - If hero is provided, it must not be locked elsewhere
///
/// # Accounts
/// 0. `[SIGNER, WRITE]` sender_owner: Sender's wallet (pays rent)
/// 1. `[WRITE]` sender_player: Sender's PlayerAccount PDA
/// 2. `[WRITE]` destination_player: Destination's PlayerAccount PDA
/// 3. `[WRITE]` reinforcement_account: ReinforcementAccount PDA (to be created)
/// 4. `[]` sender_city: CityAccount for sender's city
/// 5. `[]` destination_city: CityAccount for destination's city
/// 6. `[]` game_engine: GameEngine PDA (for theme speed)
/// 7. `[]` system_program: System program
/// 8. `[]` team_account: TeamAccount PDA (for disbanded check)
/// 9. `[]` hero_nft: (OPTIONAL) Hero NFT account - required if hero_slot < 3
///
/// # Instruction Data (57 bytes minimum)
/// - units_def_1: u64 (8 bytes)
/// - units_def_2: u64 (8 bytes)
/// - units_def_3: u64 (8 bytes)
/// - melee_weapons: u64 (8 bytes)
/// - ranged_weapons: u64 (8 bytes)
/// - siege_weapons: u64 (8 bytes)
/// - hero_slot: u8 (1 byte) - 0-2 = send hero from that slot, 255 = no hero
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (9 required, 1 optional for hero)
    crate::extract_accounts!(accounts, [
        sender_owner,
        sender_player,
        destination_player,
        reinforcement_account,
        sender_city,
        destination_city,
        game_engine,
        system_program,
        team_account,
    ]);
    let hero_nft = accounts.get(9); // Optional 10th account

    // 2. Validate Accounts
    require_signer(sender_owner)?;
    require_writable(sender_owner)?;
    require_writable(sender_player)?;
    require_writable(destination_player)?;
    require_writable(reinforcement_account)?;
    require_owner(sender_player, program_id)?;
    require_owner(destination_player, program_id)?;

    if system_program.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // 3. Parse Instruction Data (57 bytes minimum)
    let units_def_1 = read_u64(instruction_data, 0, "units_def_1")?;
    let units_def_2 = read_u64(instruction_data, 8, "units_def_2")?;
    let units_def_3 = read_u64(instruction_data, 16, "units_def_3")?;
    let melee_weapons = read_u64(instruction_data, 24, "melee_weapons")?;
    let ranged_weapons = read_u64(instruction_data, 32, "ranged_weapons")?;
    let siege_weapons = read_u64(instruction_data, 40, "siege_weapons")?;
    let hero_slot = read_u8(instruction_data, 48, "hero_slot")?;
    let team_id = read_u64(instruction_data, 49, "team_id")?;

    // Calculate totals
    let total_units = units_def_1
        .saturating_add(units_def_2)
        .saturating_add(units_def_3);
    let total_weapons = melee_weapons
        .saturating_add(ranged_weapons)
        .saturating_add(siege_weapons);

    if total_units == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // Validate weapon ratio: can't send more weapons than units
    if total_weapons > total_units {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load Sender Player
    let mut sender_data_ref = sender_player.try_borrow_mut()?;
    let sender = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    // Verify sender ownership
    if &sender.owner != sender_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Sender cannot be traveling
    if sender.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 6. Load Destination Player
    let mut dest_data_ref = destination_player.try_borrow_mut()?;
    let destination = unsafe { PlayerAccount::load_mut(&mut dest_data_ref) };

    // 7. Validate Same Team
    if sender.team_address() == NULL_PUBKEY || destination.team_address() == NULL_PUBKEY {
        return Err(GameError::NotOnSameTeam.into());
    }
    if sender.team_address() != destination.team_address() {
        return Err(GameError::NotOnSameTeam.into());
    }

    // Verify team account matches
    if team_account.address() != &sender.team_address() {
        return Err(GameError::InvalidTeam.into());
    }

    // 7a. Load team and check disbanded (kingdom-scoped)
    let team = TeamAccount::load_checked(team_account, game_engine.address(), team_id, program_id)?;
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Cannot reinforce self
    if sender_owner.address() == &destination.owner {
        return Err(GameError::CannotTransferToSelf.into());
    }

    // 8. Validate Sender Has Enough Units
    if sender.defensive_unit_1 < units_def_1 {
        return Err(GameError::InsufficientUnits.into());
    }
    if sender.defensive_unit_2 < units_def_2 {
        return Err(GameError::InsufficientUnits.into());
    }
    if sender.defensive_unit_3 < units_def_3 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 9. Validate Sender Has Enough Weapons
    if sender.melee_weapons < melee_weapons {
        return Err(GameError::InsufficientWeapons.into());
    }
    if sender.ranged_weapons < ranged_weapons {
        return Err(GameError::InsufficientWeapons.into());
    }
    if sender.siege_weapons < siege_weapons {
        return Err(GameError::InsufficientWeapons.into());
    }

    // 10. Validate Destination Has Capacity
    // Current total + new reinforcements must not exceed capacity
    let current_reinforcement_total = destination.total_reinforcement_units();
    let base_capacity = MAX_REINFORCEMENT_RECEIVE;
    let boosted_capacity = if destination.hero_unit_capacity_bps() > 0 {
        let multiplier = 10000u64 + destination.hero_unit_capacity_bps() as u64;
        base_capacity.saturating_mul(multiplier) / 10000
    } else {
        base_capacity
    };

    if current_reinforcement_total.saturating_add(total_units) > boosted_capacity {
        return Err(GameError::ReceiverCapacityFull.into());
    }

    // 11. Handle Hero (if provided)
    let (hero_pubkey, hero_defense_bps, hero_weapon_eff_bps, hero_armor_eff_bps) =
        if hero_slot < 3 {
            let hero_slot_idx = hero_slot as usize;
            let hero_key = sender.active_hero_at(hero_slot_idx as usize);

            // Verify hero is assigned
            if hero_key == Address::default() {
                return Err(GameError::HeroNotInSlot.into());
            }

            // Verify hero is not already in meditation
            if sender.meditating_hero_slot() == hero_slot {
                return Err(GameError::HeroAlreadyMeditating.into());
            }

            // Require hero_nft account when sending a hero
            let nft_account = hero_nft.ok_or(ProgramError::NotEnoughAccountKeys)?;

            // Verify NFT account matches the hero key in active_heroes
            if nft_account.address() != &hero_key {
                return Err(GameError::HeroMismatch.into());
            }

            // Parse buffs directly from the NFT
            let nft_data = nft_account.try_borrow()?;
            let mut buffs = [ParsedBuff::default(); 4];
            let buff_count = parse_nft_buffs(&nft_data, &mut buffs);

            // Extract the specific buffs we need for reinforcement
            let mut defense_bps: u16 = 0;
            let mut weapon_eff_bps: u16 = 0;
            let mut armor_eff_bps: u16 = 0;

            for i in 0..buff_count {
                match BuffStat::from_u8(buffs[i].stat) {
                    BuffStat::DefensePower => defense_bps = buffs[i].value,
                    BuffStat::WeaponEfficiency => weapon_eff_bps = buffs[i].value,
                    BuffStat::ArmorEfficiency => armor_eff_bps = buffs[i].value,
                    _ => {}
                }
            }

            (hero_key, defense_bps, weapon_eff_bps, armor_eff_bps)
        } else {
            // No hero
            (Address::default(), 0, 0, 0)
        };

    // 12. Load City Data for Travel Calculation
    // H-03: Verify city accounts are owned by this program and match expected PDAs.
    require_owner(sender_city, program_id)?;
    require_owner(destination_city, program_id)?;
    let (expected_sender_city_pda, _) =
        CityAccount::derive_pda(game_engine.address(), sender.current_city);
    if sender_city.address() != &expected_sender_city_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_dest_city_pda, _) =
        CityAccount::derive_pda(game_engine.address(), destination.current_city);
    if destination_city.address() != &expected_dest_city_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let sender_city_data = unsafe { CityAccount::load(sender_city)? };
    let dest_city_data = unsafe { CityAccount::load(destination_city)? };

    // Validate cities match player locations
    if sender_city_data.city_id != sender.current_city {
        return Err(GameError::WrongCity.into());
    }
    if dest_city_data.city_id != destination.current_city {
        return Err(GameError::WrongCity.into());
    }

    // Store values for later (including names for event emission)
    let sender_city_id = sender.current_city;
    let dest_city_id = destination.current_city;
    let dest_owner = destination.owner;
    let sender_name = sender.name;
    let receiver_name = destination.name;

    // 13. Calculate Travel Time
    let game_engine_data_ref = game_engine.try_borrow()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data_ref) };

    let travel_duration = if sender_city_id == dest_city_id {
        // Same city - instant arrival
        0i32
    } else {
        // Different cities - intercity travel at theme speed
        let current_theme = game_engine_state.theme_config.current_theme as usize;
        let theme_speed = game_engine_state.gameplay_config.theme_travel_speeds_kmh[current_theme];
        calculate_intercity_travel_time(
            sender_city_data.latitude,
            sender_city_data.longitude,
            dest_city_data.latitude,
            dest_city_data.longitude,
            theme_speed,
        ) as i32
    };

    let arrives_at = now + travel_duration as i64;

    // 14. Verify and Create ReinforcementAccount PDA (kingdom-scoped)
    let (expected_pda, bump) = ReinforcementAccount::derive_player_pda(
        game_engine.address(),
        sender_owner.address(),
        &dest_owner,
    );

    if reinforcement_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Check if already exists
    if !reinforcement_account.is_data_empty() {
        return Err(GameError::ReinforcementAlreadyExists.into());
    }

    // 15. Deduct Resources from Sender
    sender.defensive_unit_1 = sender.defensive_unit_1.saturating_sub(units_def_1);
    sender.defensive_unit_2 = sender.defensive_unit_2.saturating_sub(units_def_2);
    sender.defensive_unit_3 = sender.defensive_unit_3.saturating_sub(units_def_3);
    sender.melee_weapons = sender.melee_weapons.saturating_sub(melee_weapons);
    sender.ranged_weapons = sender.ranged_weapons.saturating_sub(ranged_weapons);
    sender.siege_weapons = sender.siege_weapons.saturating_sub(siege_weapons);

    // Lock hero if provided (clear from active slot)
    if hero_slot < 3 {
        sender.set_active_hero_at(hero_slot as usize, Address::default());
    }

    // Drop borrows before CPI
    drop(sender_data_ref);
    drop(dest_data_ref);
    drop(game_engine_data_ref);

    // 16. Create Reinforcement Account
    let lamports = crate::utils::rent_exempt_const(ReinforcementAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(
        REINFORCEMENT_SEED,
        game_engine.address(),
        sender_owner.address(),
        dest_owner.as_ref(),
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: sender_owner,
        to: reinforcement_account,
        lamports,
        space: ReinforcementAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 17. Initialize Reinforcement Account
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // Kingdom reference
    reinf.account_key = crate::state::AccountKey::Reinforcement as u8;
    reinf.game_engine = *game_engine.address();

    // Identity
    reinf.sender = *sender_owner.address();
    reinf.destination = dest_owner;

    // Type & Location
    reinf.destination_type = ReinforcementTarget::Player as u8;
    reinf.bump = bump;
    reinf.sender_city = sender_city_id;
    reinf.destination_city = dest_city_id;
    reinf._padding_loc = [0; 2];

    // Units
    reinf.units_def_1 = units_def_1;
    reinf.units_def_2 = units_def_2;
    reinf.units_def_3 = units_def_3;

    // Weapons
    reinf.melee_weapons = melee_weapons;
    reinf.ranged_weapons = ranged_weapons;
    reinf.siege_weapons = siege_weapons;

    // Hero
    reinf.hero = hero_pubkey;
    reinf.hero_defense_bps = hero_defense_bps;
    reinf.hero_weapon_eff_bps = hero_weapon_eff_bps;
    reinf.hero_armor_eff_bps = hero_armor_eff_bps;
    reinf._padding_hero = [0; 2];

    // Travel timing
    reinf.sent_at = now;
    reinf.travel_duration = travel_duration;
    reinf.wounded_def_1 = 0;
    reinf.arrives_at = arrives_at;

    // Return timing
    reinf.return_started_at = 0;
    reinf.return_duration = 0;
    reinf.wounded_def_2 = 0;

    // Status - Traveling (process_arrival will mark Active)
    reinf.status = ReinforcementStatus::Traveling as u8;
    reinf.relieved_by_destination = false;
    reinf._padding_status = [0; 2];
    reinf.wounded_def_3 = 0;

    // Stats
    reinf.combats_participated = 0;

    // Emit event
    emit!(ReinforcementSent {
        sender: *sender_owner.address(),
        sender_name,
        receiver: dest_owner,
        receiver_name,
        units: [units_def_1, units_def_2, units_def_3],
        arrives_at,
        timestamp: now,
    });

    Ok(())
}
