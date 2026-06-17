"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { ChevronDownIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";

/**
 * Promote an existing account to Admin (or back to Member) by email — the design's
 * "Add Team Member" card. There's no email invite: the person must already have
 * an account, which keeps this honest about what the backend can do.
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
        setNotice({ type: "error", message: data?.error ?? "Couldn't update the member." });
        return;
      }
      setNotice({
        type: "success",
        message: `${email} is now ${role === "ADMIN" ? "an admin" : "a member"}.`,
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
    <AdminCard title="Add Team Member">
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

          <label className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Role Selection</span>
            <div className="relative">
              <select
                required
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}
                className="h-[42px] w-full appearance-none rounded-lg border border-line bg-background px-3 pr-10 text-sm text-white focus:border-accent/60 focus:outline-none"
              >
                <option value="" disabled>
                  Select
                </option>
                <option value="ADMIN">Admin</option>
                <option value="USER">Member</option>
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
            </div>
          </label>
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
