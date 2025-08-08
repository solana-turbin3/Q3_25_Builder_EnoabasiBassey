// This file defines the 'Swap' instruction for the AMM program.
// It allows users to swap between the two pool tokens using the constant product formula (x*y=k).
//
// Key roles:
// - 'user': The swapper.
// - 'vault_x' and 'vault_y': The pool's token vaults.
// - 'config': The pool's configuration PDA.
//
// The swap flow:
// - User sends input tokens to the pool vault.
// - The pool sends output tokens to the user, using the config PDA as authority.
// - The output amount is calculated using the constant product formula and fee.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Transfer, transfer, Mint, Token, TokenAccount},
};

use crate::{ state::Config, error::AmmError };

#[derive(Accounts)]
pub struct Swap<'info> {
    /// The user performing the swap.
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
    /// Standard program accounts required for CPI and ATA creation.
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    /// Swaps tokens using the constant product formula (x*y=k) and applies the pool fee.
    /// Transfers input tokens from user to vault, and output tokens from vault to user.
    pub fn swap(&mut self, amount_in: u64, min_amount_out: u64, x_to_y: bool) -> Result<()> {
        require!(!self.config.locked, AmmError::PoolLocked);
        require!(amount_in > 0, AmmError::InvalidAmount);

        // Select source/destination tokens
        let (user_src, user_dst, vault_src, vault_dst) = if x_to_y {
            (&self.user_x, &self.user_y, &self.vault_x, &self.vault_y)
        } else {
            (&self.user_y, &self.user_x, &self.vault_y, &self.vault_x)
        };

        // Ensure user has enough tokens
        require!(user_src.amount >= amount_in, AmmError::InsufficientFunds);
        // Ensure vault has enough liquidity
        require!(vault_src.amount > 0 && vault_dst.amount > 0, AmmError::InsufficientLiquidity);

        // Calculate output amount using the constant product curve
        let (reserve_in, reserve_out) = (vault_src.amount, vault_dst.amount);
        // Apply fee (assuming fee is in basis points, e.g., 30 = 0.3%)
        let fee = self.config.fee as u128;
        let amount_in_with_fee = (amount_in as u128 * (10_000 - fee)) / 10_000;
        // Calculate output amount using constant product formula: x * y = k
        // amount_out = (amount_in_with_fee * reserve_out) / (reserve_in + amount_in_with_fee)
        let numerator = amount_in_with_fee * reserve_out as u128;
        let denominator = reserve_in as u128 + amount_in_with_fee;
        let amount_out = (numerator / denominator) as u64;

        // Slippage protection
        require!(amount_out >= min_amount_out, AmmError::SlippageExceeded);
        require!(amount_out > 0, AmmError::InvalidAmount);
        // Ensure vault has enough tokens to fulfill the swap
        require!(vault_dst.amount >= amount_out, AmmError::InsufficientLiquidity);

        // Transfer input tokens from user to vault
        let cpi_program = self.token_program.to_account_info();
        let transfer_in_accounts = Transfer {
            from: user_src.to_account_info(),
            to: vault_src.to_account_info(),
            authority: self.user.to_account_info(),
        };
        let cpi_ctx_in = CpiContext::new(cpi_program.clone(), transfer_in_accounts);
        transfer(cpi_ctx_in, amount_in)?;

        // Transfer output tokens from vault to user using PDA authority
        let seeds = &[&b"config"[..], &self.config.seed.to_le_bytes(), &[self.config.config_bump]];
        let signer_seeds = &[&seeds[..]];
        let transfer_out_accounts = Transfer {
            from: vault_dst.to_account_info(),
            to: user_dst.to_account_info(),
            authority: self.config.to_account_info(),
        };
        let cpi_ctx_out = CpiContext::new_with_signer(cpi_program, transfer_out_accounts, signer_seeds);
        transfer(cpi_ctx_out, amount_out)?;

        // Emit swap event for tracking
        emit!(SwapEvent {
            user: self.user.key(),
            amount_in,
            amount_out,
            x_to_y,
            reserve_x: if x_to_y { vault_src.amount + amount_in } else { vault_dst.amount - amount_out },
            reserve_y: if x_to_y { vault_dst.amount - amount_out } else { vault_src.amount + amount_in },
        });

        Ok(())
    }
}

#[event]
pub struct SwapEvent {
    pub user: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub x_to_y: bool,
    pub reserve_x: u64,
    pub reserve_y: u64,
}