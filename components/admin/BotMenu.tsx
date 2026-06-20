import Link from "next/link";
import type { ReactNode } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { FolderIcon, PlusIcon } from "@/components/admin/admin-icons";
import { cn } from "@/lib/cn";

type Action = {
  title: string;
  subtitle: string;
  Icon: (p: { className?: string }) => ReactNode;
  href?: string;
};

const ACTIONS: Action[] = [
  { title: "Add New Bot", subtitle: "Create a new bot entry", Icon: PlusIcon, href: "/admin/bots/new" },
  { title: "Update Categories", subtitle: "Manage bot categories", Icon: FolderIcon, href: "/admin/bots/categories" },
];

const cardCls =
  "flex items-start gap-4 rounded-2xl border border-line bg-background p-4 text-left transition-colors";

function CardInner({ title, subtitle, Icon, soon }: Action & { soon?: boolean }) {
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon />
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {title}
          {soon && <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">Soon</span>}
        </span>
        <span className="text-xs text-muted">{subtitle}</span>
      </span>
    </>
  );
}

export function BotMenu() {
  return (
    <AdminCard title="Dashboard Content Control">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ACTIONS.map((action) =>
          action.href ? (
            <Link key={action.title} href={action.href} className={cn(cardCls, "hover:border-accent/40")}>
              <CardInner {...action} />
            </Link>
          ) : (
            <div key={action.title} className={cn(cardCls, "cursor-not-allowed opacity-60")} aria-disabled>
              <CardInner {...action} soon />
            </div>
          ),
        )}
      </div>
    </AdminCard>
  );
}
