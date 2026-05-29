import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  // A lucide icon component, rendered decoratively above the title.
  icon?: LucideIcon;
  title: string;
  description?: string;
  // Optional call-to-action (a button, link, etc.).
  action?: ReactNode;
  className?: string;
}

// Accessible empty / zero-result state. Announces itself politely so screen
// readers pick up the change when a list resolves to nothing.
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-text-muted" aria-hidden="true" />}
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
