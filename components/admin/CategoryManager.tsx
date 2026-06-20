"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/admin/admin-icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

export type CategoryRow = { id: string; name: string; botCount: number };

const inputCls =
  "h-[42px] w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none";

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't create the category." });
        return;
      }
      setNewName("");
      setNotice({ type: "success", message: `Added “${name}”.` });
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function rename(id: string) {
    const name = editValue.trim();
    if (!name) return;
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't rename the category." });
        return;
      }
      setEditingId(null);
      setNotice({ type: "success", message: "Category renamed." });
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function remove(cat: CategoryRow) {
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/categories/${cat.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't delete the category." });
        setDeleting(null);
        return;
      }
      setDeleting(null);
      setNotice({ type: "success", message: `Deleted “${cat.name}”.` });
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
      setDeleting(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard title="Categories" subtitle="Create, rename, or remove the categories bots can be filed under.">
      <div className="flex flex-col gap-5">
        {notice && <Notice notice={notice} />}

        {/* create */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">New category</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Indices"
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={pending || !newName.trim()}
            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            <PlusIcon className="size-4" />
            Add Category
          </button>
        </div>

        {/* list */}
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {categories.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">No categories yet — add one above.</li>
          ) : (
            categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                {editingId === c.id ? (
                  <>
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && rename(c.id)}
                      autoFocus
                      className={cn(inputCls, "max-w-xs")}
                    />
                    <button
                      type="button"
                      onClick={() => rename(c.id)}
                      disabled={pending || !editValue.trim()}
                      className="flex size-8 items-center justify-center rounded-lg border border-accent/50 text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                      title="Save"
                    >
                      <CheckIcon className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-semibold text-white">{c.name}</span>
                    <span className="text-xs text-muted">{c.botCount} bot{c.botCount === 1 ? "" : "s"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditValue(c.name);
                        setNotice(null);
                      }}
                      className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/50 hover:text-accent"
                      title="Rename"
                    >
                      <PencilIcon className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleting(c);
                        setNotice(null);
                      }}
                      className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-red-500/50 hover:text-red-400"
                      title="Delete"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name}”?`}
        description={
          deleting && deleting.botCount > 0
            ? `${deleting.botCount} bot${deleting.botCount === 1 ? "" : "s"} use this category — you'll need to move them first.`
            : "This removes the category. Bots aren't affected."
        }
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </AdminCard>
  );
}
