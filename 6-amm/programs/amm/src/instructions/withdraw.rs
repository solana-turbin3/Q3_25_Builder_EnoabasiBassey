// This file defines the 'Withdraw' instruction for the AMM program.
// It allows users to burn their LP tokens and withdraw their proportional share of the pool's tokens.
//
// Key roles:
// - 'user': The liquidity remover.
// - 'vault_x' and 'vault_y': The pool's token vaults.
// - 'mint_lp': The LP token mint.
// - 'user_lp': The user's LP token account.
//
// The withdraw flow:
// - User burns LP tokens.
// - The program transfers the user's proportional share of both tokens from the vaults to the user.
// - Proportional math ensures fair share for all liquidity providers.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Burn, burn, Transfer, transfer, Mint, Token, TokenAccount},
};

use crate::{ state::Config, error::AmmError };

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The user removing liquidity.
    #[account(mut)]
    pub user: Signer<'info>,
    /// The mint for token X.
    pub mint_x: Account<'info, Mint>,
    /// The mint for token Y.
    pub mint_y: Account<'info, Mint>,
    /// The config PDA for the pool.
    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump
    )]
    pub config: Account<'info, Config>,
    /// The pool's vault for token X.
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config
    )]
    pub vault_x: Account<'info, TokenAccount>,
    /// The pool's vault for token Y.
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>,
    /// The LP token mint (PDA, authority = config).
    #[account(
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub mint_lp: Account<'info, Mint>,
    /// The user's token X account.
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user
    )]
    pub user_x: Account<'info, TokenAccount>,
    /// The user's token Y account.
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = user,
    )]
    pub user_y: Account<'info, TokenAccount>,
    /// The user's LP token account.
    #[account(
        mut,
        associated_token::mint = mint_lp,
        associated_token::authority = user
    )]
    pub user_lp: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Withdraw<'info> {
    /// Burns the user's LP tokens and transfers their proportional share of vault_x and vault_y to them.
    /// Checks for pool lock and sufficient LP tokens.
    pub fn withdraw(&mut self, lp_amount: u64, min_x: u64, min_y: u64) -> Result<()> {
        // Check if pool is locked
        require!(!self.config.locked, AmmError::PoolLocked);
        require!(lp_amount > 0, AmmError::InvalidAmount);
        require!(self.user_lp.amount >= lp_amount, AmmError::InsufficientFunds);
        require!(self.mint_lp.supply > 0, AmmError::NoLiquidityInPool);

        // Calculate proportional amounts to withdraw
        let total_lp = self.mint_lp.supply;
        let x_out = (self.vault_x.amount as u128)
            .checked_mul(lp_amount as u128)
            .unwrap()
            .checked_div(total_lp as u128)
            .unwrap() as u64;
        let y_out = (self.vault_y.amount as u128)
            .checked_mul(lp_amount as u128)
            .unwrap()
            .checked_div(total_lp as u128)
            .unwrap() as u64;

        // Slippage protection (optional, but recommended)
        require!(x_out >= min_x && y_out >= min_y, AmmError::SlippageExceeded);
        require!(x_out > 0 && y_out > 0, AmmError::InvalidAmount);
        require!(self.vault_x.amount >= x_out, AmmError::InsufficientLiquidity);
        require!(self.vault_y.amount >= y_out, AmmError::InsufficientLiquidity);

        // Burn LP tokens from user
        let cpi_program = self.token_program.to_account_info();
        let burn_accounts = Burn {
            mint: self.mint_lp.to_account_info(),
            from: self.user_lp.to_account_info(),
            authority: self.user.to_account_info(),
        };
        let burn_ctx = CpiContext::new(cpi_program.clone(), burn_accounts);
        burn(burn_ctx, lp_amount)?;

        // Transfer X from vault to user
        let seeds = &[&b"config"[..], &self.config.seed.to_le_bytes(), &[self.config.config_bump]];
        let signer_seeds = &[&seeds[..]];
        let transfer_x_accounts = Transfer {
            from: self.vault_x.to_account_info(),
            to: self.user_x.to_account_info(),
            authority: self.config.to_account_info(),
        };
        let transfer_x_ctx = CpiContext::new_with_signer(cpi_program.clone(), transfer_x_accounts, signer_seeds);
        transfer(transfer_x_ctx, x_out)?;

        // Transfer Y from vault to user
        let transfer_y_accounts = Transfer {
            from: self.vault_y.to_account_info(),
            to: self.user_y.to_account_info(),
            authority: self.config.to_account_info(),
        };
        let transfer_y_ctx = CpiContext::new_with_signer(cpi_program, transfer_y_accounts, signer_seeds);
        transfer(transfer_y_ctx, y_out)?;

        Ok(())
    }
} 