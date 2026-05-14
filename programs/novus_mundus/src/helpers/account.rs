use pinocchio::{
    AccountView,
    error::ProgramError,
    ProgramResult,
};

use crate::error::GameError;

/// Close an account and refund rent to recipient.
///
/// pinocchio 0.10 pattern: move lamports out first, then call `close()` which
/// zeros data length / lamports / owner. The runtime zero-fills the data buffer
/// at instruction end.
pub fn close_account(
    account: &AccountView,
    recipient: &AccountView,
) -> ProgramResult {
    recipient.set_lamports(
        recipient
            .lamports()
            .checked_add(account.lamports())
            .ok_or::<ProgramError>(GameError::MathOverflow.into())?,
    );
    account.close()
}
