import { AdminCard } from "@/components/admin/AdminCard";
import { FolderIcon, PencilIcon, PlusIcon, ToggleIcon } from "@/components/admin/admin-icons";

const ACTIONS = [
  { title: "Add New Bot", subtitle: "Create a new bot entry", Icon: PlusIcon },
  { title: "Edit Bot Metrics", subtitle: "Update existing bot data", Icon: PencilIcon },
  { title: "Update Categories", subtitle: "Manage bot categories", Icon: FolderIcon },
  { title: "Enable/Disable Bots", subtitle: "Toggle bot visibility", Icon: ToggleIcon },
];

export function ContentControl() {
  return (
    <AdminCard title="Dashboard Content Control">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ACTIONS.map(({ title, subtitle, Icon }) => (
          <button
            key={title}
            type="button"
            className="flex items-start gap-4 rounded-2xl border border-line bg-background p-4 text-left transition-colors hover:border-accent/40"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-white">{title}</span>
              <span className="text-xs text-muted">{subtitle}</span>
            </span>
          </button>
        ))}
      </div>
    </AdminCard>
  );
}
