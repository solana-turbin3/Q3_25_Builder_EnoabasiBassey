#![allow(unexpected_cfgs)]
#![allow(deprecated)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8KiiqftKSSHTE1zF1XmtcWf1zvppaFf9C7z4mmA46p3H");

#[program]
pub mod escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(receive)?;

        Ok(())
    }


    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.transfer_to_maker()?;
        ctx.accounts.withdraw_and_close_vault()


    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {

        ctx.accounts.refund_and_close_vault()
    }
}

// Pure function for business logic
pub fn can_refund(vault_amount: u64) -> bool {
    vault_amount > 0
}
