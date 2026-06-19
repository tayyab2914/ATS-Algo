"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { CheckIcon, ChevronDownIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

type Role = "" | "ADMIN" | "USER";

const ROLE_OPTIONS: { value: "ADMIN" | "USER"; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "USER", label: "Member" },
];

/**
 * Themed role picker. A native `<select>` can't be styled to match the dark
 * theme and its popup would be clipped by the card's `overflow-hidden`, so this
 * renders a custom menu positioned `fixed` to the trigger (escaping the clip).
 */
function RoleDropdown({ value, onChange }: { value: Role; onChange: (role: "ADMIN" | "USER") => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on Escape, and on scroll/resize (a fixed menu would otherwise detach).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function reposition() {
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    setOpen(true);
  }

  const selected = ROLE_OPTIONS.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[42px] w-full items-center justify-between rounded-lg border border-line bg-background px-3 text-sm text-white transition-colors focus:border-accent/60 focus:outline-none"
      >
        <span className={selected ? "text-white" : "text-muted"}>{selected?.label ?? "Select"}</span>
        <ChevronDownIcon className={cn("size-5 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && anchor && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="listbox"
            style={{ position: "fixed", top: anchor.top, left: anchor.left, width: anchor.width }}
            className="z-50 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
          >
            {ROLE_OPTIONS.map((opt) => {
              const active = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/5",
                    active && "bg-white/5",
                  )}
                >
                  {opt.label}
                  {active && <CheckIcon className="size-4 text-accent" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/**
 * "Add Team Member" card. Invite someone by email: admins are emailed an admin
 * sign-in link, members an account-creation link — both pre-filled with their
 * address. The backend rejects an email that already has an account.
 */
export function AddTeamMember() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"" | "ADMIN" | "USER">("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!role) {
      setNotice({ type: "error", message: "Choose a role for the member." });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't send the invite." });
        return;
      }
      setNotice({
        type: "success",
        message:
          role === "ADMIN"
            ? `Admin invite sent to ${email}. They can sign in at the admin page.`
            : `Invite sent to ${email}. They've been asked to create their account.`,
      });
      setEmail("");
      setRole("");
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard
      title="Add Team Member"
      subtitle="Invite by email — admins receive an admin sign-in link, members are asked to create an account."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {notice && <Notice notice={notice} />}

        <div className="flex flex-col gap-6 md:flex-row">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Email Address</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter"
              className="h-[42px] rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
            />
          </label>

          <div className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Role Selection</span>
            <RoleDropdown value={role} onChange={setRole} />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="flex h-10 w-fit items-center justify-center rounded-2xl bg-accent px-4 text-base font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Invite Member"}
        </button>
      </form>
    </AdminCard>
  );
}
