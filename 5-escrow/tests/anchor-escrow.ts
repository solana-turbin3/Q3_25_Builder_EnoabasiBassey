import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert } from "chai";
import { Escrow } from "../target/types/escrow";

type EscrowContext = {
  mintA: PublicKey;
  mintB: PublicKey;
  maker: Keypair;
  taker: Keypair;
  makerAtaA: PublicKey;
  makerAtaB: PublicKey;
  takerAtaA: PublicKey;
  takerAtaB: PublicKey;
  escrowPDA: PublicKey;
  vaultAta: PublicKey;
  seed: BN;
};

describe("escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.escrow as Program<Escrow>;

  const setupEscrow = async (
    seedValue: number,
  ) => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    // Airdrop with proper awaiting
    const makerAirdrop = await provider.connection.requestAirdrop(maker.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const takerAirdrop = await provider.connection.requestAirdrop(taker.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Wait for airdrop confirmations
    await provider.connection.confirmTransaction({
      signature: makerAirdrop,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (await provider.connection.getLatestBlockhash()).lastValidBlockHeight,
    });
    
    await provider.connection.confirmTransaction({
      signature: takerAirdrop,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (await provider.connection.getLatestBlockhash()).lastValidBlockHeight,
    });

    // Add a small delay to ensure accounts are properly funded
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create mints
    const mintA = await createMint(provider.connection, maker, maker.publicKey, null, 6);
    const mintB = await createMint(provider.connection, taker, taker.publicKey, null, 6);

    // ATAs
    const makerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, maker, mintA, maker.publicKey)).address;
    const makerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, maker, mintB, maker.publicKey)).address;
    const takerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, taker, mintA, taker.publicKey)).address;
    const takerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, taker, mintB, taker.publicKey)).address;

    // Mint tokens
    await mintTo(provider.connection, maker, mintA, makerAtaA, maker, 2000);
    await mintTo(provider.connection, taker, mintB, takerAtaB, taker, 2000);

    // PDA + Vault
    const seed = new BN(seedValue);
    const receive = new BN(1000);
    const [escrowPDA, bump] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mintA, escrowPDA, true);

    // Create Escrow
    await program.methods
      .make(seed, receive)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow: escrowPDA,
        vault: vaultAta,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([maker])
      .rpc();

    return {
      mintA,
      mintB,
      maker,
      taker,
      makerAtaA,
      makerAtaB,
      takerAtaA,
      takerAtaB,
      escrowPDA,
      vaultAta,
      seed,
    };
  };

  describe("take flow", () => {
    let context: EscrowContext;

    before(async () => {
      context = await setupEscrow(42);
    });

    it("Executes take and closes vault", async () => {
      const {
        mintA,
        mintB,
        taker,
        takerAtaA,
        takerAtaB,
        makerAtaB,
        vaultAta,
        escrowPDA,
      } = context;

      await program.methods
        .take()
        .accounts({
          taker: taker.publicKey,
          //@ts-ignore
          mintA,
          mintB,
          takerAtaB,
          makerAtaB,
          vault: vaultAta,
          takerAtaA,
          escrow: escrowPDA,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();

      let closed = false;
      try {
        await getAccount(provider.connection, vaultAta);
      } catch {
        closed = true;
      }
      assert.ok(closed, "Vault should be closed after take");
    });
  });

  describe("refund flow", () => {
    let context: EscrowContext;

    before(async () => {
      context = await setupEscrow(43);
    });

    it("Refunds and closes vault", async () => {
      const { mintA, maker, makerAtaA, vaultAta, escrowPDA } = context;

      await program.methods
        .refund()
        .accounts({
          maker: maker.publicKey,
          mintA,
          makerAtaA,
          escrow: escrowPDA,
          vault: vaultAta,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([maker])
        .rpc();

      let closed = false;
      try {
        await getAccount(provider.connection, vaultAta);
      } catch {
        closed = true;
      }
      assert.ok(closed, "Vault should be closed after refund");
    });
  });
});