import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
};

/**
 * Labelled text input. The label is associated via `htmlFor`/`id`, and the
 * field inherits the design's 42px height, subtle border and accent focus ring.
 */
export function TextField({ id, label, className, ...props }: TextFieldProps) {
  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-xs leading-[18px] text-muted">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "h-[42px] w-full rounded-lg border border-line bg-background px-2 text-sm leading-[21px] text-white placeholder-muted outline-none transition focus:border-accent",
          className,
        )}
        {...props}
      />
    </div>
  );
}
