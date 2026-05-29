"use client";

// Anchored player-actions popover triggered by an avatar or name tap in a
// message row. There is no shared popover primitive in the app, so this builds
// a small accessible menu by hand: an absolutely-positioned panel on desktop
// (closes on outside click + Escape) and a BottomSheet on mobile. Item visibility
// is scope-aware: the "Send message" item is hidden when already inside a DM.

import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Map as MapIcon, User, MessageSquare } from "lucide-react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { usePlayerActions } from "@/lib/hooks/usePlayerActions";
import { useAnchoredPopover } from "@/lib/hooks/useAnchoredPopover";

interface PlayerActionsMenuProps {
  // Target PlayerAccount PDA base58.
  playerPda: string;
  // In "dm" scope the sendDm item is hidden (we are already in the DM).
  scope?: "thread" | "dm";
  // The trigger element (avatar or name); the menu anchors to it.
  children: ReactNode;
}

interface MenuItemSpec {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

export function PlayerActionsMenu({ playerPda, scope = "thread", children }: PlayerActionsMenuProps) {
  const { viewOnMap, viewProfile, sendDm } = usePlayerActions(playerPda);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, firstItemRef, menuId, pos } = useAnchoredPopover(open, close);

  const items: MenuItemSpec[] = [
    {
      id: "map",
      label: "View on map",
      icon: <MapIcon className="h-4 w-4" aria-hidden />,
      run: viewOnMap,
    },
    {
      id: "profile",
      label: "View profile",
      icon: <User className="h-4 w-4" aria-hidden />,
      run: viewProfile,
    },
  ];
  if (scope !== "dm") {
    items.push({
      id: "dm",
      label: "Send message",
      icon: <MessageSquare className="h-4 w-4" aria-hidden />,
      run: sendDm,
    });
  }

  const runItem = (run: () => void) => {
    close();
    run();
  };

  const renderItem = (item: MenuItemSpec, index: number) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      ref={index === 0 ? firstItemRef : undefined}
      onClick={() => runItem(item.run)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
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
              aria-label="Player actions"
              style={
                pos
                  ? { position: "fixed", top: pos.top, left: pos.left }
                  : { position: "fixed", top: 0, left: 0, visibility: "hidden" }
              }
              className="z-50 hidden max-w-44 overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg lg:block"
            >
              {items.map(renderItem)}
            </div>,
            document.body,
          )
        : null}

      <BottomSheet open={open} onClose={close} title="Player actions">
        <div role="menu" aria-label="Player actions" className="flex flex-col py-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => runItem(item.run)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
