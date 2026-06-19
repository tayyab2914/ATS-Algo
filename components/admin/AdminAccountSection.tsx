"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { UserIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";

type Initial = { name: string; email: string; avatarUrl: string | null };

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

/**
 * Admin "Account Management" card. An admin can update their display name and
 * profile photo; the email is shown but locked (admins sign in by emailed code,
 * and the address is their identity). Saves via the shared profile endpoint,
 * which already ignores any email change.
 */
export function AdminAccountSection({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [avatar, setAvatar] = useState<string | null>(initial.avatarUrl);
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setBanner({ type: "error", message: "Image must be under 1.5 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);

    // Email is intentionally omitted — it can't be changed here.
    const body: Record<string, string> = {};
    if (name.trim() !== initial.name) body.username = name.trim();
    if (avatar && avatar !== initial.avatarUrl) body.avatarUrl = avatar;

    if (Object.keys(body).length === 0) {
      setBanner({ type: "info", message: "No changes to save." });
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Update failed." });
        return;
      }
      setBanner({ type: "success", message: "Account updated." });
      // Refresh so the sidebar profile (name + avatar) reflects the new values.
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard title="Account Management" subtitle="Update your name and photo. Your email can't be changed.">
      <form onSubmit={save} className="flex flex-col gap-6">
        {banner && <Notice notice={banner} />}

        <div className="flex items-center gap-4">
          <span
            className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/30 bg-accent/15 bg-cover bg-center text-accent"
            style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
          >
            {!avatar && <UserIcon className="size-7" />}
          </span>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-fit rounded-xl border border-line bg-background px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-white"
            >
              Upload Image
            </button>
            <p className="text-xs leading-[18px] text-muted">PNG or JPG, up to 1.5 MB.</p>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
          </div>
        </div>

        <div className="flex flex-col gap-6 md:flex-row">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="h-[42px] rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
            />
          </label>

          <label className="flex flex-1 flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Email Address</span>
            <input
              type="email"
              value={initial.email}
              readOnly
              tabIndex={-1}
              aria-disabled="true"
              className="h-[42px] cursor-not-allowed select-none rounded-lg border border-line/60 bg-background/40 px-3 text-sm text-muted focus:outline-none"
            />
            <span className="text-[11px] leading-[16px] text-muted/70">Your email address can&apos;t be changed.</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="flex h-10 w-fit items-center justify-center rounded-2xl bg-accent px-4 text-base font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </AdminCard>
  );
}
