#![allow(deprecated)]
#![allow(unexpected_cfgs)]


pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7TLxX95eiarxKFaxw7D4GKgtQianhuaGtPzW8nnNyZGb");

#[program]
pub mod amm {
    use super::*;

    /// Initializes a new AMM pool with the given seed, fee, and optional authority.
    /// Creates the config, LP mint, and vaults for both tokens.
    pub fn initialize(ctx: Context<Initialize>, seed: u64, fee: u16, authority: Option<Pubkey>) -> Result<()> {
        ctx.accounts.init(seed, fee, authority, ctx.bumps)
    }

    /// Deposits tokens into the pool and mints LP tokens to the user.
    /// The user receives LP tokens representing their share of the pool.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, max_x: u64, max_y: u64) -> Result<()> {
        ctx.accounts.deposit(amount, max_x, max_y)
    }

    /// Swaps tokens using the constant product formula (x*y=k).
    /// The user provides the input amount, minimum output, and direction (x_to_y).
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, x_to_y: bool) -> Result<()> {
        ctx.accounts.swap(amount_in, min_amount_out, x_to_y)
    }

    /// Withdraws liquidity by burning LP tokens and transferring the user's share of the pool tokens.
    /// The user receives their proportional share of both vault_x and vault_y.
    pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64, min_x: u64, min_y: u64) -> Result<()> {
        ctx.accounts.withdraw(lp_amount, min_x, min_y)
    }
}
