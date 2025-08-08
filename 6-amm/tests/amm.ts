import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";

type AmmContext = {
  initializer: Keypair;
  user: Keypair;
  mintX: PublicKey;
  mintY: PublicKey;
  mintLp: PublicKey;
  config: PublicKey;
  vaultX: PublicKey;
  vaultY: PublicKey;
  userAtaX: PublicKey;
  userAtaY: PublicKey;
  userAtaLp?: PublicKey;
  seed: anchor.BN;
  fee: number;
};

describe("amm", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.amm as Program<Amm>;

  
  const setupPool = async (): Promise<AmmContext> => {
    const initializer = Keypair.generate();
    const user = Keypair.generate();
    const seed = new anchor.BN(123456789);
    const fee = 500;

  const initializerAirdrop = await provider.connection.requestAirdrop(
  initializer.publicKey,
  2 * anchor.web3.LAMPORTS_PER_SOL
);

const userAirdrop = await provider.connection.requestAirdrop(
  user.publicKey,
  2 * anchor.web3.LAMPORTS_PER_SOL
);

// Fetch latest blockhash and height once to avoid multiple calls
const latestBlockhashInfo = await provider.connection.getLatestBlockhash();

await provider.connection.confirmTransaction({
  signature: initializerAirdrop,
  blockhash: latestBlockhashInfo.blockhash,
  lastValidBlockHeight: latestBlockhashInfo.lastValidBlockHeight,
});

await provider.connection.confirmTransaction({
  signature: userAirdrop,
  blockhash: latestBlockhashInfo.blockhash,
  lastValidBlockHeight: latestBlockhashInfo.lastValidBlockHeight,
});

// Add a small delay to ensure accounts are funded
await new Promise((resolve) => setTimeout(resolve, 1000));

const mintX = await createMint(provider.connection, initializer, initializer.publicKey, null, 6);
const mintY = await createMint(provider.connection, initializer, initializer.publicKey, null, 6);

const [config, configBump] = await PublicKey.findProgramAddressSync(
  [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
  program.programId
);
const [mintLp, lpBump] = await PublicKey.findProgramAddressSync(
  [Buffer.from("lp"), config.toBuffer()],
  program.programId
);

const vaultX = await getAssociatedTokenAddress(mintX, config, true);
const vaultY = await getAssociatedTokenAddress(mintY, config, true);

const userAtaX = (await getOrCreateAssociatedTokenAccount(provider.connection, user, mintX, user.publicKey)).address;
const userAtaY = (await getOrCreateAssociatedTokenAccount(provider.connection, user, mintY, user.publicKey)).address;

// Mint tokens to user's X accounts
  await mintTo(
    provider.connection,
    initializer,
    mintX,
    userAtaX,
    initializer,
    1_000_000
  );

  // Mint tokens to user's Y  accounts
  await mintTo(
    provider.connection,
    initializer,
    mintY,
    userAtaY,
    initializer,
    1_000_000
  );


return {
  initializer,
  user,
  mintX,
  mintY,
  mintLp,
  config,
  vaultX,
  vaultY,
  userAtaX,
  userAtaY,
  seed,
  fee,
};
};

describe("initialize", () => {
    let context: AmmContext;

      before(async () => {
      const baseContext = await setupPool();
      
      // Initialize the AMM pool first
      await program.methods
        .initialize(baseContext.seed, baseContext.fee, null)
        .accounts({
          initializer: baseContext.initializer.publicKey,
          mintX: baseContext.mintX,
          mintY: baseContext.mintY,
          //@ts-ignore
          mintLp: baseContext.mintLp,
          config: baseContext.config,
          vaultX: baseContext.vaultX,
          vaultY: baseContext.vaultY,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([baseContext.initializer])
        .rpc();

      // Now create the LP token account after the LP mint exists
      const userAtaLp = (await getOrCreateAssociatedTokenAccount(
        provider.connection, 
        baseContext.user, 
        baseContext.mintLp, 
        baseContext.user.publicKey
      )).address;

      context = {
        ...baseContext,
        userAtaLp
      };
    });

    it("Initializes the AMM pool", async () => {
      // This test is now just checking that initialization worked
      // The actual initialization happens in the before hook
      assert.ok(context.config, "Config should be set");
      assert.ok(context.mintLp, "LP mint should be set");
    });

    it("Deposits initial liquidity", async () => {
      const { user, mintX, mintY, config, vaultX, vaultY, mintLp, userAtaX, userAtaY, userAtaLp } = context;
  
      await program.methods
        .deposit(new anchor.BN(100_000), new anchor.BN(100_000), new anchor.BN(200_000))
        .accounts({
          user: user.publicKey,
          //@ts-ignore
          mintX,
          mintY,
          config,
          vaultX,
          vaultY,
          mintLp,
          userX: userAtaX,
          userY: userAtaY,
          userLp: userAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    });
    it("Swaps X for Y", async () => {
       const { user, mintX, mintY, config, vaultX, vaultY, userAtaX, userAtaY, initializer } = context;
  
       await mintTo(provider.connection, initializer, mintX, userAtaX, initializer, 100_000);
  
       const yBefore = BigInt((await provider.connection.getTokenAccountBalance(userAtaY)).value.amount);
  
       await program.methods
         .swap(new anchor.BN(50_000), new anchor.BN(1), true)
         .accounts({
           user: user.publicKey,
           //@ts-ignore
           mintX,
           mintY,
           config,
           vaultX,
           vaultY,
           userX: userAtaX,
           userY: userAtaY,
           tokenProgram: TOKEN_PROGRAM_ID,
           associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
           systemProgram: SystemProgram.programId,
         })
         .signers([user])
         .rpc();
  
       const yAfter = BigInt((await provider.connection.getTokenAccountBalance(userAtaY)).value.amount);
       assert.ok(yAfter > yBefore, "Y balance should increase after swap");
     });
  
     it("Swaps Y for X", async () => {
       const { user, mintX, mintY, config, vaultX, vaultY, userAtaX, userAtaY, initializer } = context;
  
       await mintTo(provider.connection, initializer, mintY, userAtaY, initializer, 100_000);
  
       const xBefore = BigInt((await provider.connection.getTokenAccountBalance(userAtaX)).value.amount);
  
       await program.methods
         .swap(new anchor.BN(50_000), new anchor.BN(1), false)
         .accounts({
           user: user.publicKey,
           //@ts-ignore
           mintX,
           mintY,
           config,
           vaultX,
           vaultY,
           userX: userAtaX,
           userY: userAtaY,
           tokenProgram: TOKEN_PROGRAM_ID,
           associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
           systemProgram: SystemProgram.programId,
         })
         .signers([user])
         .rpc();
  
       const xAfter = BigInt((await provider.connection.getTokenAccountBalance(userAtaX)).value.amount);
       assert.ok(xAfter > xBefore, "X balance should increase after swap");
     });

      it("Withdraws liquidity", async () => {
      const { user, mintX, mintY, config, vaultX, vaultY, mintLp, userAtaX, userAtaY, userAtaLp } = context;

      const lpBalance = BigInt((await provider.connection.getTokenAccountBalance(userAtaLp)).value.amount);
      const xBefore = BigInt((await provider.connection.getTokenAccountBalance(userAtaX)).value.amount);
      const yBefore = BigInt((await provider.connection.getTokenAccountBalance(userAtaY)).value.amount);

      await program.methods
        .withdraw(new anchor.BN(lpBalance), new anchor.BN(0), new anchor.BN(0))
        .accounts({
          user: user.publicKey,
          //@ts-ignore
          mintX,
          mintY,
          config,
          vaultX,
          vaultY,
          mintLp,
          userX: userAtaX,
          userY: userAtaY,
          userLp: userAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const xAfter = BigInt((await provider.connection.getTokenAccountBalance(userAtaX)).value.amount);
      const yAfter = BigInt((await provider.connection.getTokenAccountBalance(userAtaY)).value.amount);
      assert.ok(xAfter > xBefore, "X should increase after withdraw");
      assert.ok(yAfter > yBefore, "Y should increase after withdraw");
    });
  });
  });



