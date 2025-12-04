#![no_std]

// Program modules
mod constants;
mod error;
mod types;
mod state;
mod logic;
mod validation;
mod processor;
mod helpers;
mod token_helpers;

// Re-exports
pub use constants::*;
pub use error::*;
pub use types::*;
pub use state::*;

use pinocchio::{
    account_info::AccountInfo,
    program_entrypoint,
    default_allocator,
    nostd_panic_handler,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

// Program ID - raw bytes (Pubkey is just [u8; 32])
pub const ID: Pubkey = [
    0xfd, 0x6a, 0x11, 0x5a, 0x69, 0xa1, 0x9d, 0x7c,
    0x75, 0x54, 0x9e, 0x38, 0x7f, 0x11, 0x2d, 0x0b,
    0xb3, 0xe5, 0xb2, 0x5d, 0x5f, 0x7c, 0xa4, 0x6e,
    0x8b, 0x2e, 0x6c, 0xd1, 0xb9, 0xf6, 0x3b, 0x6c,
];

program_entrypoint!(process_instruction);
default_allocator!();
nostd_panic_handler!();

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
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
        0 => processor::initialization::game_engine::process(program_id, accounts, instruction_data),
        1 => processor::initialization::player::process(program_id, accounts, instruction_data),
        2 => processor::initialization::user::process(program_id, accounts, instruction_data),
        3 => processor::initialization::city::process(program_id, accounts, instruction_data),

        // Economy (10-19)
        10 => processor::economy::update_locked_novi::process(program_id, accounts, instruction_data),
        11 => processor::economy::hire_units::process(program_id, accounts, instruction_data),
        12 => processor::economy::collect_resources::process(program_id, accounts, instruction_data),
        13 => processor::economy::purchase_equipment::process(program_id, accounts, instruction_data),
        14 => processor::economy::mint_for_prize::process(program_id, accounts, instruction_data),
        17 => processor::economy::purchase_stamina::process(program_id, accounts, instruction_data),
        18 => processor::economy::transfer_cash::process(program_id, accounts, instruction_data),

        // Token Operations (15-19)
        15 => processor::token::reserved_to_locked::process(program_id, accounts, instruction_data),
        16 => processor::token::withdraw_reserved::process(program_id, accounts, instruction_data),

        // Combat (20-29)
        20 => processor::combat::attack_player::process(program_id, accounts, instruction_data),
        21 => processor::combat::attack_encounter::process(program_id, accounts, instruction_data),

        // Travel - Intercity (30-39)
        30 => processor::travel::intercity_start::process(program_id, accounts, instruction_data),
        31 => processor::travel::intercity_complete::process(program_id, accounts, instruction_data),
        32 => processor::travel::intercity_cancel::process(program_id, accounts, instruction_data),
        33 => processor::travel::intercity_teleport::process(program_id, accounts, instruction_data),

        // Travel - Intracity (40-49)
        40 => processor::travel::intracity_start::process(program_id, accounts, instruction_data),
        41 => processor::travel::intracity_complete::process(program_id, accounts, instruction_data),

        // Team System (50-59)
        50 => processor::team::create::process(program_id, accounts, instruction_data),
        51 => processor::team::join::process(program_id, accounts, instruction_data),
        52 => processor::team::leave::process(program_id, accounts, instruction_data),
        53 => processor::team::deposit_treasury::process(program_id, accounts, instruction_data),
        54 => processor::team::invite::process(program_id, accounts, instruction_data),
        55 => processor::team::accept_invite::process(program_id, accounts, instruction_data),
        56 => processor::team::transfer_leadership::process(program_id, accounts, instruction_data),
        57 => processor::team::kick_member::process(program_id, accounts, instruction_data),
        58 => processor::team::disband::process(program_id, accounts, instruction_data),
        59 => processor::team::withdraw_treasury::process(program_id, accounts, instruction_data),

        // Rally System (60-69)
        60 => processor::rally::create::process(program_id, accounts, instruction_data),
        61 => processor::rally::join::process(program_id, accounts, instruction_data),
        62 => processor::rally::execute::process(program_id, accounts, instruction_data),
        63 => processor::rally::leave::process(program_id, accounts, instruction_data),
        64 => processor::rally::cancel::process(program_id, accounts, instruction_data),
        65 => processor::rally::process_return::process(program_id, accounts, instruction_data),
        66 => processor::rally::speedup::process(program_id, accounts, instruction_data),
        67 => processor::rally::close_rally::process(program_id, accounts, instruction_data),

        // Encounter Management (70-79)
        70 => processor::encounter::spawn::process(program_id, accounts, instruction_data),
        71 => processor::loot::claim::process(program_id, accounts, instruction_data),

        // Event System (80-89)
        80 => processor::event::create::process(program_id, accounts, instruction_data),
        81 => processor::event::join::process(program_id, accounts, instruction_data),
        82 => processor::event::finalize::process(program_id, accounts, instruction_data),
        83 => processor::event::claim_prize::process(program_id, accounts, instruction_data),

        // Progression System (90-99)
        90 => processor::progression::claim_daily_reward::process(program_id, accounts, instruction_data),

        // Subscription System (100-109)
        100 => processor::subscription::purchase::process(program_id, accounts, instruction_data),
        101 => processor::subscription::update_tier::process(program_id, accounts, instruction_data),
        102 => processor::subscription::downgrade_expired::process(program_id, accounts, instruction_data),

        // Name System (110-119)
        110 => processor::name::set_player::process(program_id, accounts, instruction_data),
        111 => processor::name::set_team::process(program_id, accounts, instruction_data),
        112 => processor::name::remove_player::process(program_id, accounts, instruction_data),
        113 => processor::name::remove_team::process(program_id, accounts, instruction_data),
        114 => processor::name::update_player::process(program_id, accounts, instruction_data),
        115 => processor::name::update_team::process(program_id, accounts, instruction_data),

        // Research System (120-129)
        120 => processor::research::initialize_template::process(program_id, accounts, instruction_data),
        121 => processor::research::create_progress::process(program_id, accounts, instruction_data),
        122 => processor::research::start_research::process(program_id, accounts, instruction_data),
        123 => processor::research::complete_research::process(program_id, accounts, instruction_data),
        124 => processor::research::speed_up_research::process(program_id, accounts, instruction_data),
        125 => processor::research::cancel_research::process(program_id, accounts, instruction_data),
        126 => processor::research::update_template::process(program_id, accounts, instruction_data),

        // Hero System (130-139)
        130 => processor::hero::create_template::process(program_id, accounts, instruction_data),
        131 => processor::hero::mint::process(program_id, accounts, instruction_data),
        132 => processor::hero::lock::process(program_id, accounts, instruction_data),
        133 => processor::hero::unlock::process(program_id, accounts, instruction_data),
        134 => processor::hero::level_up::process(program_id, accounts, instruction_data),
        135 => processor::hero::assign_defensive::process(program_id, accounts, instruction_data),
        136 => processor::hero::create_collection::process(program_id, accounts, instruction_data),

        // Shop System (140-159)
        140 => processor::shop::initialize_config::process(program_id, accounts, instruction_data),
        141 => processor::shop::create_item::process(program_id, accounts, instruction_data),
        142 => processor::shop::create_bundle::process(program_id, accounts, instruction_data),
        143 => processor::shop::purchase_item::process(program_id, accounts, instruction_data),
        144 => processor::shop::purchase_bundle::process(program_id, accounts, instruction_data),
        145 => processor::shop::create_flash_sale::process(program_id, accounts, instruction_data),
        146 => processor::shop::purchase_flash_sale::process(program_id, accounts, instruction_data),
        147 => processor::shop::close_sale::process(program_id, accounts, instruction_data),
        148 => processor::shop::create_daily_deal::process(program_id, accounts, instruction_data),
        149 => processor::shop::rotate_daily_deal::process(program_id, accounts, instruction_data),
        150 => processor::shop::create_weekly_sale::process(program_id, accounts, instruction_data),
        151 => processor::shop::update_item::process(program_id, accounts, instruction_data),
        152 => processor::shop::create_seasonal_sale::process(program_id, accounts, instruction_data),
        153 => processor::shop::create_dao_promotion::process(program_id, accounts, instruction_data),
        154 => processor::shop::update_bundle::process(program_id, accounts, instruction_data),
        155 => processor::shop::update_config::process(program_id, accounts, instruction_data),
        156 => processor::shop::activate_sale::process(program_id, accounts, instruction_data),

        _ => Err(ProgramError::InvalidInstructionData),
    }
}
