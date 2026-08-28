/**
 * "How to create an API key" — one walkthrough per venue, shown in Account →
 * Exchange API Connections behind each venue's "Full guide" link.
 *
 * The wording is transcribed verbatim from the client's own step-by-step
 * documents ("API set up for <venue>"), and the screenshots are the images out of
 * those same files, exported to `public/guides/<venue>/step-N.png` — `image`
 * numbers therefore match the step they illustrate, not an upload order.
 *
 * In-app rather than a linked PDF, on purpose: a PDF opens a second surface the
 * member has to read next to the form they are filling in, it cannot deep-link the
 * exact field they are stuck on, and it goes stale silently. This lives beside the
 * inputs and ships with the code that renders them.
 *
 * Keyed by the venue's `BotExchange.value` LOWER-CASED, so a venue with no guide
 * simply has no link rather than a dead one.
 */
export type GuideStep = {
  /** One instruction. Rendered as plain text; quoted UI labels are the venue's own. */
  text: string;
  /** Screenshot for this step, or undefined where the source document had none. */
  image?: string;
};

export type ExchangeGuide = {
  /** Heading, e.g. "ATS-ALGO × BloFin". */
  title: string;
  steps: GuideStep[];
  /**
   * A caveat shown above the steps, where the source document leaves something
   * unresolved. Empty for a guide that is complete.
   */
  note?: string;
};

/** The last step is the same on every venue, so it is written once. */
const paste = (venue: string): GuideStep => ({
  text: `Copy your API Key and API Secret Key, then paste them into ATS-ALGO → Account Settings → ${venue} exchange connection.`,
});

export const EXCHANGE_GUIDES: Record<string, ExchangeGuide> = {
  bybit: {
    title: "ATS-ALGO × Bybit",
    // Bybit runs two separate platforms behind one brand and a member with an EU
    // account will otherwise follow these steps on the wrong one, ending with a key
    // that authenticates against nothing we trade.
    note: "Use the global site, bybit.com. Bybit's EU platform (bybit.eu) is a separate account and is not supported yet.",
    steps: [
      { text: "Log in to your Bybit account on bybit.com, or register one." },
      { text: 'Move your cursor over your profile icon and select "API".', image: "/guides/bybit/step-2.png" },
      { text: 'Press "Create New Key".', image: "/guides/bybit/step-3.png" },
      // NOT the "Connect to Third-Party Applications" route, and NOT CCXT — that
      // pairing belongs to BloFin and was copied here by mistake. On Bybit it issues
      // a key bound to someone else's integration, which our orders are rejected
      // against, so the guide names the System-generated key and nothing else.
      { text: 'Choose the "System-generated API Keys" option.', image: "/guides/bybit/step-4.png" },
      { text: "Name the key, enable its trading permissions — a read-only key cannot place orders — and add IP addresses for whitelisting if you have them. Then create the key and pass the security verification." },
      paste("Bybit"),
    ],
  },
  bitget: {
    title: "ATS-ALGO × Bitget",
    steps: [
      { text: "Log in to your Bitget account, or register one." },
      { text: 'Move your cursor over your profile icon and select "API Keys".', image: "/guides/bitget/step-2.png" },
      { text: 'Select "Create API Key".', image: "/guides/bitget/step-3.png" },
      {
        text: 'Create an API name (Note) and a Passphrase — you will need that passphrase when connecting the API to ATS-ALGO. Enable "Read-write" in the Permission settings field.',
        image: "/guides/bitget/step-4.png",
      },
      {
        text: 'In Permission type, choose between "Futures" and "Spot". For Futures, select "Orders" and "Holdings". For Spot, select "Trade".',
        image: "/guides/bitget/step-5.png",
      },
      {
        text: 'For both Futures and Spot you also need to select "Manage" in the Sub-accounts section. Provide IP addresses if available, then click "Next".',
        image: "/guides/bitget/step-6.png",
      },
      paste("Bitget"),
    ],
  },
  blofin: {
    title: "ATS-ALGO × BloFin",
    steps: [
      { text: "Log in to your BloFin account, or register one." },
      { text: 'Click on the profile icon and select "API".', image: "/guides/blofin/step-2.png" },
      { text: 'Press "Create API Key".', image: "/guides/blofin/step-3.png" },
      {
        text: 'Select "Connect to Third-Party Applications" and choose "CCXT". Then write your API Key name, enable the "Trade" permission, set a Passphrase and add IP addresses for whitelisting. Click "Next" and pass the security verification.',
        image: "/guides/blofin/step-4.png",
      },
      paste("BloFin"),
    ],
  },
  bingx: {
    title: "ATS-ALGO × BingX",
    steps: [
      { text: "Log in to your BingX account, or register one." },
      { text: 'Select the profile icon (top right) and click "API Management".', image: "/guides/bingx/step-2.png" },
      { text: 'Click "Create API".', image: "/guides/bingx/step-3.png" },
      {
        text: 'Select "Spot Trading" if you want to trade Spot, or "Perpetual Futures Trading" for Futures. Provide a whitelisted IP and select "Create".',
        image: "/guides/bingx/step-4.png",
      },
      paste("BingX"),
    ],
  },
};

/** The walkthrough for a venue, or null when there isn't one. */
export function guideFor(exchange: string): ExchangeGuide | null {
  return EXCHANGE_GUIDES[exchange.toLowerCase()] ?? null;
}
