/**
 * Test a real Bitget API key against the EXACT validation ATS-ALGO uses on connect
 * (lib/exchanges/validate.ts → ccxt bitget fetchBalance). No server/login needed,
 * and your secret never leaves your machine. Run with your creds as env vars:
 *
 *   Git Bash:
 *     BITGET_KEY="..." BITGET_SECRET="..." BITGET_PASSPHRASE="APIpassphrase" npx tsx scripts/test-bitget-key.ts
 *
 *   PowerShell:
 *     $env:BITGET_KEY="..."; $env:BITGET_SECRET="..."; $env:BITGET_PASSPHRASE="APIpassphrase"; npx tsx scripts/test-bitget-key.ts
 */
import { validateExchangeKey } from "../lib/exchanges/validate";

async function main() {
  const apiKey = process.env.BITGET_KEY?.trim();
  const apiSecret = process.env.BITGET_SECRET?.trim();
  const passphrase = process.env.BITGET_PASSPHRASE?.trim();

  if (!apiKey || !apiSecret || !passphrase) {
    console.error("Set BITGET_KEY, BITGET_SECRET, and BITGET_PASSPHRASE env vars.");
    process.exit(1);
  }

  console.log(`Validating Bitget key …${apiKey.slice(-4)} (secret & passphrase hidden)`);
  const result = await validateExchangeKey("Bitget", { apiKey, apiSecret, passphrase });

  if (result.ok) {
    console.log(`\n✓ VALID — this key would connect. permissions: ${result.permissions}`);
  } else {
    console.log(`\n✗ REJECTED (HTTP ${result.status}): ${result.message}`);
  }
}

main().catch((e) => {
  console.error("\nUnexpected error:", e?.message ?? e);
  process.exit(1);
});
