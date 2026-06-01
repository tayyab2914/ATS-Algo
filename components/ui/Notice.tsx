import { cn } from "@/lib/cn";

export type NoticeData = {
  type: "success" | "error" | "info";
  message: string;
};

const STYLES: Record<NoticeData["type"], string> = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-red-500/30 bg-red-500/10 text-red-400",
  info: "border-accent/30 bg-accent/10 text-accent",
};

/** Inline status banner used across the auth flows. */
export function Notice({ notice }: { notice: NoticeData }) {
  return (
    <p
      role={notice.type === "error" ? "alert" : "status"}
      className={cn("rounded-xl border px-4 py-3 text-xs leading-[18px]", STYLES[notice.type])}
    >
      {notice.message}
    </p>
  );
}
