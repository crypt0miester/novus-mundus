//! Crate macros.
//!
//! - `msg!(...)` — delegates to `pinocchio_log::log!`. Local replacement
//!   for pinocchio 0.9's `msg!` which is gone in 0.10.
//! - `seeds!(s1, s2, ...)` — constructs a `[Seed; N]` array for use with
//!   `pinocchio::cpi::Signer::from(&...)`. Local replacement for
//!   pinocchio 0.9's `seeds!`.
//! - `extract_accounts!(accounts, [...])` — destructure `&[AccountView]`
//!   into named bindings with labeled-and-logged errors on missing slots.
//!   Two forms: lenient (extras allowed; optional `rest = name`) and
//!   `exact` (extras rejected with a log).
//! - `require!`, `require_eq!`, `require_keys_eq!` — labeled early-return
//!   primitives with cold-path branch hints. Same shape as Anchor's, no
//!   Anchor weight.

#[macro_export]
macro_rules! msg {
    ($($arg:tt)*) => {
        ::pinocchio_log::log!($($arg)*)
    };
}

#[macro_export]
macro_rules! seeds {
    ( $($seed:expr),* $(,)? ) => {
        [$(
            ::pinocchio::cpi::Seed::from(
                ::core::convert::AsRef::<[u8]>::as_ref($seed)
            ),
        )*]
    };
}

/// Destructure an `&[AccountView]` slice into named local bindings with
/// labeled, logged errors on missing slots.
///
/// On a short account list, the macro logs
/// `missing account <name> at index <i> (got <n> accounts)` and returns
/// `ProgramError::NotEnoughAccountKeys` from the enclosing function.
///
/// Two forms:
///
/// * Lenient — extra trailing accounts are allowed (use `rest = name` to
///   bind them):
///
/// ```ignore
/// extract_accounts!(accounts, [
///     buyer,
///     player,
///     game_engine,
///     treasury,
/// ], rest = oracle_accounts);
/// ```
///
/// * Exact — `accounts.len()` must equal the number of named slots;
///   extras log `unexpected extra accounts: expected <n>, got <m>` and
///   return `ProgramError::InvalidArgument`:
///
/// ```ignore
/// extract_accounts!(accounts, exact [
///     authority,
///     game_engine,
///     allowed_token,
///     token_mint,
///     system_program,
/// ]);
/// ```
#[macro_export]
macro_rules! extract_accounts {
    // Exact form: rejects both too-few and too-many.
    ($accounts:expr, exact [ $($name:ident),+ $(,)? ] $(,)?) => {
        let __accts: &[::pinocchio::AccountView] = $accounts;
        const __EXPECTED: usize = <[()]>::len(&[$( $crate::extract_accounts!(@unit $name) ),+]);
        if __accts.len() > __EXPECTED {
            ::pinocchio_log::log!(
                "unexpected extra accounts: expected {}, got {}",
                __EXPECTED as u64,
                __accts.len() as u64
            );
            return Err(::pinocchio::error::ProgramError::InvalidArgument);
        }
        let mut __idx: usize = 0;
        $(
            let $name: &::pinocchio::AccountView = match __accts.get(__idx) {
                Some(a) => a,
                None => {
                    ::pinocchio_log::log!(
                        "missing account {} at index {} (got {} accounts)",
                        stringify!($name),
                        __idx as u64,
                        __accts.len() as u64
                    );
                    return Err(::pinocchio::error::ProgramError::NotEnoughAccountKeys);
                }
            };
            #[allow(unused_assignments)]
            { __idx += 1; }
        )+
    };

    // Lenient form: trailing extras are allowed, optional `rest = name` tail.
    ($accounts:expr, [ $($name:ident),+ $(,)? ] $(, rest = $rest:ident)? $(,)?) => {
        let __accts: &[::pinocchio::AccountView] = $accounts;
        let mut __idx: usize = 0;
        $(
            let $name: &::pinocchio::AccountView = match __accts.get(__idx) {
                Some(a) => a,
                None => {
                    ::pinocchio_log::log!(
                        "missing account {} at index {} (got {} accounts)",
                        stringify!($name),
                        __idx as u64,
                        __accts.len() as u64
                    );
                    return Err(::pinocchio::error::ProgramError::NotEnoughAccountKeys);
                }
            };
            #[allow(unused_assignments)]
            { __idx += 1; }
        )+
        $( let $rest: &[::pinocchio::AccountView] = &__accts[__idx..]; )?
    };

    // Internal helper: count idents by mapping each to `()`.
    (@unit $_name:ident) => { () };
}

/// Return early with `$err` (any expression that converts into
/// `ProgramError`) when the condition is false. The error path is hinted
/// as cold, so the compiler lays the success branch as fall-through.
///
/// ```ignore
/// require!(discount_bps <= 5000, GameError::InvalidParameter);
/// ```
#[macro_export]
macro_rules! require {
    ($cond:expr, $err:expr $(,)?) => {
        if $crate::utils::hint::unlikely(!$cond) {
            return Err(::core::convert::From::from($err));
        }
    };
}

/// `require!` for equality. Use `require_keys_eq!` instead when comparing
/// 32-byte addresses — that variant logs both sides on mismatch.
#[macro_export]
macro_rules! require_eq {
    ($left:expr, $right:expr, $err:expr $(,)?) => {{
        let __l = $left;
        let __r = $right;
        if $crate::utils::hint::unlikely(__l != __r) {
            return Err(::core::convert::From::from($err));
        }
    }};
}

/// `require!` for 32-byte address equality. Logs both sides as base58 on
/// failure (`<label>: expected <want>, got <got>`).
#[macro_export]
macro_rules! require_keys_eq {
    ($left:expr, $right:expr, $label:expr, $err:expr $(,)?) => {{
        let __l: &[u8; 32] = $left;
        let __r: &[u8; 32] = $right;
        if $crate::utils::hint::unlikely(__l != __r) {
            ::pinocchio_log::log!(
                "{}: expected {}, got {}",
                $label,
                $crate::utils::Pk(__r),
                $crate::utils::Pk(__l),
            );
            return Err(::core::convert::From::from($err));
        }
    }};
}
