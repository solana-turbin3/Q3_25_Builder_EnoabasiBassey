// This file defines the 'Deposit' instruction for the AMM program.
// It allows users to add liquidity to the pool and mint LP tokens representing their share.
//
// Key roles:
// - 'user': The liquidity provider.
// - 'vault_x' and 'vault_y': The pool's token vaults.
// - 'mint_lp': The LP token mint.
// - 'user_lp': The user's LP token account.
//
// The deposit flow:
// - User transfers tokens X and Y to the pool vaults.
// - The program mints LP tokens to the user, representing their share of the pool.
// - Proportional math ensures fair share for all liquidity providers.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{ Transfer, transfer, Mint, Token, TokenAccount, MintTo, mint_to },
};
use constant_product_curve::ConstantProduct;

use crate::{ state::Config, error::AmmError };

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The user providing liquidity.
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
        bump = config.lp_bump,
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
        init_if_needed,
        payer = user,
        associated_token::mint = mint_lp,
        associated_token::authority = user
    )]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    /// Transfers tokens from the user to the pool vaults.
    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (self.user_x.to_account_info(), self.vault_x.to_account_info()),
            false => (self.user_y.to_account_info(), self.vault_y.to_account_info()),
        };
        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = Transfer {
            from,
            to,
            authority: self.user.to_account_info(),
        };

        let ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(ctx, amount)
    }

    /// Mints LP tokens to the user, using the config PDA as authority.
    pub fn mint_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = MintTo {
            mint: self.mint_lp.to_account_info(),
            to: self.user_lp.to_account_info(),
            authority: self.config.to_account_info(),
        };

        let seeds = &[&b"config"[..], &self.config.seed.to_le_bytes(), &[self.config.config_bump]];
        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        mint_to(ctx, amount)
    }

    /// Handles the main deposit logic: proportional math, slippage checks, and LP minting.
    pub fn deposit(&mut self, amount: u64, max_x: u64, max_y: u64) -> Result<()> {
        // Check if pool is locked
        require!(!self.config.locked, AmmError::PoolLocked);
        require!(amount != 0, AmmError::InvalidAmount);

        let (x, y) = if self.mint_lp.supply == 0 &&
            self.vault_x.amount == 0 &&
            self.vault_y.amount == 0
        {
            // First deposit - use max amounts
            (max_x, max_y)
        } else {
            // Subsequent deposits - calculate proportional amounts
            let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                self.vault_x.amount,
                self.vault_y.amount,
                self.mint_lp.supply,
                amount,
                6
            ).map_err(|_| AmmError::InvalidAmount)?;
            (amounts.x, amounts.y)
        };

        // Check slippage
        require!(x <= max_x && y <= max_y, AmmError::SlippageExceeded);

        // Perform the deposits
        self.deposit_tokens(true, x)?;
        self.deposit_tokens(false, y)?;

        // Mint LP tokens
        self.mint_lp_tokens(amount)?;

        Ok(())
    }
}