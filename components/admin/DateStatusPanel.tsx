import { AdminCard } from "@/components/admin/AdminCard";
import { ClockIcon, FileTextIcon, SyncIcon, UploadTrayIcon } from "@/components/admin/admin-icons";

export type StagingStats = {
  lastUpload: string;
  version: string;
  syncStatus: string;
  totalUploads: number;
};

export function DateStatusPanel({ stats }: { stats: StagingStats }) {
  const cards = [
    { label: "Last Upload", value: stats.lastUpload, icon: <ClockIcon size={16} strokeWidth={1.333} /> },
    { label: "File Version", value: stats.version, icon: <FileTextIcon size={16} strokeWidth={1.333} /> },
    { label: "Sync Status", value: stats.syncStatus, icon: <SyncIcon size={16} strokeWidth={1.333} /> },
    { label: "Total Uploads", value: String(stats.totalUploads), icon: <UploadTrayIcon size={16} strokeWidth={1.333} /> },
  ];

  return (
    <AdminCard title="Date Status Panel">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.label}
            className="relative isolate flex min-h-[100px] flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-4"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 z-[2] h-px w-[236px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(40,184,213,0.25),transparent)]"
            />
            <div className="relative z-[1] flex items-center justify-between">
              <span className="text-xs text-muted">{card.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                {card.icon}
              </span>
            </div>
            <span className="relative z-[2] text-sm font-semibold text-white">{card.value}</span>
          </article>
        ))}
      </div>
    </AdminCard>
  );
}
