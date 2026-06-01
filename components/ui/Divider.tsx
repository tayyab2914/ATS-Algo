/** Horizontal rule with a centred label, e.g. "or continue with". */
export function Divider({ label }: { label: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span className="text-xs leading-[18px] text-muted">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}
