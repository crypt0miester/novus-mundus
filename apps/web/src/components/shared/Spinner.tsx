import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpinnerProps {
  className?: string;
  // Announced to assistive tech; defaults to a generic loading message.
  label?: string;
}

// Accessible loading spinner — wraps lucide's Loader2 with a live status role
// so screen readers announce the loading state.
export function Spinner({ className, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" aria-label={label} className="inline-flex">
      <Loader2 className={cn("h-4 w-4 shrink-0 animate-spin", className)} aria-hidden="true" />
    </span>
  );
}
