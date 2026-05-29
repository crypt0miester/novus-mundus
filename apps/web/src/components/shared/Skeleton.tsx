import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

// Token-based shimmer placeholder for content that is still loading.
// Routes through the surface tokens so it tracks the paper/dark switch.
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-overlay", className)}
    />
  );
}
