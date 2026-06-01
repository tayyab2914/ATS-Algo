/** Section title with optional subtitle. */
export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold leading-6 text-white">{title}</h2>
      {subtitle && <p className="text-sm leading-[21px] text-muted">{subtitle}</p>}
    </div>
  );
}
