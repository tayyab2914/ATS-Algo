"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PlusIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { normalizeSlug, slugProblem } from "@/lib/community/slug";

/**
 * "Create a community link" — a name, and the URL it produces.
 *
 * The slug is shown as a live preview of the full URL rather than as a second
 * field the admin has to think about, because the name is almost always the
 * right answer ("House of Crypto" → `/house-of-crypto`). It stays EDITABLE
 * behind a disclosure for the case the community wants something shorter than
 * their name, which is exactly the `ats-algo.com/houseofcrypt` example this was
 * asked for.
 *
 * Validation runs client-side purely so the admin sees the problem before
 * submitting; `POST /api/admin/community` re-derives and re-checks the slug
 * regardless — see `lib/community/slug.ts`.
 */
export function CommunityLinkCreate({ baseUrl }: { baseUrl: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);

  // What the URL will actually be: the typed slug when the admin has taken it
  // over, otherwise whatever the name normalises to.
  const slug = normalizeSlug(editingSlug && customSlug ? customSlug : name);
  const problem = slug ? slugProblem(slug) : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!name.trim()) {
      setNotice({ type: "error", message: "Give the community a name." });
      return;
    }
    if (problem) {
      setNotice({ type: "error", message: problem });
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/admin/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Could not create the link. Please try again." });
        return;
      }
      setNotice({ type: "success", message: `${name.trim()} is live at /${slug}.` });
      setName("");
      setCustomSlug("");
      setEditingSlug(false);
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard
      title="Create a community link"
      subtitle="Everyone who registers through the link becomes a full member — no per-person approval."
    >
      {notice && <Notice notice={notice} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Community name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="House of Crypto"
              maxLength={60}
              className="h-11 rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={pending || !name.trim() || Boolean(problem)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-[#06141a] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <PlusIcon />
            {pending ? "Creating…" : "Create reflink"}
          </button>
        </div>

        {/* The URL preview. This is the thing being created, so it is shown at
            full size rather than hidden behind the submit. */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
          <span className="text-xs font-semibold text-muted">Link</span>

          {editingSlug ? (
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <span className="text-muted">{baseUrl}/</span>
              <input
                value={customSlug}
                onChange={(e) => setCustomSlug(e.target.value)}
                placeholder={normalizeSlug(name) || "houseofcrypto"}
                maxLength={80}
                autoFocus
                className="h-8 min-w-[160px] flex-1 rounded-md border border-line bg-surface px-2 text-sm text-white placeholder:text-muted/60 focus:border-accent/60 focus:outline-none"
              />
            </div>
          ) : (
            <span className="break-all font-mono text-sm text-white">
              {baseUrl}/<span className="text-accent">{slug || "…"}</span>
            </span>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {problem ?? "Share this URL with the community — anyone who signs up through it gets full access."}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingSlug((was) => !was);
                if (!editingSlug) setCustomSlug(normalizeSlug(name));
              }}
              className="shrink-0 text-xs font-semibold text-accent underline-offset-4 hover:underline"
            >
              {editingSlug ? "Use the name" : "Customise"}
            </button>
          </div>
        </div>
      </form>
    </AdminCard>
  );
}
