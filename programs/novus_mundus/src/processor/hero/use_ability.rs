use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::HERO_TEMPLATE_SEED,
    emit,
    error::GameError,
    events::HeroAbilityUsed,
    helpers::parse_hero_nft,
    state::{require_extension, AbilityKind, HeroTemplate, PlayerAccount, EXT_HEROES, NULL_PUBKEY},
    utils::read_u8,
    validation::{require_owner, require_pda, require_signer, require_writable},
};

/// Pending one-shot effects auto-expire after this many seconds so they
/// don't sit on a player forever waiting to be consumed.
const PENDING_EFFECT_LIFETIME_SECS: i64 = 24 * 3600;

/// Use a locked hero's active ability (312)
///
/// Reads the ability config from the hero's template, checks the per-slot
/// cooldown (mirrored from the NFT's "AbCD" attribute at lock time), and
/// applies the effect.
///
/// Cooldown is mirrored on PlayerAccount for fast reads; it gets written
/// back to the NFT on unlock so the cycle exploit (unlock+relock to reset)
/// doesn't work.
///
/// Effect dispatch (see AbilityKind for details):
/// - BuffNext (1):       arm next combat action with +param1 bps to stat
/// - CritNext (2):       arm next outgoing attack as auto-crit
/// - ShieldNext (3):     arm next incoming defense to ×2 defense
/// - EncounterSkip (6):  arm next encounter as auto-success
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [] hero_mint: Hero NFT mint (parsed for template_id)
/// - [] hero_template: HeroTemplate PDA for the locked hero
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    crate::extract_accounts!(accounts, exact [owner, player_account, hero_mint, hero_template]);

    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;

    let slot_index = read_u8(instruction_data, 0, "use_ability.slot_index")?;
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }
    require_extension(player, EXT_HEROES)?;

    // Verify the slot holds the supplied hero
    let slot_mint = player.active_hero_at(slot_index as usize);
    if slot_mint == NULL_PUBKEY {
        return Err(GameError::HeroNotInSlot.into());
    }
    if slot_mint != *hero_mint.address() {
        return Err(GameError::HeroMismatch.into());
    }

    // Parse hero NFT to get template_id
    let nft_data = hero_mint.try_borrow()?;
    let parsed = parse_hero_nft(&nft_data).ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    // Validate template PDA + ownership before reading its bytes
    require_owner(hero_template, program_id)?;
    let template_id_bytes = parsed.template_id.to_le_bytes();
    require_pda(
        hero_template,
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    )?;

    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    if template.template_id != parsed.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    let ability_kind = template.ability_kind;
    if ability_kind == 0 {
        return Err(GameError::HeroAbilityNotConfigured.into());
    }

    // Cooldown check (per slot, cached from NFT at lock). `last_used` must be
    // a *past* time for the cooldown to be real. A stamp in the future means
    // the cached value is garbage (e.g. a malformed NFT "AbCD" attribute that
    // slipped in before lock sanitised it) — ignore it instead of wedging the
    // ability on cooldown forever; using it now restamps a correct `now`.
    let last_used = player.ability_last_used_at(slot_index as usize);
    let cooldown_secs = template.ability_cooldown_secs as i64;
    if last_used > 0 && last_used <= now && now < last_used.saturating_add(cooldown_secs) {
        return Err(GameError::HeroAbilityOnCooldown.into());
    }

    // Capture template values before dropping the borrow
    let ability_stat = template.ability_stat;
    let ability_param1 = template.ability_param1;
    let ability_param2 = template.ability_param2;
    let hero_name = template.name;
    drop(template_data);

    // Dispatch
    // Kinds 1-4 arm a pending one-shot consumed at the matching combat site.
    // Kinds 5-6 take effect immediately by crediting a player balance.
    match AbilityKind::from_u8(ability_kind) {
        AbilityKind::None => return Err(GameError::HeroAbilityNotConfigured.into()),

        AbilityKind::BuffNext => {
            if ability_stat == 0 || ability_param1 == 0 {
                return Err(GameError::HeroAbilityBadParams.into());
            }
            let expires = now.saturating_add(PENDING_EFFECT_LIFETIME_SECS);
            player.set_pending_effect(ability_kind, ability_stat, ability_param1, expires);
        }

        AbilityKind::CritNext | AbilityKind::ShieldNext | AbilityKind::EncounterSkip => {
            let expires = now.saturating_add(PENDING_EFFECT_LIFETIME_SECS);
            player.set_pending_effect(ability_kind, 0, 0, expires);
        }

        AbilityKind::InstantResource => {
            if ability_param1 == 0 {
                return Err(GameError::HeroAbilityBadParams.into());
            }
            player.cash_on_hand = player.cash_on_hand.saturating_add(ability_param1 as u64);
        }

        AbilityKind::FragmentRefund => {
            if ability_param1 == 0 {
                return Err(GameError::HeroAbilityBadParams.into());
            }
            player.fragments = player.fragments.saturating_add(ability_param1 as u64);
        }
    }

    // Stamp cooldown for this slot. Mirrored to the NFT on next unlock_hero.
    player.set_ability_last_used_at(slot_index as usize, now);

    let player_name = player.name;
    let cooldown_until = now.saturating_add(cooldown_secs);
    drop(player_data);

    emit!(HeroAbilityUsed {
        hero_mint: *hero_mint.address(),
        hero_name,
        player: *player_account.address(),
        player_name,
        slot: slot_index,
        ability_kind,
        ability_stat,
        ability_param1,
        ability_param2,
        cooldown_until,
        timestamp: now,
    });

    Ok(())
}
