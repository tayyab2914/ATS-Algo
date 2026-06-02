import { AdminCard } from "@/components/admin/AdminCard";
import { cn } from "@/lib/cn";

export type UploadRow = {
  filename: string;
  date: string;
  version: string;
  status: "SUCCESS" | "FAILED";
};

export function UploadHistoryTable({ rows }: { rows: UploadRow[] }) {
  return (
    <AdminCard title="Upload History">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No uploads yet — upload a JSON or CSV file above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold text-muted">
                <th className="px-4 py-3 font-semibold">File</th>
                <th className="px-4 py-3 text-center font-semibold">Date</th>
                <th className="px-4 py-3 text-center font-semibold">Version</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.filename}-${index}`} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">{row.filename}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{row.date}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{row.version}</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        row.status === "SUCCESS" ? "text-success" : "text-[#D2031E]",
                      )}
                    >
                      {row.status === "SUCCESS" ? "Success" : "Failed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}
