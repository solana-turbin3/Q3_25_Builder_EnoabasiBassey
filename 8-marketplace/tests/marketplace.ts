import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createNft,
  findMasterEditionPda,
  findMetadataPda,
  verifySizedCollectionItem,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  mplTokenMetadata
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  percentAmount,
  publicKey,
  KeypairSigner,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SendTransactionError,
} from "@solana/web3.js";
import { assert } from "chai";
import { Marketplace } from "../target/types/marketplace";

type MarketplaceContext = {
  maker: Keypair;
  taker: Keypair;
  nftMint: KeypairSigner;
  collectionMint: KeypairSigner;
  makerAta: PublicKey;
  takerAta: PublicKey;
  vault: PublicKey;
  listing: PublicKey;
  marketplace: PublicKey;
  treasury: PublicKey;
  price: anchor.BN;
  umi: ReturnType<typeof createUmi>;
};
  const provider = anchor.getProvider();

describe("marketplace", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.marketplace as Program<Marketplace>;
  const connection = provider.connection;

  const setupMarketplace = async (): Promise<MarketplaceContext> => {
    const umi = createUmi(connection);
    const creatorSigner = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        new Uint8Array(provider.wallet.payer.secretKey)
      )
    );

    umi.use(keypairIdentity(creatorSigner));
    umi.use(mplTokenMetadata());

    const maker = Keypair.generate();
    const taker = Keypair.generate();
    const nftMint = generateSigner(umi);
    const collectionMint = generateSigner(umi);

    const price = new anchor.BN(0.05 * LAMPORTS_PER_SOL);

    const [marketplace] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), marketplace.toBuffer()],
      program.programId
    );

    const [listing] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing"),
        marketplace.toBuffer(),
        maker.publicKey.toBuffer(),
        new PublicKey(nftMint.publicKey).toBuffer(),
      ],
      program.programId
    );

    for (const user of [maker, taker]) {
      const sig = await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    await sleep(1000);

     try {
    console.log("⛏ Minting Collection NFT...");
    await createNft(umi, {
      mint: collectionMint,
      name: "GM",
      symbol: "GM",
      uri: "https://arweave.net/123",
      sellerFeeBasisPoints: percentAmount(5.5),
      collectionDetails: { __kind: "V1", size: 10 },
    }).sendAndConfirm(umi);
    console.log("✅ Collection NFT created:", collectionMint.publicKey.toString());
  } catch (err) {
    console.error("❌ Error during createNft (collection):", err);
    throw err;
  }

  try {
    console.log("⛏ Minting NFT to Maker...");
    await createNft(umi, {
      mint: nftMint,
      name: "GM",
      symbol: "GM",
      uri: "https://arweave.net/123",
      sellerFeeBasisPoints: percentAmount(5.5),
      collection: { verified: false, key: collectionMint.publicKey },
      tokenOwner: publicKey(maker.publicKey),
    }).sendAndConfirm(umi);
    console.log("✅ NFT minted:", nftMint.publicKey.toString());
  } catch (err) {
    console.error("❌ Error during createNft (nft):", err);
    throw err;
  }

  try {
    console.log("🔍 Verifying Collection...");
    await verifySizedCollectionItem(umi, {
      metadata: findMetadataPda(umi, { mint: nftMint.publicKey }),
      collectionAuthority: createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(new Uint8Array(provider.wallet.payer.secretKey))
      ),
      collectionMint: collectionMint.publicKey,
      collection: findMetadataPda(umi, { mint: collectionMint.publicKey }),
      collectionMasterEditionAccount: findMasterEditionPda(umi, { mint: collectionMint.publicKey }),
    }).sendAndConfirm(umi);
    console.log("✅ Collection verified.");
  } catch (err) {
    console.error("❌ Error during verifySizedCollectionItem:", err);
    throw err;
  }

    const makerAta = (
      await getOrCreateAssociatedTokenAccount(connection, maker, new PublicKey(nftMint.publicKey), maker.publicKey)
    ).address;

    const takerAta = (
      await getOrCreateAssociatedTokenAccount(connection, taker, new PublicKey(nftMint.publicKey), taker.publicKey)
    ).address;

    const vault = await anchor.utils.token.associatedAddress({
      mint: new PublicKey(nftMint.publicKey),
      owner: listing,
    });

    return {
      maker,
      taker,
      nftMint,
      collectionMint,
      makerAta,
      takerAta,
      vault,
      listing,
      marketplace,
      treasury,
      price,
      umi,
    };
  };

  describe("marketplace flow", () => {
    let context: MarketplaceContext;

    before(async () => {
      context = await setupMarketplace();
    });

    it("initializes marketplace", async () => {
      try {
        const tx = await program.methods
          .initializeMarketplace(1)
          .accounts({
            admin: provider.wallet.publicKey,
            //@ts-ignore
            marketplace: context.marketplace,
            treasury: context.treasury,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log("✅ Marketplace initialized:", tx);
      } catch (err: any) {
        await handleTxError(err, "initializes marketplace");
      }
    });

    it("lists NFT", async () => {
      try {
        const nftMetadata = findMetadataPda(context.umi, { mint: context.nftMint.publicKey });
        const nftEdition = findMasterEditionPda(context.umi, { mint: context.nftMint.publicKey });

        const tx = await program.methods
          .listNft(context.price)
          .accounts({
            seller: context.maker.publicKey,
            nft: context.nftMint.publicKey,
            //@ts-ignore
            listing: context.listing,
            listingTokenAccount: context.vault,
            sellerTokenAccount: context.makerAta,
            marketplace: context.marketplace,
            collectionMint: context.collectionMint.publicKey,
            metadata: new PublicKey(nftMetadata[0]),
            masterEdition: new PublicKey(nftEdition[0]),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          })
          .signers([context.maker])
          .rpc();
        console.log("✅ NFT listed:", tx);
      } catch (err: any) {
        await handleTxError(err, "lists NFT");
      }
    });

    it("delists NFT", async () => {
      try {
        const tx = await program.methods
          .delistNft()
          .accounts({
            seller: context.maker.publicKey,
            nft: context.nftMint.publicKey,
            //@ts-ignore
            sellerTokenAccount: context.makerAta,
            listing: context.listing,
            listingTokenAccount: context.vault,
            marketplace: context.marketplace,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([context.maker])
          .rpc();
        console.log("✅ NFT delisted:", tx);
      } catch (err: any) {
        await handleTxError(err, "delists NFT");
      }
    });

    it("re-lists NFT", async () => {
      try {
        const nftMetadata = findMetadataPda(context.umi, { mint: context.nftMint.publicKey });
        const nftEdition = findMasterEditionPda(context.umi, { mint: context.nftMint.publicKey });

        const tx = await program.methods
          .listNft(context.price)
          .accounts({
            seller: context.maker.publicKey,
            nft: context.nftMint.publicKey,
            //@ts-ignore
            listing: context.listing,
            listingTokenAccount: context.vault,
            sellerTokenAccount: context.makerAta,
            marketplace: context.marketplace,
            collectionMint: context.collectionMint.publicKey,
            metadata: new PublicKey(nftMetadata[0]),
            masterEdition: new PublicKey(nftEdition[0]),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          })
          .signers([context.maker])
          .rpc();
        console.log("✅ NFT re-listed:", tx);
      } catch (err: any) {
        await handleTxError(err, "re-lists NFT");
      }
    });

    it("purchases NFT", async () => {
      try {
        const tx = await program.methods
          .purchaseNft()
          .accounts({
            buyer: context.taker.publicKey,
            seller: context.maker.publicKey,
            nft: context.nftMint.publicKey,
            //@ts-ignore
            marketplace: context.marketplace,
            buyerTokenAccount: context.takerAta,
            listingTokenAccount: context.vault,
            listing: context.listing,
            treasury: context.treasury,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([context.taker])
          .rpc();
        console.log("✅ NFT purchased:", tx);
      } catch (err: any) {
        await handleTxError(err, "purchases NFT");
      }
    });
  });
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleTxError(err: any, label: string) {
  console.error(`❌ Transaction failed during "${label}".`);

  if (err.logs) {
    console.error("🚨 Logs from simulation:\n", err.logs.join("\n"));
  } else if (err instanceof SendTransactionError && err.getLogs) {
      const logs = await err.getLogs(provider.connection);
    console.error("🚨 Logs from getLogs():\n", logs?.join("\n") || "No logs found.");
  } else {
    console.error("❗Unknown error:\n", err);
  }

  throw err;
}
