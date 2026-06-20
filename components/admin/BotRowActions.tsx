"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EyeIcon, PencilIcon, TrashIcon } from "@/components/admin/admin-icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** Per-row Edit link + Delete button (with confirmation) for the bots table. */
export function BotRowActions({ botId, botName }: { botId: string; botName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function onDelete() {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/bots/${botId}`, { method: "DELETE" });
      if (!res.ok) {
        setPending(false);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Link
        href={`/admin/bots/${botId}`}
        aria-label={`View ${botName}`}
        title="View details"
        className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/50 hover:text-accent"
      >
        <EyeIcon className="size-4" />
      </Link>
      <Link
        href={`/admin/bots/${botId}/edit`}
        aria-label={`Edit ${botName}`}
        title="Edit / update"
        className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/50 hover:text-accent"
      >
        <PencilIcon className="size-4" />
      </Link>
      <button
        type="button"
        aria-label={`Delete ${botName}`}
        title="Delete"
        onClick={() => setConfirming(true)}
        className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-red-500/50 hover:text-red-400"
      >
        <TrashIcon className="size-4" />
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Delete ${botName}?`}
        description="This permanently removes the bot, its backtest results, and its change history. This can't be undone."
        confirmLabel="Delete bot"
        pending={pending}
        onConfirm={onDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
