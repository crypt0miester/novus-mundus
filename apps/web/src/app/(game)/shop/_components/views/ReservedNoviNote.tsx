import { cn } from "@/lib/utils";

/**
 * Hint shown after a NOVI purchase — purchased NOVI lands in the Reserved
 * balance and must be converted. Rendered once per breakpoint (the mobile and
 * desktop layouts place it at different points in the tree).
 */
export function ReservedNoviNote({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-gold/40 bg-accent/10 px-3 py-2 text-[10px] leading-relaxed text-text-gold w-full",
        className,
      )}
    >
      Purchased NOVI is credited to your <span className="font-semibold">Reserved Novi</span>{" "}
      balance. Convert it to Locked NOVI (Dashboard, or Vault in the Estate)
    </div>
  );
}
