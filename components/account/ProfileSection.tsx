"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { PasswordField } from "@/components/ui/PasswordField";
import { TextField } from "@/components/ui/TextField";

type Initial = { username: string; avatarUrl: string | null };

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

/**
 * Profile Information section. Users can change their name, avatar and password
 * here. The email address has its own section ({@link EmailChangeSection}) because
 * changing it runs through a two-step verification flow.
 */
export function ProfileSection({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
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

    const body: Record<string, string> = {};
    if (username !== initial.username) body.username = username;
    if (password) body.password = password;
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
      setPassword("");
      setBanner({ type: "success", message: "Profile updated." });
      // Refresh so the sidebar (name + avatar) reflects the new values.
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard title="Profile Information">
      <form className="flex flex-col gap-4" onSubmit={save} noValidate>
        {banner && <Notice notice={banner} />}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TextField id="username" label="Username" placeholder="Enter" value={username} onChange={(e) => setUsername(e.target.value)} />

          <PasswordField id="password" label="New Password" placeholder="Enter" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />

          <div className="flex flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Avatar</span>
            <div className="flex items-center gap-4">
              <span
                className="flex size-12 items-center justify-center overflow-hidden rounded-full border border-accent/20 bg-accent/15 bg-cover bg-center text-accent"
                style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
              >
                {!avatar && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" />
                  </svg>
                )}
              </span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border border-line bg-background px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-white"
              >
                Upload Image
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            </div>
          </div>
        </div>

        <PrimaryAction type="submit" disabled={pending}>
          {pending ? "Saving…" : "Update Profile"}
        </PrimaryAction>
      </form>
    </SettingsCard>
  );
}
