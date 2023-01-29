use anchor_lang::prelude::*;
// use fastrand;
// use lz4_flex;
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod novus_mundus {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        // let mut v = vec![1, 2, 3, 4, 5];
        // fastrand::shuffle(&mut v);
        // if fastrand::bool() {
        //     msg!("heads");
        // } else {
        //     msg!("tails");
        // }
        // Pick an arbitrary number as seed.
        // fastrand::seed(7);

        // Now this prints the same number on every run:
        // msg!("{}", fastrand::u32(..));
        // Choose a random element in an array:
        // let v = vec![1, 2, 3, 4, 5];
        // let i = fastrand::usize(..v.len());
        // let elem = v[i];
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    signer: Signer<'info>,
}
