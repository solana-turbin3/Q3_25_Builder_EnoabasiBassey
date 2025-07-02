import bs58 from "bs58";
import fs from "fs";
import "dotenv/config";

const base58PrivateKey =  process.env.PRIVATE_KEY_BASE58;

if (!base58PrivateKey) {
  throw new Error("PRIVATE_KEY_BASE58 is missing in your .env file.");
}

const secretKey = bs58.decode(base58PrivateKey);

fs.writeFileSync("Turbin3-wallet.json", JSON.stringify(Array.from(secretKey)));

console.log("✅ Converted and saved to Turbin3-wallet.json");
