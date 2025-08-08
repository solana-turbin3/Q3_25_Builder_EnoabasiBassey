import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { Nft } from "../target/types/nft";

type StakingContext = {
  user: Keypair;
  admin: Keypair;
  configPda: PublicKey;
  rewardMintPda: PublicKey;
  userAccountPda: PublicKey;
  userRewardAta: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  vaultAta: PublicKey;
  stakePda: PublicKey;
};

describe("nft-staking", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const connection = provider.connection;
  const program = anchor.workspace.Staking as Program<Nft>;

  const POINTS_PER_STAKE = 10;
  const MAX_UNSTAKE = 5;
  const FREEZE_PERIOD = 10;

  const setupStaking = async (): Promise<StakingContext> => {
    const user = Keypair.generate();
    const admin = Keypair.generate();

    // Airdrop to user
    const adminAirdrop = await connection.requestAirdrop(admin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const userAirdrop = await connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const blockhash = await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      signature: adminAirdrop,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    });


    await connection.confirmTransaction({
      signature: userAirdrop,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    });

    await new Promise((res) => setTimeout(res, 1000)); // ensure funds

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const [rewardMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("rewards"), configPda.toBuffer()],
      program.programId
    );
    const [userAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user.publicKey.toBuffer()],
      program.programId
    );

    const [stakePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), user.publicKey.toBuffer(), mint.toBuffer()],
          program.programId
        );

    const userRewardAta = await getAssociatedTokenAddress(rewardMintPda, user.publicKey);

    return {
      user,
      admin,
      configPda,
      rewardMintPda,
      userAccountPda,
      userRewardAta,
      mint: null as any,
      userAta: null as any,
      vaultAta: null as any,
      stakePda: null as any,
    };
  };

  const waitForFreezePeriod = async (seconds: number) => {
    const start = await connection.getBlockTime(await connection.getSlot());
    while (true) {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: provider.wallet.publicKey,
        lamports: 0,
      }));
      await provider.sendAndConfirm(tx);
      const current = await connection.getBlockTime(await connection.getSlot());
      if (current - start >= seconds) break;
      await new Promise((res) => setTimeout(res, 500));
    }
  };

  describe("initialize", () => {
    let context: StakingContext;

    before(async () => {
      context = await setupStaking();

      await program.methods
        .initializeConfig(POINTS_PER_STAKE, MAX_UNSTAKE, FREEZE_PERIOD)
        .accounts({
          admin: context.admin.publicKey,
          //@ts-ignore
          config: context.configPda,
          rewardMint: context.rewardMintPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    });

    it("Initializes user account", async () => {
      await program.methods
        .initializeUser()
        .accounts({
          user: context.user.publicKey,
          //@ts-ignore
          userAccount: context.userAccountPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([context.user])
        .rpc();
    });

    describe("stake and unstake", () => {
      before(async () => {
        context.mint = await createMint(connection, context.admin, context.admin.publicKey, null, 0);
        context.userAta = await createAssociatedTokenAccount(connection, context.admin, context.mint, context.user.publicKey);
        await mintTo(connection, context.admin, context.mint, context.userAta, context.admin.publicKey, 1);

        [context.vaultAta] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), context.mint.toBuffer()],
          program.programId
        );
        
      });

      it("Stakes NFT", async () => {
        await program.methods
          .stake()
          .accounts({
            user: context.user.publicKey,
            //@ts-ignore
            userAccount: context.userAccountPda,
            config: context.configPda,
            nftMint: context.mint,
            userNftAta: context.userAta,
            vaultAta: context.vaultAta,
            stakeAccount: context.stakePda,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([context.user])
          .rpc();

        const vaultBalance = await connection.getTokenAccountBalance(context.vaultAta);
        expect(vaultBalance.value.uiAmount).to.equal(1);
      });

      it("Unstakes NFT after freeze", async () => {
        await waitForFreezePeriod(FREEZE_PERIOD);

        await program.methods
          .unstake()
          .accounts({
            user: context.user.publicKey,
            //@ts-ignore
            userAccount: context.userAccountPda,
            config: context.configPda,
            nftMint: context.mint,
            stakeAccount: context.stakePda,
            vaultAta: context.vaultAta,
            userNftAta: context.userAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([context.user])
          .rpc();

        const vaultBalance = await connection.getTokenAccountBalance(context.vaultAta);
        expect(vaultBalance.value.uiAmount).to.equal(0);

        const userBalance = await connection.getTokenAccountBalance(context.userAta);
        expect(userBalance.value.uiAmount).to.equal(1);
      });
    });

    describe("claim rewards", () => {
      before(async () => {
        context.mint = await createMint(connection, context.admin, context.admin.publicKey, null, 0);
        context.userAta = await createAssociatedTokenAccount(connection, context.admin, context.mint, context.user.publicKey);
        await mintTo(connection, context.admin, context.mint, context.userAta, context.admin.publicKey, 1);

        [context.vaultAta] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), context.mint.toBuffer()],
          program.programId
        );
        [context.stakePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), context.user.publicKey.toBuffer(), context.mint.toBuffer()],
          program.programId
        );

        const rewardInfo = await connection.getAccountInfo(context.userRewardAta);
        if (!rewardInfo) {
          await createAssociatedTokenAccount(connection, context.admin, context.rewardMintPda, context.user.publicKey);
        }

        await program.methods
          .stake()
          .accounts({
            user: context.user.publicKey,
            //@ts-ignore
            userAccount: context.userAccountPda,
            config: context.configPda,
            nftMint: context.mint,
            userNftAta: context.userAta,
            vaultAta: context.vaultAta,
            stakeAccount: context.stakePda,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([context.user])
          .rpc();
      });

      it("Claims rewards", async () => {
        await program.methods
          .claimRewards()
          .accounts({
            user: context.user.publicKey,
            //@ts-ignore
            userAccount: context.userAccountPda,
            config: context.configPda,
            rewardMint: context.rewardMintPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([context.user])
          .rpc();

        const balance = await connection.getTokenAccountBalance(context.userRewardAta);
        expect(Number(balance.value.amount)).to.equal(POINTS_PER_STAKE);
      });
    });
  });
});
























// import * as anchor from "@coral-xyz/anchor";
// import { Program } from "@coral-xyz/anchor";
// import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccount, createMint, getAssociatedTokenAddress, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
// import { Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
// import { expect } from "chai";
// import { Nft} from "../target/types/nft";

// describe("staking flows", () => {
//   anchor.setProvider(anchor.AnchorProvider.env());
//   const provider = anchor.getProvider();
//   const connection = provider.connection;
//   const program = anchor.workspace.Staking as Program<Nft>;

//   const admin = provider.wallet.payer;
//   const user = Keypair.generate();

//   const POINTS_PER_STAKE = 10;
//   const MAX_UNSTAKE = 5;
//   const FREEZE_PERIOD = 10; // seconds

//   // Common PDAs
//   let configPda: PublicKey;
//   let rewardMintPda: PublicKey;
//   let userAccountPda: PublicKey;
//   let userRewardAta: PublicKey;

//   // Mint A variables
//   let mintA: PublicKey;
//   let userAtaA: PublicKey;
//   let vaultAtaA: PublicKey;
//   let stakePdaA: PublicKey;

//   // Mint B variables
//   let mintB: PublicKey;
//   let userAtaB: PublicKey;
//   let vaultAtaB: PublicKey;
//   let stakePdaB: PublicKey;

//   before(async () => {
//     // Fund user with SOL
//     const transferTx = new anchor.web3.Transaction().add(
//       anchor.web3.SystemProgram.transfer({
//         fromPubkey: admin.publicKey,
//         toPubkey: user.publicKey,
//         lamports: 2 * anchor.web3.LAMPORTS_PER_SOL,
//       })
//     );
//     await provider.sendAndConfirm(transferTx, [admin]);

//     // Derive common PDAs
//     [configPda] = PublicKey.findProgramAddressSync(
//       [Buffer.from("config")],
//       program.programId
//     );
//     [rewardMintPda] = PublicKey.findProgramAddressSync(
//       [Buffer.from("rewards"), configPda.toBuffer()],
//       program.programId
//     );
//     [userAccountPda] = PublicKey.findProgramAddressSync(
//       [Buffer.from("user"), user.publicKey.toBuffer()],
//       program.programId
//     );
//     userRewardAta = await getAssociatedTokenAddress(rewardMintPda, user.publicKey);
//   });

//   const waitForFreezePeriod = async (seconds: number) => {
//     const start = await provider.connection.getBlockTime(await provider.connection.getSlot());

//     while (true) {
//       // Send a dummy tx to force block production
//       const tx = new anchor.web3.Transaction().add(
//         anchor.web3.SystemProgram.transfer({
//           fromPubkey: admin.publicKey,
//           toPubkey: admin.publicKey,
//           lamports: 0,
//         })
//       );
//       await provider.sendAndConfirm(tx, [admin]);

//       const current = await provider.connection.getBlockTime(await provider.connection.getSlot());
//       if (current - start >= seconds) break;

//       await new Promise((r) => setTimeout(r, 500)); // small buffer
//     }
//   };

//   // Skipped: shown for completeness
//   it("Initializes config", async () => {
//     const tx = await program.methods
//       .initializeConfig(POINTS_PER_STAKE, MAX_UNSTAKE, FREEZE_PERIOD)
//       .accounts({
//         admin: admin.publicKey,
//         config: configPda,
//         rewardMint: rewardMintPda,
//         systemProgram: SystemProgram.programId,
//         tokenProgram: TOKEN_PROGRAM_ID,
//         rent: SYSVAR_RENT_PUBKEY,
//       })
//       .signers([admin])
//       .rpc();
//     console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
//   });

//   it("Initializes user account", async () => {
//     const tx = await program.methods
//       .initializeUser()
//       .accounts({
//         user: user.publicKey,
//         userAccount: userAccountPda,
//         systemProgram: SystemProgram.programId,
//       })
//       .signers([user])
//       .rpc();
//     console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
//   });

//   describe("Stake + Unstake flow with Mint A", () => {
//     before(async () => {
//       mintA = await createMint(connection, admin, admin.publicKey, null, 0);
//       userAtaA = await createAssociatedTokenAccount(connection, admin, mintA, user.publicKey);
//       await mintTo(connection, admin, mintA, userAtaA, admin.publicKey, 1);
//       [vaultAtaA] = PublicKey.findProgramAddressSync(
//         [Buffer.from("vault"), mintA.toBuffer()],
//         program.programId
//       );
//       [stakePdaA] = PublicKey.findProgramAddressSync(
//         [Buffer.from("stake"), user.publicKey.toBuffer(), mintA.toBuffer()],
//         program.programId
//       );
//     });

//     it("Stakes NFT A", async () => {
//       const tx = await program.methods
//         .stake()
//         .accounts({
//           user: user.publicKey,
//           userAccount: userAccountPda,
//           config: configPda,
//           nftMint: mintA,
//           userNftAta: userAtaA,
//           vaultAta: vaultAtaA,
//           stakeAccount: stakePdaA,
//           tokenProgram: TOKEN_PROGRAM_ID,
//           associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
//           systemProgram: SystemProgram.programId,
//           rent: SYSVAR_RENT_PUBKEY,
//           clock: SYSVAR_CLOCK_PUBKEY,
//         })
//         .signers([user])
//         .rpc();
//       console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);

//       const vaultBalance = await connection.getTokenAccountBalance(vaultAtaA);
//       expect(vaultBalance.value.uiAmount).to.equal(1);
//     });

//     it("Unstakes NFT A after freeze period", async () => {
//       await waitForFreezePeriod(FREEZE_PERIOD);

//       try {
//         const tx = await program.methods
//           .unstake()
//           .accounts({
//             user: user.publicKey,
//             userAccount: userAccountPda,
//             config: configPda,
//             nftMint: mintA,
//             stakeAccount: stakePdaA,
//             vaultAta: vaultAtaA,
//             userNftAta: userAtaA,
//             tokenProgram: TOKEN_PROGRAM_ID,
//             associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
//             systemProgram: SystemProgram.programId,
//             rent: SYSVAR_RENT_PUBKEY,
//             clock: SYSVAR_CLOCK_PUBKEY,
//           })
//           .signers([user])
//           .rpc();
//         console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);

//         const vaultBalance = await connection.getTokenAccountBalance(vaultAtaA);
//         expect(vaultBalance.value.uiAmount).to.equal(0);

//         const userBalance = await connection.getTokenAccountBalance(userAtaA);
//         expect(userBalance.value.uiAmount).to.equal(1);
//       } catch (error) {
//         console.log(error.logs);
//       }
//     });
//   });

//   describe("Stake + Claim flow with Mint B", () => {
//     before(async () => {
//       mintB = await createMint(connection, admin, admin.publicKey, null, 0);
//       userAtaB = await createAssociatedTokenAccount(connection, admin, mintB, user.publicKey);
//       await mintTo(connection, admin, mintB, userAtaB, admin.publicKey, 1);
//       [vaultAtaB] = PublicKey.findProgramAddressSync(
//         [Buffer.from("vault"), mintB.toBuffer()],
//         program.programId
//       );
//       [stakePdaB] = PublicKey.findProgramAddressSync(
//         [Buffer.from("stake"), user.publicKey.toBuffer(), mintB.toBuffer()],
//         program.programId
//       );

//       // Ensure reward ATA exists
//       const info = await connection.getAccountInfo(userRewardAta);
//       if (!info) {
//         await createAssociatedTokenAccount(connection, admin, rewardMintPda, user.publicKey);
//       }
//     });

//     it("Stakes NFT B", async () => {
//       const tx = await program.methods
//         .stake()
//         .accounts({
//           user: user.publicKey,
//           userAccount: userAccountPda,
//           config: configPda,
//           nftMint: mintB,
//           userNftAta: userAtaB,
//           vaultAta: vaultAtaB,
//           stakeAccount: stakePdaB,
//           tokenProgram: TOKEN_PROGRAM_ID,
//           associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
//           systemProgram: SystemProgram.programId,
//           rent: SYSVAR_RENT_PUBKEY,
//           clock: SYSVAR_CLOCK_PUBKEY,
//         })
//         .signers([user])
//         .rpc();
//       console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
//     });

//     it("Claims rewards for NFT B stake", async () => {
//       const tx = await program.methods
//         .claimRewards()
//         .accounts({
//           user: user.publicKey,
//           userAccount: userAccountPda,
//           config: configPda,
//           rewardMint: rewardMintPda,
//           tokenProgram: TOKEN_PROGRAM_ID,
//           associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
//           systemProgram: SystemProgram.programId,
//           rent: SYSVAR_RENT_PUBKEY,
//         })
//         .signers([user])
//         .rpc();
//       console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
//       const balance = await connection.getTokenAccountBalance(userRewardAta);
//       expect(Number(balance.value.amount)).to.equal(POINTS_PER_STAKE);
//     });
//   });
// });