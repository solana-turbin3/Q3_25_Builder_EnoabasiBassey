import wallet from "../turbin3-wallet.json"
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { createGenericFile, createSignerFromKeypair, signerIdentity } from "@metaplex-foundation/umi"
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys"

// Create a devnet connection
const umi = createUmi('https://api.devnet.solana.com');

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(irysUploader());
umi.use(signerIdentity(signer));

(async () => {
    try {
        // Follow this JSON structure
        // https://docs.metaplex.com/programs/token-metadata/changelog/v1.0#json-structure

        const image =  "https://gateway.irys.xyz/4CZWwxiGk7FZdpUAxv3q8zLDghF5mpBybYK67YEGL4F8";
        const metadata = {
            name: "Turbin3 Rug Day",
            symbol: "TRD",
            description: "Exciting Turbin3 Rug Day",
            image: image,
            attributes: [
                { trait_type:"Mood", value: "Rugged" }
            ],
            properties: {
                files: [
                    {
                        type: "image/png",
                        uri: "image"
                    },
                ]
            },
            creators: []
        };
          const metadataBytes = Buffer.from(JSON.stringify(metadata));
        const metadataFile = createGenericFile(metadataBytes, "metadata.json")
        const myUri =  await umi.uploader.upload([metadataFile]);
        console.log("Your metadata URI: ", myUri);
    }
    catch(error) {
        console.log("Oops.. Something went wrong", error);
    }
})();
