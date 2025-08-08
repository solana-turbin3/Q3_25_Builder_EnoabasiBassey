// This file defines the 'Initialize' instruction for the AMM program.
// It sets up a new AMM pool with two vaults, an LP mint, and configuration state.
//
// Key roles:
// - 'initializer': The user creating the pool.
// - 'config': The pool's configuration PDA.
// - 'vault_x' and 'vault_y': The pool's token vaults.
// - 'mint_lp': The LP token mint (PDA, authority = config).
//
// The initialize flow:
// - Creates the config, vaults, and LP mint with deterministic seeds.
// - Sets up pool parameters (fee, authority, etc).

use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{Mint, Token, TokenAccount}};

use crate::state::Config;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    /// The user creating the pool.
    #[account(mut)]
    pub initializer: Signer<'info>,
    /// The mint for token X.
    pub mint_x: Account<'info, Mint>,
    /// The mint for token Y.
    pub mint_y: Account<'info, Mint>,
    /// The LP token mint (PDA, authority = config).
    #[account(
        init,
        payer = initializer,
        seeds = [b"lp", config.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub mint_lp: Account<'info, Mint>,
    /// The config PDA for the pool.
    #[account(
        init,
        payer = initializer,
        seeds = [b"config", seed.to_le_bytes().as_ref()],
        bump,
        space = 8 + Config::INIT_SPACE,
    )]
    pub config: Account<'info, Config>,
    /// The pool's vault for token X.
    #[account(
        init,
        payer = initializer,
        associated_token::mint = mint_x,
        associated_token::authority = config
    )]
    pub vault_x: Account<'info, TokenAccount>,
    /// The pool's vault for token Y.
    #[account(
        init,
        payer = initializer,
        associated_token::mint = mint_y,
        associated_token::authority = config
    )]
    pub vault_y: Account<'info, TokenAccount>,
    /// Standard program accounts required for CPI and ATA creation.
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    /// Initializes the config state with pool parameters and bumps.
    pub fn init(&mut self, seed: u64, fee: u16, authority: Option<Pubkey>, bumps: InitializeBumps) -> Result<()> {
        self.config.set_inner(
            Config { 
                seed, 
                authority, 
                mint_x:self.mint_x.key(), 
                mint_y: self.mint_y.key(), 
                fee, 
                locked: false, 
                config_bump: bumps.config, 
                lp_bump: bumps.mint_lp, 
            });
        Ok(())
    }
}