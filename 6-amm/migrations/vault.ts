import { LiteSVM } from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction
} from "@solana/web3.js";
import * as fs from "fs";
import idl from "../target/idl/vault.json"
import { BorshCoder, Idl } from "@coral-xyz/anchor";

// === 1. Load Program and IDL ===
const svm = new LiteSVM();
const user = Keypair.generate();
svm.airdrop(user.publicKey, 2_000_000_000n); // 2 SOL

const programId = new PublicKey(idl.address);

// Load binary .so file
const soBinary = fs.readFileSync("target/deploy/vault.so");

// Load the program with the IDL into LiteSVM
svm.addProgram(programId, soBinary)

// === 2. Derive PDAs ===
const [vaultState, vaultStateBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("state"), user.publicKey.toBuffer()],
  programId
);


const [vault, vaultBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), vaultState.toBuffer()],
  programId
);

const coder = new BorshCoder(idl as Idl);
const data = coder.instruction.encode("initialize", []);

// === 5. Create instruction
const ix = new TransactionInstruction({
  programId,
  data,
  keys: [
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});

// === 6. Build and send transaction (like your style)
const tx = new Transaction();
tx.recentBlockhash = svm.latestBlockhash();
tx.add(ix);
tx.sign(user);
svm.sendTransaction(tx);

const vaultBalance = svm.getBalance(vault);
console.log("Vault lamports:", vaultBalance);

// === 7. Encode 'deposit' instruction ===
const depositAmount = 1_000_000n; // 0.001 SOL
const depositData = coder.instruction.encode("deposit", [{ amount: depositAmount }]);

const depositTransferIx = SystemProgram.transfer({
  fromPubkey: user.publicKey,
  toPubkey: vault,
  lamports: depositAmount,
});

const depositIx = new TransactionInstruction({
  programId,
  data: depositData,
  keys: [
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});

const depositTx = new Transaction();
depositTx.recentBlockhash = svm.latestBlockhash();
depositTx.add(depositTransferIx);  // Transfer lamports first
depositTx.add(depositIx);
depositTx.sign(user);
svm.sendTransaction(depositTx);

// Check new vault balance
const vaultBalanceAfterDeposit = svm.getBalance(vault);
console.log("Vault lamports after deposit:", vaultBalanceAfterDeposit);


// === 7. Encode 'deposit' instruction ===
const withdrawAmount = 1_000_000n; // 0.001 SOL
const withdrawData = coder.instruction.encode("withdraw", [{ amount: withdrawAmount }]);

const withdrawTransferIx = SystemProgram.transfer({
  fromPubkey: vault,
  toPubkey: user.publicKey,
  lamports: withdrawAmount,
});

const withdrawIx = new TransactionInstruction({
  programId,
  data: withdrawData,
  keys: [
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});

const withdrawTx = new Transaction();
withdrawTx.recentBlockhash = svm.latestBlockhash();
// withdrawTx.add(withdrawTransferIx)
withdrawTx.add(withdrawIx);
withdrawTx.sign(user);
try {
  svm.sendTransaction(withdrawTx);
  console.log("Withdraw tx ran");
} catch (err) {
  console.error("Withdraw tx error:", err);
}


// Check new vault balance
const vaultBalanceAfterWithdraw = svm.getBalance(vault);
console.log("Vault lamports after withdraw:", vaultBalanceAfterWithdraw);
