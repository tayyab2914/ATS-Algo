import { Segmented } from "@/components/dashboard/Segmented";
import { TrendArrow } from "@/components/dashboard/icons";
import { PH, TOP_ASSETS } from "@/lib/dashboard-data";

export function TopAssets() {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-base font-semibold leading-6 text-white">Top Assets Performance</h2>
        <Segmented options={["Last 7 Days", "Last 4 Weeks", "Last 12 Months"]} />
      </div>

      <ul className="flex flex-col">
        {TOP_ASSETS.map((asset) => (
          <li
            key={asset.id}
            className="flex items-center justify-between border-b border-line/60 py-4 last:border-0"
          >
            <span className="text-sm text-white">{asset.pair}</span>
            <div className="flex items-center gap-6">
              <span
                className={`flex items-center gap-1 text-sm font-medium ${
                  asset.positive ? "text-success" : "text-[#D2031E]"
                }`}
              >
                <TrendArrow up={asset.positive} />
                {PH}
              </span>
              <span className="w-14 text-right text-sm text-muted">{PH}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
