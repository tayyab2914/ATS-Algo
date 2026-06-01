import { SectionHeading } from "@/components/dashboard/SectionHeading";
import { TAG_ICONS } from "@/components/dashboard/icons";
import { PH, TOP_BOTS } from "@/lib/dashboard-data";

const TAGS = [
  { icon: TAG_ICONS.strategy, label: "Scalping" },
  { icon: TAG_ICONS.clock, label: "5m" },
  { icon: TAG_ICONS.risk, label: "Medium" },
];

export function TopActiveBots() {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="Top Active Bots" subtitle="Best performing bots currently active across the platform." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TOP_BOTS.map((bot) => (
          <article
            key={bot.id}
            className="relative isolate flex flex-col gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-4"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
            />
            <div className="relative z-[1] flex items-start justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-white">{bot.name}</span>
                <span className="text-xs text-muted">{bot.pair}</span>
              </div>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{PH}</span>
            </div>

            <div className="relative z-[1] flex items-center gap-4">
              {TAGS.map((tag) => (
                <span key={tag.label} className="flex items-center gap-1.5 text-xs text-muted">
                  <tag.icon className="text-accent" />
                  {tag.label}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
