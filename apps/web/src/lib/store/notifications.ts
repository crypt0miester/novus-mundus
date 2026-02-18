import { create } from "zustand";

export type NotificationType = "success" | "error" | "info" | "gold";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  signature?: string;
}

interface NotificationStore {
  notifications: Notification[];
  add: (n: Omit<Notification, "id">) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useNotifications = create<NotificationStore>((set) => ({
  notifications: [],

  add: (n) => {
    const id = `notif-${++nextId}`;
    const duration = n.duration ?? 4000;

    set((s) => ({
      notifications: [...s.notifications, { ...n, id }],
    }));

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({
          notifications: s.notifications.filter((x) => x.id !== id),
        }));
      }, duration);
    }
  },

  dismiss: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((x) => x.id !== id),
    })),
}));
