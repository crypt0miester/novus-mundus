"use client";

// Anchored per-bubble message-actions popover. Mirrors PlayerActionsMenu: an
// absolutely-positioned panel on desktop (closes on outside mousedown + Escape)
// and a BottomSheet on mobile. Unlike PlayerActionsMenu this is controlled by
// the bubble (open/onOpenChange) so a desktop hover button AND a mobile
// long-press can both drive the same menu.
//
// Items are context-gated by the caller-provided flags: React (opens the emoji
// picker in place), Reply, Copy, Pin/Unpin (when canPin), and Delete (own,
// non-tombstoned). Reactions and pins are off-chain folds, so every action just
// forwards to a callback the renderer wires to the useWarTable helpers.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SmilePlus, Reply, Copy, Pin, PinOff, Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import type { WtMessage } from "@/lib/store/war-table";
import { REACTION_EMOJI } from "@/components/war-table/reactions";
import { useAnchoredPopover } from "@/lib/hooks/useAnchoredPopover";
import { cn } from "@/lib/utils";

interface MessageActionsMenuProps {
  msg: WtMessage;
  // true when the connected wallet posted this message (gates Delete).
  mine: boolean;
  // officer-or-own for team, own otherwise (computed upstream); gates Pin/Unpin.
  canPin: boolean;
  // current thread pin target hex; flips Pin/Unpin and avoids a re-pin.
  pinnedId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // post a kind=5 reaction (parent = msg.id, body = emoji).
  onReact: (emoji: string) => void;
  // set the reply target upstream (the composer chip handles the actual post).
  onReply: () => void;
  // post a kind=6 pin (parent = msg.id).
  onPin: () => void;
  // post a kind=6 pin with a zero parent (unpin).
  onUnpin: () => void;
  // post a kind=4 tombstone (parent = msg.id), hiding the message for others.
  onDelete: () => void;
  // the desktop trigger affordance (the hover button rendered by the bubble).
  children: ReactNode;
}

interface MenuItemSpec {
  id: string;
  label: string;
  icon: ReactNode;
  // when true the item switches the panel to the emoji picker view instead of
  // running + closing.
  toPicker?: boolean;
  run?: () => void;
}

export function MessageActionsMenu({
  msg,
  mine,
  canPin,
  pinnedId,
  open,
  onOpenChange,
  onReact,
  onReply,
  onPin,
  onUnpin,
  onDelete,
  children,
}: MessageActionsMenuProps) {
  // "menu" lists the actions; "react" swaps the body for the 6-emoji picker.
  const [view, setView] = useState<"menu" | "react">("menu");
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  // `view` is the recalc key: the menu/picker swap resizes the panel, so it
  // must re-measure its anchored position.
  const { triggerRef, panelRef, firstItemRef, menuId, pos } = useAnchoredPopover(
    open,
    close,
    view,
  );

  // Reset to the menu view whenever the popover closes, so the next open never
  // lands mid-picker.
  useEffect(() => {
    if (!open) setView("menu");
  }, [open]);

  // Build the context-gated item list. Reactions/Reply/Copy apply to any
  // non-locked, non-tombstoned message (the bubble only mounts this menu for
  // such messages, but stay defensive).
  const actionable = !msg.locked && !msg.tombstoned;
  const items: MenuItemSpec[] = [];
  if (actionable) {
    items.push({
      id: "react",
      label: "React",
      icon: <SmilePlus className="h-4 w-4" aria-hidden />,
      toPicker: true,
    });
    items.push({
      id: "reply",
      label: "Reply",
      icon: <Reply className="h-4 w-4" aria-hidden />,
      run: onReply,
    });
    items.push({
      id: "copy",
      label: "Copy",
      icon: <Copy className="h-4 w-4" aria-hidden />,
      run: () => {
        void navigator.clipboard.writeText(msg.body);
      },
    });
  }
  if (canPin && actionable) {
    if (pinnedId === msg.id) {
      items.push({
        id: "unpin",
        label: "Unpin",
        icon: <PinOff className="h-4 w-4" aria-hidden />,
        run: onUnpin,
      });
    } else {
      items.push({
        id: "pin",
        label: "Pin",
        icon: <Pin className="h-4 w-4" aria-hidden />,
        run: onPin,
      });
    }
  }
  if (mine && !msg.tombstoned) {
    items.push({
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" aria-hidden />,
      run: onDelete,
    });
  }

  const runItem = (item: MenuItemSpec) => {
    if (item.toPicker) {
      setView("react");
      return;
    }
    close();
    item.run?.();
  };

  const pickEmoji = (emoji: string) => {
    close();
    onReact(emoji);
  };

  // Desktop list item. The first item carries firstItemRef for the focus guard.
  const renderItem = (item: MenuItemSpec, index: number) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      ref={index === 0 ? firstItemRef : undefined}
      onClick={() => runItem(item)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );

  // Mobile list item (bigger touch targets, matching PlayerActionsMenu).
  const renderSheetItem = (item: MenuItemSpec) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      onClick={() => runItem(item)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );

  // The emoji picker body: one row of the curated set. Shared between the
  // desktop panel and the BottomSheet via this render helper. The row scrolls
  // horizontally (no-scrollbar) so it never clips against the panel's max width
  // and stays usable if the set grows.
  const renderPicker = (size: "panel" | "sheet") => (
    <div
      className={cn(
        "no-scrollbar flex items-center gap-1 overflow-x-auto",
        size === "panel" ? "px-2 py-2" : "justify-around px-3 py-2",
      )}
    >
      {REACTION_EMOJI.map((e) => (
        <button
          key={e.key}
          type="button"
          aria-label={e.name}
          onClick={() => pickEmoji(e.emoji)}
          className="shrink-0 rounded p-1 text-xl leading-none transition-colors hover:bg-surface-overlay"
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpenChange(!open)}
        className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label="Message actions"
              style={
                pos
                  ? { position: "fixed", top: pos.top, left: pos.left }
                  : { position: "fixed", top: 0, left: 0, visibility: "hidden" }
              }
              className={cn(
                "z-9999 hidden overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg lg:block",
                // The react row needs room for the full emoji set; the action
                // list stays narrow. Both are shrink-to-fit, so this is a ceiling.
                view === "react" ? "max-w-72" : "max-w-48",
              )}
            >
              {view === "react" ? renderPicker("panel") : items.map(renderItem)}
            </div>,
            document.body,
          )
        : null}

      <BottomSheet open={open} onClose={close} title="Message actions">
        {/* Mobile shows the reaction row pinned at the top (native pattern), so
            taps land on emoji directly without the desktop two-step view swap
            that re-measures the sheet mid-open. The "React" item is dropped here
            since the row replaces it. */}
        <div role="menu" aria-label="Message actions" className="flex flex-col">
          {actionable && (
            <div className="border-b border-border-default pb-1">{renderPicker("sheet")}</div>
          )}
          <div className="flex flex-col py-1">
            {items.filter((item) => !item.toPicker).map(renderSheetItem)}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
