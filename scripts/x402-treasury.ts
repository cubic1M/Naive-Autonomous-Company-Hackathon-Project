// Make Operis's x402 receiving wallet (testnet treasury). Prints the address for X402_PAY_TO and writes the key to
// apps/api/.env.local ONLY (gitignored), so refunds (scripts/x402-refund.ts) can send USDC back.
//   npx tsx scripts/x402-treasury.ts            make one if none exists, else print the existing address
// For real money (Base mainnet), use a wallet a founder controls instead and set only X402_PAY_TO.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = "apps/api/.env.local";
const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const existing = env.match(/^X402_TREASURY_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
const key = (existing ?? generatePrivateKey()) as `0x${string}`;
const address = privateKeyToAccount(key).address;
if (!existing) {
  writeFileSync(ENV, `${env.trimEnd()}\n\n# x402 testnet treasury (Base Sepolia). Never commit; never use for real money.\nX402_TREASURY_PRIVATE_KEY=${key}\nX402_PAY_TO=${address}\n`);
  console.log("✓ new testnet treasury written to apps/api/.env.local");
}
console.log(`X402_PAY_TO=${address}`);
console.log("Fund it with a little Base Sepolia ETH (gas for refunds): https://docs.base.org/tools/network-faucets");
