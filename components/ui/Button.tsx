import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-[#121212] hover:opacity-90",
  outline: "border border-accent text-accent hover:bg-accent/10",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

/**
 * Full-width action button matching the design's 48px / rounded-2xl spec.
 * `primary` is the filled cyan CTA; `outline` is the bordered secondary action.
 */
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "flex h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold leading-6 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
