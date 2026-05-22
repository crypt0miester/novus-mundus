"use client";

import { Toaster, toast } from "sonner";
import { useSettings, type Explorer } from "@/lib/store/settings";

export type ToastType = "success" | "error" | "info" | "gold" | "loading";

const explorerUrls: Record<Explorer, (sig: string) => string> = {
  solscan: (sig) => `https://solscan.io/tx/${sig}`,
  explorer: (sig) => `https://explorer.solana.com/tx/${sig}`,
  solanafm: (sig) => `https://solana.fm/tx/${sig}`,
};

// Left-border accent per type; loading stays neutral — the spinner carries it.
const typeBorder: Record<ToastType, string> = {
  success: "border-l-emerald-500",
  error: "border-l-red-500",
  info: "border-l-blue-500",
  gold: "border-l-gold-500",
  loading: "",
};

/**
 * The game-themed toast card. Pushed via `notify` (lib/notify.tsx) through
 * sonner's `toast.custom`, so sonner owns the lifecycle (stacking, enter/exit
 * animation, swipe-to-dismiss, timers) and this only owns the look.
 *
 * Click anywhere to dismiss; a `signature` turns `message` into a link to the
 * user's chosen block explorer.
 */
export function ToastCard({
  sonnerId,
  type,
  title,
  message,
  signature,
}: {
  sonnerId: string | number;
  type: ToastType;
  title: string;
  message?: string;
  signature?: string;
}) {
  const explorer = useSettings((s) => s.explorer);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex w-[calc(100vw-2rem)] max-w-sm cursor-pointer items-start gap-3 rounded-lg border border-border-default border-l-4 bg-[var(--nm-bg-raised)] p-3 md:w-80 ${typeBorder[type]}`}
      onClick={() => toast.dismiss(sonnerId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") toast.dismiss(sonnerId);
      }}
    >
      {type === "loading" && (
        <span
          aria-hidden
          className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border-default border-t-gold-500"
        />
      )}
      <div className="flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        {message && signature ? (
          <a
            href={explorerUrls[explorer](signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block text-xs text-text-muted underline hover:text-text-secondary"
            onClick={(e) => e.stopPropagation()}
          >
            {message}
          </a>
        ) : message ? (
          <div className="mt-0.5 text-xs text-text-muted">{message}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Global toast viewport. Mounted once in the root layout.
 *
 * Single position (bottom-center): the pre-sonner system used top-right on
 * mobile, but bottom-center reads fine on both and avoids a remount-on-resize
 * hack (sonner takes one static position).
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      gap={8}
      visibleToasts={4}
      toastOptions={{ unstyled: true }}
    />
  );
}
