#![no_std]

// Program modules
#[macro_use]
mod macros;
mod constants;
mod error;
pub mod events;
mod helpers;
mod logic;
mod processor;
mod state;
mod token_helpers;
mod types;
mod utils;
mod validation;

// Re-exports
pub use constants::*;
pub use error::*;
pub use state::*;
pub use types::*;

use pinocchio::{
    error::ProgramError, no_allocator, program_entrypoint, AccountView, Address, ProgramResult,
};

// Program ID — single source of truth. `constants::NOVI_MINT_PDA` derives
// from `crate::ID.to_bytes()` so a redeploy under a new key only needs
// this string updated.
pinocchio::address::declare_id!("6kFKaG8DEMC5mVMi4VbD3AYxxmz2gQc3o2fuW4q4rYNk");

program_entrypoint!(process_instruction);
no_allocator!();

// Manual panic handler. Pinocchio's `nostd_panic_handler!()` macro emits
// `#[no_mangle]` on the handler, which current rustc rejects for language
// items. So we inline an equivalent here.
#[cfg(target_os = "solana")]
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    if let Some(location) = info.location() {
        unsafe {
            pinocchio::syscalls::sol_panic_(
                location.file().as_ptr(),
                location.file().len() as u64,
                location.line() as u64,
                location.column() as u64,
            )
        }
    } else {
        unsafe { pinocchio::syscalls::abort() }
    }
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Verify program ID
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // First 2 bytes are instruction discriminant (little-endian)
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let discriminant = u16::from_le_bytes([data[0], data[1]]);
    let instruction_data = &data[2..];

    // Dispatch to processor
    match discriminant {
        // Initialization (0-9)
        0 => {
            msg!("init game engine");
            processor::initialization::game_engine::process(program_id, accounts, instruction_data)
        }
        1 => {
            msg!("init player");
            processor::initialization::player::process(program_id, accounts, instruction_data)
        }
        2 => {
            msg!("init user");
            processor::initialization::user::process(program_id, accounts, instruction_data)
        }
        3 => {
            msg!("init city");
            processor::initialization::city::process(program_id, accounts, instruction_data)
        }
        4 => {
            msg!("close registration");
            processor::initialization::close_registration::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        5 => {
            msg!("batch init cities");
            processor::initialization::batch_cities::process(program_id, accounts, instruction_data)
        }
        6 => {
            msg!("update game config");
            processor::initialization::update_game_config::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        7 => {
            msg!("set terrain");
            processor::initialization::set_terrain::process(program_id, accounts, instruction_data)
        }
        8 => {
            msg!("append terrain");
            processor::initialization::append_terrain::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Economy (10-19)
        10 => {
            msg!("update locked novi");
            processor::economy::update_locked_novi::process(program_id, accounts, instruction_data)
        }
        11 => {
            msg!("hire units");
            processor::economy::hire_units::process(program_id, accounts, instruction_data)
        }
        12 => {
            msg!("collect resources");
            processor::economy::collect_resources::process(program_id, accounts, instruction_data)
        }
        13 => {
            msg!("purchase equipment");
            processor::economy::purchase_equipment::process(program_id, accounts, instruction_data)
        }
        14 => {
            msg!("mint for prize");
            processor::economy::mint_for_prize::process(program_id, accounts, instruction_data)
        }
        17 => {
            msg!("purchase stamina");
            processor::economy::purchase_stamina::process(program_id, accounts, instruction_data)
        }
        18 => {
            msg!("transfer cash");
            processor::economy::transfer_cash::process(program_id, accounts, instruction_data)
        }
        19 => {
            msg!("vault transfer");
            processor::economy::vault_transfer::process(program_id, accounts, instruction_data)
        }

        // Token Operations (15-19)
        15 => {
            msg!("reserved to locked");
            processor::token::reserved_to_locked::process(program_id, accounts, instruction_data)
        }
        16 => {
            msg!("withdraw reserved");
            processor::token::withdraw_reserved::process(program_id, accounts, instruction_data)
        }

        // Combat (20-29)
        20 => {
            msg!("attack player");
            processor::combat::attack_player::process(program_id, accounts, instruction_data)
        }
        21 => {
            msg!("attack encounter");
            processor::combat::attack_encounter::process(program_id, accounts, instruction_data)
        }

        // Travel - Intercity (30-39)
        30 => {
            msg!("start intercity travel");
            processor::travel::intercity_start::process(program_id, accounts, instruction_data)
        }
        31 => {
            msg!("complete intercity travel");
            processor::travel::intercity_complete::process(program_id, accounts, instruction_data)
        }
        32 => {
            msg!("cancel intercity travel");
            processor::travel::intercity_cancel::process(program_id, accounts, instruction_data)
        }
        33 => {
            msg!("intercity teleport");
            processor::travel::intercity_teleport::process(program_id, accounts, instruction_data)
        }
        34 => {
            msg!("speedup travel");
            processor::travel::speedup::process(program_id, accounts, instruction_data)
        }

        // Travel - Intracity (40-49)
        40 => {
            msg!("start intracity travel");
            processor::travel::intracity_start::process(program_id, accounts, instruction_data)
        }
        41 => {
            msg!("complete intracity travel");
            processor::travel::intracity_complete::process(program_id, accounts, instruction_data)
        }
        42 => {
            msg!("cancel intracity travel");
            processor::travel::intracity_cancel::process(program_id, accounts, instruction_data)
        }

        // Team System (50-59)
        50 => {
            msg!("create team");
            processor::team::create::process(program_id, accounts, instruction_data)
        }
        51 => {
            msg!("join team");
            processor::team::join::process(program_id, accounts, instruction_data)
        }
        52 => {
            msg!("leave team");
            processor::team::leave::process(program_id, accounts, instruction_data)
        }
        53 => {
            msg!("deposit treasury");
            processor::team::deposit_treasury::process(program_id, accounts, instruction_data)
        }
        54 => {
            msg!("invite to team");
            processor::team::invite::process(program_id, accounts, instruction_data)
        }
        55 => {
            msg!("accept team invite");
            processor::team::accept_invite::process(program_id, accounts, instruction_data)
        }
        56 => {
            msg!("transfer leadership");
            processor::team::transfer_leadership::process(program_id, accounts, instruction_data)
        }
        57 => {
            msg!("kick member");
            processor::team::kick_member::process(program_id, accounts, instruction_data)
        }
        58 => {
            msg!("disband team");
            processor::team::disband::process(program_id, accounts, instruction_data)
        }
        59 => {
            msg!("withdraw treasury");
            processor::team::withdraw_treasury::process(program_id, accounts, instruction_data)
        }

        // Rally System (60-69)
        60 => {
            msg!("create rally");
            processor::rally::create::process(program_id, accounts, instruction_data)
        }
        61 => {
            msg!("join rally");
            processor::rally::join::process(program_id, accounts, instruction_data)
        }
        62 => {
            msg!("execute rally");
            processor::rally::execute::process(program_id, accounts, instruction_data)
        }
        63 => {
            msg!("leave rally");
            processor::rally::leave::process(program_id, accounts, instruction_data)
        }
        64 => {
            msg!("cancel rally");
            processor::rally::cancel::process(program_id, accounts, instruction_data)
        }
        65 => {
            msg!("process rally return");
            processor::rally::process_return::process(program_id, accounts, instruction_data)
        }
        66 => {
            msg!("speedup rally");
            processor::rally::speedup::process(program_id, accounts, instruction_data)
        }
        67 => {
            msg!("close rally");
            processor::rally::close_rally::process(program_id, accounts, instruction_data)
        }

        // Encounter Management (70-79)
        70 => {
            msg!("spawn encounter");
            processor::encounter::spawn::process(program_id, accounts, instruction_data)
        }
        71 => {
            msg!("claim loot");
            processor::loot::claim::process(program_id, accounts, instruction_data)
        }
        72 => {
            msg!("cleanup encounter");
            processor::encounter::cleanup::process(program_id, accounts, instruction_data)
        }

        // Event System (80-89)
        80 => {
            msg!("create event");
            processor::event::create::process(program_id, accounts, instruction_data)
        }
        81 => {
            msg!("join event");
            processor::event::join::process(program_id, accounts, instruction_data)
        }
        82 => {
            msg!("finalize event");
            processor::event::finalize::process(program_id, accounts, instruction_data)
        }
        83 => {
            msg!("claim event prize");
            processor::event::claim_prize::process(program_id, accounts, instruction_data)
        }

        // Progression System (90-99)
        90 => {
            msg!("claim daily reward");
            processor::progression::claim_daily_reward::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Subscription System (100-109)
        100 => {
            msg!("purchase subscription");
            processor::subscription::purchase::process(program_id, accounts, instruction_data)
        }
        101 => {
            msg!("update subscription tier");
            processor::subscription::update_tier::process(program_id, accounts, instruction_data)
        }
        102 => {
            msg!("downgrade expired sub");
            processor::subscription::downgrade_expired::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Name System (110-119)
        110 => {
            msg!("set player name");
            processor::name::set_player::process(program_id, accounts, instruction_data)
        }
        111 => {
            msg!("set team name");
            processor::name::set_team::process(program_id, accounts, instruction_data)
        }
        112 => {
            msg!("remove player name");
            processor::name::remove_player::process(program_id, accounts, instruction_data)
        }
        113 => {
            msg!("remove team name");
            processor::name::remove_team::process(program_id, accounts, instruction_data)
        }
        114 => {
            msg!("update player name");
            processor::name::update_player::process(program_id, accounts, instruction_data)
        }
        115 => {
            msg!("update team name");
            processor::name::update_team::process(program_id, accounts, instruction_data)
        }

        // Research System (120-129)
        120 => {
            msg!("init research template");
            processor::research::initialize_template::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        121 => {
            msg!("create research progress");
            processor::research::create_progress::process(program_id, accounts, instruction_data)
        }
        122 => {
            msg!("start research");
            processor::research::start_research::process(program_id, accounts, instruction_data)
        }
        123 => {
            msg!("complete research");
            processor::research::complete_research::process(program_id, accounts, instruction_data)
        }
        124 => {
            msg!("speedup research");
            processor::research::speed_up_research::process(program_id, accounts, instruction_data)
        }
        125 => {
            msg!("cancel research");
            processor::research::cancel_research::process(program_id, accounts, instruction_data)
        }
        126 => {
            msg!("update research template");
            processor::research::update_template::process(program_id, accounts, instruction_data)
        }
        127 => {
            msg!("ascend research");
            processor::research::ascend::process(program_id, accounts, instruction_data)
        }

        // Hero System (130-136)
        130 => {
            msg!("create hero template");
            processor::hero::create_template::process(program_id, accounts, instruction_data)
        }
        131 => {
            msg!("mint hero");
            processor::hero::mint::process(program_id, accounts, instruction_data)
        }
        132 => {
            msg!("lock hero");
            processor::hero::lock::process(program_id, accounts, instruction_data)
        }
        133 => {
            msg!("unlock hero");
            processor::hero::unlock::process(program_id, accounts, instruction_data)
        }
        134 => {
            msg!("level up hero");
            processor::hero::level_up::process(program_id, accounts, instruction_data)
        }
        135 => {
            msg!("assign defensive hero");
            processor::hero::assign_defensive::process(program_id, accounts, instruction_data)
        }
        136 => {
            msg!("create hero collection");
            processor::hero::create_collection::process(program_id, accounts, instruction_data)
        }

        // Sanctuary Meditation (137-139)
        137 => {
            msg!("start meditation");
            processor::sanctuary::start_meditation::process(program_id, accounts, instruction_data)
        }
        138 => {
            msg!("claim meditation");
            processor::sanctuary::claim_meditation::process(program_id, accounts, instruction_data)
        }
        139 => {
            msg!("speedup meditation");
            processor::sanctuary::speedup_meditation::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Shop System (140-159)
        140 => {
            msg!("init shop config");
            processor::shop::initialize_config::process(program_id, accounts, instruction_data)
        }
        141 => {
            msg!("create shop item");
            processor::shop::create_item::process(program_id, accounts, instruction_data)
        }
        142 => {
            msg!("create bundle");
            processor::shop::create_bundle::process(program_id, accounts, instruction_data)
        }
        143 => {
            msg!("purchase item");
            processor::shop::purchase_item::process(program_id, accounts, instruction_data)
        }
        144 => {
            msg!("purchase bundle");
            processor::shop::purchase_bundle::process(program_id, accounts, instruction_data)
        }
        145 => {
            msg!("create flash sale");
            processor::shop::create_flash_sale::process(program_id, accounts, instruction_data)
        }
        146 => {
            msg!("purchase flash sale");
            processor::shop::purchase_flash_sale::process(program_id, accounts, instruction_data)
        }
        147 => {
            msg!("close sale");
            processor::shop::close_sale::process(program_id, accounts, instruction_data)
        }
        148 => {
            msg!("create daily deal");
            processor::shop::create_daily_deal::process(program_id, accounts, instruction_data)
        }
        149 => {
            msg!("rotate daily deal");
            processor::shop::rotate_daily_deal::process(program_id, accounts, instruction_data)
        }
        150 => {
            msg!("create weekly sale");
            processor::shop::create_weekly_sale::process(program_id, accounts, instruction_data)
        }
        151 => {
            msg!("update shop item");
            processor::shop::update_item::process(program_id, accounts, instruction_data)
        }
        152 => {
            msg!("create seasonal sale");
            processor::shop::create_seasonal_sale::process(program_id, accounts, instruction_data)
        }
        153 => {
            msg!("create dao promotion");
            processor::shop::create_dao_promotion::process(program_id, accounts, instruction_data)
        }
        154 => {
            msg!("update bundle");
            processor::shop::update_bundle::process(program_id, accounts, instruction_data)
        }
        155 => {
            msg!("update shop config");
            processor::shop::update_config::process(program_id, accounts, instruction_data)
        }
        156 => {
            msg!("activate sale");
            processor::shop::activate_sale::process(program_id, accounts, instruction_data)
        }
        157 => {
            msg!("create allowed token");
            processor::shop::create_allowed_token::process(program_id, accounts, instruction_data)
        }
        158 => {
            msg!("update allowed token");
            processor::shop::update_allowed_token::process(program_id, accounts, instruction_data)
        }
        159 => {
            msg!("close allowed token");
            processor::shop::close_allowed_token::process(program_id, accounts, instruction_data)
        }

        // Estate System (160-179)
        160 => {
            msg!("create estate");
            processor::estate::create::process(program_id, accounts, instruction_data)
        }
        161 => {
            msg!("build on estate");
            processor::estate::build::process(program_id, accounts, instruction_data)
        }
        162 => {
            msg!("upgrade building");
            processor::estate::upgrade::process(program_id, accounts, instruction_data)
        }
        163 => {
            msg!("complete building");
            processor::estate::complete::process(program_id, accounts, instruction_data)
        }
        164 => {
            msg!("buy plot");
            processor::estate::buy_plot::process(program_id, accounts, instruction_data)
        }
        165 => {
            msg!("estate daily claim");
            processor::estate::daily_claim::process(program_id, accounts, instruction_data)
        }
        166 => {
            msg!("estate daily activity");
            processor::estate::daily_activity::process(program_id, accounts, instruction_data)
        }
        167 => {
            msg!("convert materials");
            processor::estate::convert_materials::process(program_id, accounts, instruction_data)
        }
        168 => {
            msg!("speedup estate");
            processor::estate::speedup::process(program_id, accounts, instruction_data)
        }
        169 => {
            msg!("recover troops");
            processor::estate::recover_troops::process(program_id, accounts, instruction_data)
        }
        170 => {
            msg!("init building template");
            processor::estate::initialize_building_template::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        171 => {
            msg!("update building template");
            processor::estate::update_building_template::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Forge System (180-189) - Staged Tempering
        180 => {
            msg!("init forge");
            processor::forge::initialize::process(program_id, accounts, instruction_data)
        }
        181 => {
            msg!("start craft");
            processor::forge::start_craft::process(program_id, accounts, instruction_data)
        }
        182 => {
            msg!("forge strike");
            processor::forge::strike::process(program_id, accounts, instruction_data)
        }
        183 => {
            msg!("abandon craft");
            processor::forge::abandon_craft::process(program_id, accounts, instruction_data)
        }
        184 => {
            msg!("equip forged item");
            processor::forge::equip::process(program_id, accounts, instruction_data)
        }

        // Reinforcement System (190-199)
        190 => {
            msg!("send reinforcement");
            processor::reinforcement::send::process(program_id, accounts, instruction_data)
        }
        191 => {
            msg!("process reinforcement arrival");
            processor::reinforcement::process_arrival::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        192 => {
            msg!("recall reinforcement");
            processor::reinforcement::recall::process(program_id, accounts, instruction_data)
        }
        193 => {
            msg!("relieve reinforcement");
            processor::reinforcement::relieve::process(program_id, accounts, instruction_data)
        }
        194 => {
            msg!("process reinforcement return");
            processor::reinforcement::process_return::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        195 => {
            msg!("speedup reinforcement");
            processor::reinforcement::speedup::process(program_id, accounts, instruction_data)
        }

        // Expedition System (200-209) - Mining/Fishing
        200 => {
            msg!("start expedition");
            processor::expedition::start::process(program_id, accounts, instruction_data)
        }
        201 => {
            msg!("expedition strike");
            processor::expedition::strike::process(program_id, accounts, instruction_data)
        }
        202 => {
            msg!("claim expedition");
            processor::expedition::claim::process(program_id, accounts, instruction_data)
        }
        203 => {
            msg!("abort expedition");
            processor::expedition::abort::process(program_id, accounts, instruction_data)
        }
        204 => {
            msg!("speedup expedition");
            processor::expedition::speedup::process(program_id, accounts, instruction_data)
        }

        // Team System Extended (210-229)
        210 => {
            msg!("cancel team invite");
            processor::team::cancel_invite::process(program_id, accounts, instruction_data)
        }
        211 => {
            msg!("decline team invite");
            processor::team::decline_invite::process(program_id, accounts, instruction_data)
        }
        212 => {
            msg!("set team motd");
            processor::team::set_motd::process(program_id, accounts, instruction_data)
        }
        213 => {
            msg!("update team settings");
            processor::team::update_settings::process(program_id, accounts, instruction_data)
        }
        214 => {
            msg!("request treasury withdraw");
            processor::team::treasury_request_withdraw::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        215 => {
            msg!("approve treasury request");
            processor::team::treasury_approve_request::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        216 => {
            msg!("reject treasury request");
            processor::team::treasury_reject_request::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        217 => {
            msg!("execute treasury request");
            processor::team::treasury_execute_request::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        218 => {
            msg!("cancel treasury request");
            processor::team::treasury_cancel_request::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        219 => {
            msg!("update treasury settings");
            processor::team::update_treasury_settings::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        220 => {
            msg!("promote member");
            processor::team::promote_member::process(program_id, accounts, instruction_data)
        }
        221 => {
            msg!("demote member");
            processor::team::demote_member::process(program_id, accounts, instruction_data)
        }

        // Arena PvP System (230-236)
        230 => {
            msg!("create arena season");
            processor::arena::create_season::process(program_id, accounts, instruction_data)
        }
        231 => {
            msg!("join arena season");
            processor::arena::join_season::process(program_id, accounts, instruction_data)
        }
        232 => {
            msg!("update arena loadout");
            processor::arena::update_loadout::process(program_id, accounts, instruction_data)
        }
        233 => {
            msg!("challenge arena player");
            processor::arena::challenge_player::process(program_id, accounts, instruction_data)
        }
        234 => {
            msg!("claim arena daily reward");
            processor::arena::claim_daily_reward::process(program_id, accounts, instruction_data)
        }
        235 => {
            msg!("claim arena master reward");
            processor::arena::claim_master_reward::process(program_id, accounts, instruction_data)
        }
        236 => {
            msg!("close arena season");
            processor::arena::close_season::process(program_id, accounts, instruction_data)
        }

        // Dungeon System (250-269) - The Catacombs roguelike PvE
        250 => {
            msg!("enter dungeon");
            processor::dungeon::enter::process(program_id, accounts, instruction_data)
        }
        251 => {
            msg!("dungeon attack");
            processor::dungeon::attack::process(program_id, accounts, instruction_data)
        }
        252 => {
            msg!("dungeon attack multi");
            processor::dungeon::attack_multi::process(program_id, accounts, instruction_data)
        }
        253 => {
            msg!("dungeon interact");
            processor::dungeon::interact::process(program_id, accounts, instruction_data)
        }
        254 => {
            msg!("choose dungeon relic");
            processor::dungeon::choose_relic::process(program_id, accounts, instruction_data)
        }
        255 => {
            msg!("flee dungeon");
            processor::dungeon::flee::process(program_id, accounts, instruction_data)
        }
        256 => {
            msg!("claim dungeon rewards");
            processor::dungeon::claim::process(program_id, accounts, instruction_data)
        }
        257 => {
            msg!("resume dungeon");
            processor::dungeon::resume::process(program_id, accounts, instruction_data)
        }
        258 => {
            msg!("create dungeon template");
            processor::dungeon::create_template::process(program_id, accounts, instruction_data)
        }
        259 => {
            msg!("claim dungeon leaderboard");
            processor::dungeon::claim_leaderboard_prize::process(
                program_id,
                accounts,
                instruction_data,
            )
        }
        260 => {
            msg!("create dungeon leaderboard");
            processor::dungeon::create_leaderboard::process(program_id, accounts, instruction_data)
        }

        // King's Castle System (270-299)
        270 => {
            msg!("create castle");
            processor::castle::create_castle::process(program_id, accounts, instruction_data)
        }
        271 => {
            msg!("claim vacant castle");
            processor::castle::claim_vacant_castle::process(program_id, accounts, instruction_data)
        }
        272 => {
            msg!("appoint court member");
            processor::castle::appoint_court::process(program_id, accounts, instruction_data)
        }
        273 => {
            msg!("dismiss court member");
            processor::castle::dismiss_court::process(program_id, accounts, instruction_data)
        }
        274 => {
            msg!("resign from court");
            processor::castle::resign_court::process(program_id, accounts, instruction_data)
        }
        275 => {
            msg!("initiate castle upgrade");
            processor::castle::initiate_upgrade::process(program_id, accounts, instruction_data)
        }
        276 => {
            msg!("cancel castle upgrade");
            processor::castle::cancel_upgrade::process(program_id, accounts, instruction_data)
        }
        277 => {
            msg!("join garrison");
            processor::castle::join_garrison::process(program_id, accounts, instruction_data)
        }
        278 => {
            msg!("leave garrison");
            processor::castle::leave_garrison::process(program_id, accounts, instruction_data)
        }
        279 => {
            msg!("relieve garrison");
            processor::castle::relieve_garrison::process(program_id, accounts, instruction_data)
        }
        280 => {
            msg!("claim castle rewards");
            processor::castle::claim_castle_rewards::process(program_id, accounts, instruction_data)
        }
        281 => {
            msg!("claim garrison loot");
            processor::castle::claim_garrison_loot::process(program_id, accounts, instruction_data)
        }
        282 => {
            msg!("garrison cleanup");
            processor::castle::garrison_cleanup::process(program_id, accounts, instruction_data)
        }
        283 => {
            msg!("court cleanup");
            processor::castle::court_cleanup::process(program_id, accounts, instruction_data)
        }
        284 => {
            msg!("rewards cleanup");
            processor::castle::rewards_cleanup::process(program_id, accounts, instruction_data)
        }
        285 => {
            msg!("finalize castle transition");
            processor::castle::finalize_transition::process(program_id, accounts, instruction_data)
        }
        286 => {
            msg!("update castle config");
            processor::castle::update_castle_config::process(program_id, accounts, instruction_data)
        }
        287 => {
            msg!("force remove king");
            processor::castle::force_remove_king::process(program_id, accounts, instruction_data)
        }
        288 => {
            msg!("attack castle");
            processor::castle::attack_castle::process(program_id, accounts, instruction_data)
        }
        289 => {
            msg!("update castle status");
            processor::castle::update_castle_status::process(program_id, accounts, instruction_data)
        }
        290 => {
            msg!("complete castle upgrade");
            processor::castle::complete_upgrade::process(program_id, accounts, instruction_data)
        }

        // Token Economy (300-309) - NOVI Purchases
        300 => {
            msg!("purchase novi");
            processor::shop::purchase_novi::process(program_id, accounts, instruction_data)
        }

        // Switchboard Oracle Quote (301-309)
        301 => {
            msg!("init oracle quote");
            processor::oracle::init_quote::process(program_id, accounts, instruction_data)
        }
        302 => {
            msg!("crank oracle quote");
            processor::oracle::crank_quote::process(program_id, accounts, instruction_data)
        }

        // Hero Burn & Supply (310-319)
        310 => {
            msg!("burn hero");
            processor::hero::burn::process(program_id, accounts, instruction_data)
        }
        311 => {
            msg!("update supply cap");
            processor::hero::update_supply_cap::process(program_id, accounts, instruction_data)
        }
        312 => {
            msg!("use hero ability");
            processor::hero::use_ability::process(program_id, accounts, instruction_data)
        }

        // Token Operations Extended (320-329)
        320 => {
            msg!("deposit novi");
            processor::economy::deposit_novi::process(program_id, accounts, instruction_data)
        }
        321 => {
            msg!("treasury sweep untracked novi");
            processor::economy::treasury_sweep_untracked_novi::process(
                program_id,
                accounts,
                instruction_data,
            )
        }

        // Cosmetics (322)
        322 => {
            msg!("equip cosmetic");
            processor::cosmetic::equip::process(program_id, accounts, instruction_data)
        }

        _ => Err(ProgramError::InvalidInstructionData),
    }
}
