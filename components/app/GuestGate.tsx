import type { ReactNode } from "react";
import { LockedOverlay } from "@/components/app/LockedOverlay";
import { ScrollLock } from "@/components/app/ScrollLock";

/**
 * Renders a tab's content blurred and inert, with a {@link LockedOverlay} on
 * top — the "preview but locked" state shown to signed-out visitors on any tab
 * other than the public Bot Library.
 */
export function GuestGate({
  title,
  returnTo,
  children,
}: {
  title: string;
  returnTo?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none max-h-[70vh] select-none overflow-hidden blur-[6px] saturate-50 opacity-50">
        {children}
      </div>
      <ScrollLock />
      <LockedOverlay title={title} returnTo={returnTo} />
    </div>
  );
}
