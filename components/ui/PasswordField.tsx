"use client";

import { type InputHTMLAttributes, type SVGProps, useState } from "react";
import { cn } from "@/lib/cn";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  id: string;
  label: string;
};

/**
 * Labelled password input with a show/hide toggle. Mirrors {@link TextField}'s
 * look and props, but adds an eye button that flips the input between masked and
 * plain text. The toggle is `type="button"` so it never submits the form.
 */
export function PasswordField({ id, label, className, disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-xs leading-[18px] text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          disabled={disabled}
          className={cn(
            "h-[42px] w-full rounded-lg border border-line bg-background px-2 pr-10 text-sm leading-[21px] text-white placeholder-muted outline-none transition focus:border-accent",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-40"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M10.6 6.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a16.4 16.4 0 0 1-3 3.7M6.6 6.6A16.4 16.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </svg>
  );
}
