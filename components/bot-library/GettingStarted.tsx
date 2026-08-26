import Link from "next/link";

/**
 * The five-step "how do I actually run a bot" panel, above the catalogue.
 *
 * It sits on the Bot Library because that is where a new member lands from the
 * marketing CTA and from the sidebar, and because step 2 happens on this very
 * page — the panel and the thing it describes are in the same view.
 *
 * A plain `<details>`, not a client component: it collapses with no JavaScript,
 * so it costs nothing on a page that is otherwise server-rendered. It ships OPEN,
 * because the member who most needs it is the one who has never seen it, and one
 * click puts it away.
 *
 * The step wording tracks the real controls — "Set Up", "Arm live trading",
 * "Activate Bot" are the literal button labels in My Bots. Rename a button and
 * this has to follow it, or the guide starts describing a screen that no longer
 * exists.
 */

type Step = {
  title: string;
  body: React.ReactNode;
  /** Rendered inside the numbered chip. */
  icon: React.ReactNode;
};

function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8ZM12 17v5" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function PowerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 3v9" />
      <path d="M6.5 6.5a8 8 0 1 0 11 0" />
    </svg>
  );
}

const STEPS: Step[] = [
  {
    title: "Connect your exchange",
    icon: <PlugIcon />,
    body: (
      <>
        In <Link href="/account" className="text-accent underline-offset-2 hover:underline">Account Settings</Link>, add a
        trade-only API key for the exchange you want to trade on.
      </>
    ),
  },
  {
    title: "Add a bot",
    icon: <PlusIcon />,
    body: <>Pick a bot from the library below and add it to your list.</>,
  },
  {
    title: "Set it up",
    icon: <SlidersIcon />,
    body: (
      <>
        In <Link href="/my-bots" className="text-accent underline-offset-2 hover:underline">My Bots</Link> → Non-Active,
        hit <span className="text-white">Set Up</span>: choose your capital allocation and the exchange it should trade
        on, then save.
      </>
    ),
  },
  {
    title: "Arm live trading",
    icon: <ShieldIcon />,
    body: (
      <>
        Back on the bot, switch <span className="text-white">Arm live trading</span> on and confirm. Until you do, the bot
        places no real orders.
      </>
    ),
  },
  {
    title: "Activate",
    icon: <PowerIcon />,
    body: (
      <>
        Press <span className="text-white">Activate Bot</span>. From here it trades your signals automatically — happy
        botting.
      </>
    ),
  },
];

export function GettingStarted() {
  return (
    <details open className="group rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-white">Setting up ATS-ALGO — step by step</h2>
          <p className="text-sm text-muted">Five steps from a fresh account to a bot trading for you.</p>
        </div>
        <span className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>

      <ol className="grid grid-cols-1 gap-4 border-t border-line p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative flex flex-col gap-2">
            {/* The connector, on the one breakpoint where the five steps sit in a row. */}
            {i < STEPS.length - 1 && (
              <span aria-hidden className="absolute left-9 top-4 hidden h-px w-[calc(100%-1.5rem)] bg-line lg:block" />
            )}
            <div className="relative z-[1] flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                {step.icon}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Step {i + 1}</span>
            </div>
            <span className="text-sm font-semibold text-white">{step.title}</span>
            <p className="text-xs leading-[18px] text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
