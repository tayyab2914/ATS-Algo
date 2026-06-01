import { STATS } from "@/lib/content";

/** Social-proof row rendered from {@link STATS}. */
export function StatList() {
  return (
    <ul className="flex w-full flex-wrap items-center gap-x-6 gap-y-2">
      {STATS.map((stat) => (
        <li key={stat.id} className="flex items-center gap-2">
          {stat.indicator && (
            <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
          )}
          <span className="text-sm leading-[21px] text-muted">{stat.label}</span>
        </li>
      ))}
    </ul>
  );
}
