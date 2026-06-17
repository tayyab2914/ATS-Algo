"use client";

import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { cn } from "@/lib/cn";

type Permission = {
  key: string;
  title: string;
  subtitle: string;
};

const PERMISSIONS: Permission[] = [
  { key: "upload", title: "Upload Files Access", subtitle: "Can upload JSON/CSV data files" },
  { key: "editDashboard", title: "Edit Dashboard Access", subtitle: "Can modify dashboard content" },
  { key: "manageBots", title: "Manage Bots Access", subtitle: "Can add, edit, and disable bots" },
  { key: "manageUsers", title: "Manage Users Access", subtitle: "Can invite and manage team members" },
];

/**
 * Role-based access toggles. These describe what non-owner roles are allowed to
 * do; there is no permissions backend yet, so the switches are local UI state,
 * matching the design's owner-only control panel.
 */
export function PermissionsControl() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(PERMISSIONS.map((p) => [p.key, true])),
  );

  return (
    <AdminCard title="Permissions Control" subtitle="Owner Only — Configure role-based access.">
      <div className="flex flex-col">
        {PERMISSIONS.map((permission) => {
          const on = enabled[permission.key];
          return (
            <div
              key={permission.key}
              className="flex items-center justify-between gap-4 border-b border-line/60 py-4 last:border-0"
            >
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-white">{permission.title}</span>
                <span className="text-xs leading-[18px] text-muted">{permission.subtitle}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={permission.title}
                onClick={() => setEnabled((prev) => ({ ...prev, [permission.key]: !prev[permission.key] }))}
                className={cn(
                  "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                  on ? "justify-end bg-accent" : "justify-start bg-line",
                )}
              >
                <span className="size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(10,13,18,0.1)]" />
              </button>
            </div>
          );
        })}
      </div>
    </AdminCard>
  );
}
