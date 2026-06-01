import { Segmented } from "@/components/dashboard/Segmented";
import { SectionHeading } from "@/components/dashboard/SectionHeading";
import { MY_BOTS, PH } from "@/lib/dashboard-data";

export function MyBotsPerformance() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading title="My Bots Performance" subtitle="Top bots currently running in your personal portfolio." />
        <div className="flex items-center gap-4">
          <Segmented options={["Daily", "Weekly", "Monthly", "Yearly"]} />
          <button type="button" className="text-sm font-semibold text-accent">
            Open My Bots
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {MY_BOTS.map((bot) => (
          <article key={bot.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
            <span className="text-sm font-semibold text-white">{bot.name}</span>
            <div className="flex flex-col gap-3">
              <Row label="Profile" value={bot.profile} />
              <Row label="Capital" value={PH} />
              <Row label="P&L" value={PH} valueClass={bot.pnlPositive ? "text-success" : "text-[#D2031E]"} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Row({ label, value, valueClass = "text-white" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
