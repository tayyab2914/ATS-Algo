// ccxt's number-quoting, proved against the body that actually broke — no key, no exchange.
//
// The string below is a real /v5/execution/list row read off a live Bybit account on
// 2026-10-23 (position cmvixbc840fvdkqqj93jcd5r6, the member's closing fill). What matters is
// `extraFees`: Bybit serialises a TAX BREAKDOWN into a string field for members in a region
// that levies one, so the body contains JSON *inside* JSON, and the inner document has a bare
// number in it.
//
// ccxt quotes every bare number before parsing, to keep an 18-digit order id out of a JS
// float. Its regex keys on `":` and does not check whether that quote is escaped, so it
// rewrote the INNER `\":5500,` and produced a body that no longer parses. ccxt swallows the
// SyntaxError, hands back the raw text, and every unified method reads `result.list` off a
// string and returns an EMPTY ARRAY.
//
// Nothing throws. `fetchMyTrades` just says "no fills", attribution can never balance both
// legs, and four real trades (-$45.64, -$4.38, +$12.93, +$30.86) book +$0.00 each.
//
// Run: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-json-hardening.ts
import { hardenJsonParsing } from "../lib/execution/client.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

/** ccxt's own transform, copied from Exchange.onJsonResponse. */
const CCXT_REGEX = /":([+.0-9eE-]+)([,}])/g;
const ccxtQuote = (body: string) => body.replace(CCXT_REGEX, '":"$1"$2');

/** The real row, trimmed to the fields that matter. `extraFees` is verbatim. */
const BODY =
  '{"retCode":0,"retMsg":"OK","result":{"category":"linear","list":[{' +
  '"symbol":"ETHUSDT","orderId":"7b46229e-8268-4366-bef1-64ccfda2a9b0",' +
  '"orderLinkId":"6193709073ca73902c835bbe86c2d2e3","side":"Buy","execPrice":"2395.49",' +
  '"execQty":"0.42","execFee":"0.55335819","execType":"Trade","closedSize":"0.42",' +
  '"seq":463766699022,' +
  '"extraFees":"{\\"AUS_GST\\":{\\"extraFee\\":\\"0.055335819\\",\\"extraFeeRateE8\\":5500,\\"feeCoin\\":\\"USDT\\",\\"feeType\\":\\"AUS_GST\\"}}"' +
  '}]},"time":1792746594547}';

/** A stand-in for the one ccxt property `hardenJsonParsing` reads and the one it replaces. */
type Harnessed = { quoteJsonNumbers: boolean; onJsonResponse(body: unknown): unknown };
const harness = (): Harnessed => {
  const ex = { quoteJsonNumbers: true, onJsonResponse: (body: unknown) => body };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the two members under test
  hardenJsonParsing(ex as any);
  return ex;
};

/** ccxt's parseJson: a SyntaxError becomes `undefined`, and the caller then returns raw text. */
const parseLike = (transformed: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(transformed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const rowsOf = (parsed: Record<string, unknown> | undefined) => {
  const result = parsed?.["result"] as { list?: unknown[] } | undefined;
  return Array.isArray(result?.list) ? result.list : [];
};

console.log("── the body itself is valid JSON; only the transform breaks it ──");
check("Bybit's response parses untouched", parseLike(BODY) !== undefined);
check("it carries exactly one fill", rowsOf(parseLike(BODY)).length === 1);

console.log("\n── ccxt as shipped (4.5.64) ──");
const broken = parseLike(ccxtQuote(BODY));
check("the quoted body no longer parses", broken === undefined);
check("so the fill set reads as EMPTY — the whole bug", rowsOf(broken).length === 0, `${rowsOf(broken).length} fills`);

console.log("\n── hardened ──");
const fixed = parseLike(harness().onJsonResponse(BODY) as string);
check("the quoted body parses", fixed !== undefined);
check("the fill is there", rowsOf(fixed).length === 1, `${rowsOf(fixed).length} fills`);
const fill = rowsOf(fixed)[0] as Record<string, unknown>;
check("it is the order we placed", fill?.orderId === "7b46229e-8268-4366-bef1-64ccfda2a9b0");
check("its clientOid is the one we minted", fill?.orderLinkId === "6193709073ca73902c835bbe86c2d2e3");
check("the tax blob survived intact", typeof fill?.extraFees === "string" && JSON.parse(fill.extraFees as string).AUS_GST.extraFeeRateE8 === 5500);

console.log("\n── precision protection is NOT what was removed ──");
// The reason ccxt quotes numbers at all: a bare 18-digit venue order id loses its last digits
// to a JS float. That must still happen — the fix skips escaped quotes, nothing else.
check("a real bare number is still quoted", fill?.seq === "463766699022", `seq = ${JSON.stringify(fill?.seq)}`);
const bigId = '{"orderId":1488235073529085953,"price":0.000000012345678901}';
const bigParsed = parseLike(harness().onJsonResponse(bigId) as string) as Record<string, unknown>;
check("an 18-digit id survives as a string", bigParsed?.orderId === "1488235073529085953", String(bigParsed?.orderId));
check("a 20-decimal price survives as a string", bigParsed?.price === "0.000000012345678901", String(bigParsed?.price));
check("…and would have been mangled as a float", JSON.parse(bigId).orderId !== 1488235073529085953 || String(JSON.parse(bigId).price) !== "0.000000012345678901");

console.log("\n── the transform is off when ccxt's own switch is off ──");
const plain = harness();
plain.quoteJsonNumbers = false;
check("body passes through untouched", plain.onJsonResponse(BODY) === BODY);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
