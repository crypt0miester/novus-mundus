"use client";

import { useNotifications, type NotificationType } from "@/lib/store/notifications";
import { useSettings, type Explorer } from "@/lib/store/settings";

const explorerUrls: Record<Explorer, (sig: string) => string> = {
  solscan: (sig) => `https://solscan.io/tx/${sig}`,
  explorer: (sig) => `https://explorer.solana.com/tx/${sig}`,
  solanafm: (sig) => `https://solana.fm/tx/${sig}`,
};

/** Type indicated by left border color only */
const typeBorder: Record<NotificationType, string> = {
  success: "border-l-emerald-500",
  error: "border-l-red-500",
  info: "border-l-blue-500",
  gold: "border-l-amber-500",
};

export function NotificationToast() {
  const notifications = useNotifications((s) => s.notifications);
  const dismiss = useNotifications((s) => s.dismiss);

  return (
    <div className="fixed right-4 bottom-14 z-[9999] flex flex-col-reverse gap-2">
      {notifications.map((n) => (
        <ToastItem
          key={n.id}
          id={n.id}
          type={n.type}
          title={n.title}
          message={n.message}
          signature={n.signature}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  type,
  title,
  message,
  signature,
  onDismiss,
}: {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  signature?: string;
  onDismiss: (id: string) => void;
}) {
  const explorer = useSettings((s) => s.explorer);

  return (
    <div
      className={`flex max-w-sm cursor-pointer items-start gap-3 rounded-lg border border-border-default border-l-4 bg-[var(--nm-bg-raised)] p-3 ${typeBorder[type]}`}
      onClick={() => onDismiss(id)}
    >
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
