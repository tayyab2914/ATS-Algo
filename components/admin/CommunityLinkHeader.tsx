"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/admin/CopyField";
import { PauseIcon, PlayIcon, TrashIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";
import { communityLinkUrl } from "@/lib/community/slug";

/**
 * The top of a community's page: the link itself, and the switch that opens or
 * closes it.
 *
 * The URL is the largest thing on the screen because it is the thing this page
 * exists to hand over — an admin comes here to copy it far more often than to
 * read a statistic.
 *
 * Pausing is presented as the safe, reversible action and deleting is tucked
 * behind a typed confirmation, because the two are not comparable: a pause stops
 * new registrations, a delete throws away the click history and the attribution
 * for everyone who ever joined.
 */
export function CommunityLinkHeader({
  id,
  name,
  slug,
  active,
  baseUrl,
  signups,
}: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  baseUrl: string;
  /** Shown in the delete confirmation, so the cost is visible before it is paid. */
  signups: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const url = communityLinkUrl(baseUrl, slug);

  async function setActive(next: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/community/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Could not update the link." });
        return;
      }
      setNotice({
        type: "success",
        message: next
          ? "The link is live — new registrations get full access again."
          : "The link is paused. Members who already joined keep their access.",
      });
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/community/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Could not delete the link." });
        setBusy(false);
        return;
      }
      router.push("/admin/community");
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
      setBusy(false);
    }
  }

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-11 -top-10 size-[102px] rounded-full bg-accent/20 blur-3xl"
      />

      <div className="relative flex flex-col gap-4">
        {notice && <Notice notice={notice} />}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Community access link
            </span>
            <h2 className="text-xl font-semibold text-white">{name}</h2>
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
              active ? "bg-success/10 text-success" : "bg-[#F4A825]/10 text-[#F4A825]",
            )}
          >
            <span className={cn("size-2 rounded-full", active ? "bg-success" : "bg-[#F4A825]")} />
            {active ? "Accepting registrations" : "Paused"}
          </span>
        </div>

        {/* The link. Selectable, wrapping, and copyable — it gets pasted into
            Discord and Telegram far more often than it gets read. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-background px-3 py-3">
          <code className="min-w-0 flex-1 break-all font-mono text-sm leading-6 text-white">{url}</code>
          <CopyButton value={url} label="Copy link" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActive(!active)}
            disabled={busy}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50",
              active ? "border border-line text-white" : "bg-accent text-[#06141a]",
            )}
          >
            {active ? <PauseIcon /> : <PlayIcon />}
            {busy ? "Saving…" : active ? "Deactivate" : "Activate"}
          </button>

          <span className="text-xs leading-[18px] text-muted">
            {active
              ? "Anyone with this link can register and gets bot access immediately."
              : "New registrations are refused. Existing members are unaffected."}
          </span>

          <button
            type="button"
            onClick={() => {
              setConfirming((was) => !was);
              setConfirmText("");
            }}
            disabled={busy}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-[#D2031E] transition-colors hover:border-[#D2031E]/40 disabled:opacity-50"
          >
            <TrashIcon />
            Delete
          </button>
        </div>

        {confirming && (
          <div className="flex flex-col gap-3 rounded-xl border border-[#D2031E]/30 bg-[#D2031E]/[0.06] p-4">
            <p className="text-sm leading-[21px] text-white">
              Deleting <span className="font-semibold">{name}</span> removes the URL and its click history for
              good.{" "}
              {signups > 0 && (
                <>
                  The {signups} member{signups === 1 ? "" : "s"} who joined through it keep their accounts and
                  their access — only the attribution is lost.{" "}
                </>
              )}
              Pausing is reversible; this is not.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`Type ${slug} to confirm`}
                className="h-9 min-w-[200px] flex-1 rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-[#D2031E]/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={remove}
                disabled={busy || confirmText.trim() !== slug}
                className="h-9 rounded-lg bg-[#D2031E] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="h-9 rounded-lg border border-line px-4 text-sm font-semibold text-muted transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
