import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable identifier for the column. */
  key: string;
  /** Header cell content. */
  header: ReactNode;
  /** Body cell content for one row. */
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /**
   * Extra classes applied to both the header and body cells — widths and
   * responsive hiding (e.g. `"hidden sm:table-cell w-28"`).
   */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional per-row classes, e.g. a self-highlight. */
  rowClassName?: (row: T) => string;
  empty?: ReactNode;
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * A compact, column-driven table styled for the game's theme. Sorting and
 * filtering stay with the caller — this is purely presentational, the table
 * counterpart to a card grid.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty = "Nothing to show.",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-text-muted">{empty}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-surface-raised">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-default">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted",
                  ALIGN[col.align ?? "left"],
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                "border-b border-border-default transition-colors last:border-b-0 hover:bg-surface-overlay/40",
                rowClassName?.(row),
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-3 py-2.5 text-text-secondary",
                    ALIGN[col.align ?? "left"],
                    col.className,
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
