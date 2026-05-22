"use client";

import { toast } from "sonner";
import { ToastCard, type ToastType } from "@/components/layout/Toast";

export interface NotifyOptions {
  title: string;
  message?: string;
  /** Tx signature — renders `message` as a link to the user's chosen explorer. */
  signature?: string;
  /** Existing toast id to update in place (loading → result morph). */
  id?: string | number;
  /** ms; 0 keeps it sticky. Defaults: 4s, or sticky while loading. */
  duration?: number;
}

function show(type: ToastType, opts: NotifyOptions): string | number {
  return toast.custom(
    (t) => (
      <ToastCard
        sonnerId={t}
        type={type}
        title={opts.title}
        message={opts.message}
        signature={opts.signature}
      />
    ),
    {
      id: opts.id,
      duration: opts.duration ?? (type === "loading" ? Infinity : 4000),
    },
  );
}

/**
 * App notifications — a thin wrapper over sonner that renders the game-themed
 * {@link ToastCard}. Callable outside React (e.g. react-query mutation
 * callbacks), since it only touches sonner's imperative API.
 *
 * Pass an existing toast `id` to morph it in place — e.g. a `loading` toast
 * fired on submit, updated to `gold`/`error` once the tx settles:
 *
 *   const id = notify.loading({ title: "Confirming transaction…" });
 *   notify.gold({ id, title: "Confirmed", message, signature });
 */
export const notify = {
  success: (o: NotifyOptions) => show("success", o),
  error: (o: NotifyOptions) => show("error", o),
  info: (o: NotifyOptions) => show("info", o),
  gold: (o: NotifyOptions) => show("gold", o),
  loading: (o: NotifyOptions) => show("loading", o),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
