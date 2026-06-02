"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { UploadTrayIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/** Functional metrics uploader (drag/drop or browse → records the upload). */
export function UploadMetricsCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [banner, setBanner] = useState<NoticeData | null>(null);

  async function upload(file: File) {
    setBanner(null);
    setPending(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/uploads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Upload failed." });
        return;
      }
      const failed = data.upload.status === "FAILED";
      setBanner({
        type: failed ? "error" : "success",
        message: failed
          ? `${file.name} uploaded but failed validation.`
          : `${file.name} uploaded successfully (${data.upload.version}).`,
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <AdminCard
      title="Upload Metrics"
      subtitle="Upload JSON or CSV files to update bot performance and dashboard metrics."
    >
      {banner && <Notice notice={banner} />}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-[240px] flex-col items-center justify-center gap-6 rounded-xl border border-dashed p-6 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-line bg-background",
        )}
      >
        <UploadTrayIcon size={40} className="text-muted" strokeWidth={2.2} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-white">Drop JSON or CSV files here</span>
          <span className="text-sm text-muted">or click to browse</span>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="flex h-10 items-center justify-center rounded-2xl bg-accent px-4 text-base font-semibold text-[#121212] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Upload File"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </AdminCard>
  );
}
