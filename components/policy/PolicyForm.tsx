"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/**
 * Mandatory Rules & Policy acceptance control. The checkbox must be ticked
 * before the submit button enables; on accept it records consent and forwards
 * the user to wherever they were originally headed (defaults to the dashboard).
 *
 * @param next - Internal path to land on after acceptance.
 */
export function PolicyForm({ next }: { next: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<NoticeData | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreed || pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/account/policy", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError({ type: "error", message: data.error ?? "Could not save your acceptance. Please try again." });
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex w-full flex-col gap-3" onSubmit={handleSubmit}>
      {error && <Notice notice={error} />}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-background/60 p-3 transition-colors hover:border-muted/60">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className={cn(
            "mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-md border-2 border-line bg-white/5 outline-none transition-colors",
            "checked:border-accent checked:bg-accent",
            "checked:bg-[length:14px_14px] checked:bg-center checked:bg-no-repeat",
            "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            "checked:bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%23121212%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M3%208.5l3.5%203.5L13%204.5%22%2F%3E%3C%2Fsvg%3E')]",
          )}
        />
        <span className="text-sm leading-[21px] text-heading">
          I have read, understood, and agree to be bound by the Mandatory Rules &amp; Policy above.
        </span>
      </label>

      <Button type="submit" variant="primary" disabled={!agreed || pending}>
        {pending ? "Saving…" : "Agree & Continue"}
      </Button>
    </form>
  );
}
