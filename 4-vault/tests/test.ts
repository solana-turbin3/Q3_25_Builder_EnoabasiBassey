import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import { assert } from "chai";
import BN from "bn.js";


describe("Vault", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  
  const user = anchor.web3.Keypair.generate();
  const provider = anchor.getProvider();

  const program = anchor.workspace.vault as Program<Vault>;

  let vaultStatePDA: PublicKey;
  let vaultPDA: PublicKey;
  let vaultStateBump: number;
  let vaultBump: number;

  before(async () => {
    try {
      // Airdrop to the user
      const vaultAirdrop = await provider.connection.requestAirdrop(
        user.publicKey,
        4 * LAMPORTS_PER_SOL
      );

       await provider.connection.confirmTransaction({
      signature: vaultAirdrop,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (await provider.connection.getLatestBlockhash()).lastValidBlockHeight,
    });

    // Add a small delay to ensure accounts are properly funded
    await new Promise(resolve => setTimeout(resolve, 1000));
      
      

      // Derive PDAs once and store bumps
      [vaultStatePDA, vaultStateBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("state"), user.publicKey.toBuffer()],
        program.programId
      );

      [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), vaultStatePDA.toBuffer()],
        program.programId
      );
    } catch (error) {
      console.error("Setup failed:", error);
      throw error;
    }
  });

  it("Initializes the vault", async () => {
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          user: user.publicKey,
          //@ts-ignore
          vaultState: vaultStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("Initialize TX:", tx);

      // Verify the state account was created
      const stateAccount = await program.account.vaultState.fetch(vaultStatePDA);
      assert.isOk(stateAccount, "Vault state not initialized properly");
      assert.equal(stateAccount.vaultBump, vaultBump);
      
    } catch (error) {
      console.error("Initialize failed:", error);
      throw error;
    }
  });

  it("Deposits funds", async () => {
    try {
      const depositAmountLamports = new BN(0.1 * LAMPORTS_PER_SOL);
      
      // Check user balance before deposit
      const userBalanceBefore = await provider.connection.getBalance(user.publicKey);
      console.log(`User balance before deposit: ${userBalanceBefore / LAMPORTS_PER_SOL} SOL`);

      const tx = await program.methods
        .deposit(depositAmountLamports)
        .accounts({
          user: user.publicKey,
           //@ts-ignore
          vaultState: vaultStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("Deposit TX:", tx);

      const balance = await provider.connection.getBalance(vaultPDA);
      console.log(`Vault balance after deposit: ${balance / LAMPORTS_PER_SOL} SOL`);

      assert(balance >= depositAmountLamports.toNumber(), "Deposit failed");
      
      // Verify state account updated
      const stateAccount = await program.account.vaultState.fetch(vaultStatePDA);
      // Add assertions based on your VaultState structure
      
    } catch (error) {
      console.error("Deposit failed:", error);
      throw error;
    }
  });

  it("Withdraws funds", async () => {
    try {
      const withdrawAmountLamports = new BN(0.05 * LAMPORTS_PER_SOL);
      
      // Get balances before withdrawal
      const vaultBalanceBefore = await provider.connection.getBalance(vaultPDA);
      const userBalanceBefore = await provider.connection.getBalance(user.publicKey);

      const tx = await program.methods
        .withdraw(withdrawAmountLamports)
        .accounts({
          user: user.publicKey,
           //@ts-ignore
          vaultState: vaultStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("Withdraw TX:", tx);

      const vaultBalanceAfter = await provider.connection.getBalance(vaultPDA);
      const userBalanceAfter = await provider.connection.getBalance(user.publicKey);
      
      console.log(`Vault balance after withdraw: ${vaultBalanceAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`User balance after withdraw: ${userBalanceAfter / LAMPORTS_PER_SOL} SOL`);

      // Better assertions
      assert(vaultBalanceAfter >= 0, "Vault balance is negative");
      assert(
        vaultBalanceBefore - vaultBalanceAfter >= withdrawAmountLamports.toNumber(),
        "Withdraw amount not deducted from vault"
      );
      
    } catch (error) {
      console.error("Withdraw failed:", error);
      throw error;
    }
  });

  it("Closes the vault", async () => {
    try {
      // Get remaining vault balance for validation
      const vaultBalanceBefore = await provider.connection.getBalance(vaultPDA);
      const userBalanceBefore = await provider.connection.getBalance(user.publicKey);

      const tx = await program.methods
        .close()
        .accounts({
          user: user.publicKey,
           //@ts-ignore
          vaultState: vaultStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("Close TX:", tx);

      // Verify accounts are closed
      const vaultStateAccountInfo = await provider.connection.getAccountInfo(vaultStatePDA);
      const vaultAccountInfo = await provider.connection.getAccountInfo(vaultPDA);
      
      assert(vaultStateAccountInfo === null, "Vault state account still exists after close");
      assert(vaultAccountInfo === null, "Vault account still exists after close");
      
      // Verify user received remaining funds (minus transaction fees)
      const userBalanceAfter = await provider.connection.getBalance(user.publicKey);
      console.log(`User balance after close: ${userBalanceAfter / LAMPORTS_PER_SOL} SOL`);
      
    } catch (error) {
      console.error("Close failed:", error);
      throw error;
    }
  });
});