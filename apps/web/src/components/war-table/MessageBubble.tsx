"use client";

// MessageBubble: one chat bubble in the iOS-Messages layout used by
// ThreadRenderer. It draws own (right, accent fill) vs received (left, neutral
// fill) bubbles, group-aware corner rounding, the once-per-group received
// avatar + sender name, a once-per-group subtle timestamp, the pending/delivered
// state, locked/tombstoned placeholders, and a reply quote strip.
//
// Identity: a message carries the sender WALLET. The avatar resolves the wallet
// to a PlayerAccount PDA internally; the name header and the actions menu need
// the PDA, so useSenderIdentity derives it here (the same derivation PlayerAvatar
// does) and is exported for ThreadRenderer to reuse.

import { useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Check, CornerDownRight, Lock, LoaderCircle, MoreHorizontal } from "lucide-react";
import { WtKind } from "novus-mundus-sdk";
import { derivePlayerPda } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { PlayerName } from "@/components/war-table/PlayerName";
import { PlayerAvatar } from "@/components/war-table/PlayerAvatar";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { usePlayerPresence } from "@/lib/hooks/usePresence";
import { PlayerActionsMenu } from "@/components/war-table/PlayerActionsMenu";
import { MessageActionsMenu } from "@/components/war-table/MessageActionsMenu";
import { ReactionRow } from "@/components/war-table/ReactionRow";
import type { WtMessage } from "@/lib/store/war-table";
import { cn } from "@/lib/utils";

// Long-press window (ms) before a touch opens the actions menu on mobile.
const LONG_PRESS_MS = 450;
// Movement (px) past which a touch is treated as a scroll, not a long-press, so
// scrolling the thread never opens a menu.
const LONG_PRESS_MOVE_TOLERANCE = 10;

const LOCKED_PLACEHOLDER = "[Message from before you joined]";
const TOMBSTONE_PLACEHOLDER = "[Message removed]";

export function placeholderFor(msg: WtMessage): string {
  if (msg.tombstoned) return TOMBSTONE_PLACEHOLDER;
  return LOCKED_PLACEHOLDER;
}

// Position of a bubble within its visual group; drives corner rounding.
export type GroupPos = "single" | "first" | "middle" | "last";

// Derive the sender's PlayerAccount PDA base58 from the signing wallet, the same
// way PlayerAvatar resolves it. Returns null until the chain client is ready or
// when the wallet string is malformed (real not-loaded states, not shims). The
// PDA is deterministic, so the menu and name header can key off it directly.
export function useSenderIdentity(wallet: string): string | null {
  const client = useNovusMundusClient();
  const gameEngine = client.gameEngine;

  return useMemo(() => {
    if (!gameEngine) return null;
    let pk: PublicKey;
    try {
      pk = new PublicKey(wallet);
    } catch {
      return null;
    }
    const [pda] = derivePlayerPda(gameEngine, pk);
    return pda.toBase58();
  }, [wallet, gameEngine]);
}

interface MessageBubbleProps {
  msg: WtMessage;
  // resolved parent message for a reply, or null when not a reply / not loaded.
  parent: WtMessage | null;
  // true when the connected wallet posted this message (own, right-aligned).
  mine: boolean;
  groupPos: GroupPos;
  // true on the first received bubble (avatar + name) and the last bubble of any
  // group (timestamp + delivery tick).
  showMeta: boolean;
  // "thread" or "dm" passed straight to the actions menu (hides Send message in DM).
  menuScope: "thread" | "dm";
  // avatar diameter and matching gutter width; 28 compact, 32 full-screen.
  avatarSize: number;
  // base58 connected wallet, or null; used to mark which reaction chips are mine
  // (the store is wallet-agnostic, so mine is derived here).
  connectedWallet: string | null;
  // current thread pin target hex; flips the menu's Pin/Unpin.
  pinnedId: string;
  // true when the connected viewer may pin/unpin this message (officer-or-own).
  canPin: boolean;
  // react to this message with an emoji (kind=5, parent = this message).
  onReact: (emoji: string) => void;
  // un-react by tombstoning my own reaction message for this emoji on this
  // message; a no-op when I have no live reaction of that emoji.
  onUnreact: (emoji: string) => void;
  // open the composer reply chip targeting this message.
  onReply: () => void;
  // pin this message (kind=6, parent = this message).
  onPin: () => void;
  // unpin the thread (kind=6, zero parent).
  onUnpin: () => void;
  // delete this message (kind=4 tombstone, own only; gated upstream).
  onDelete: () => void;
  // scroll to and briefly highlight the parent of a reply by its hex id.
  onJumpTo: (parentId: string) => void;
}

// Corner rounding lookup. Base is rounded-2xl; the corner that faces the rest of
// the group is tightened to rounded-md so stacked bubbles read as one block.
function cornerClass(mine: boolean, pos: GroupPos): string {
  if (pos === "single") return "rounded-2xl";
  if (mine) {
    if (pos === "first") return "rounded-2xl rounded-br-md";
    if (pos === "middle") return "rounded-2xl rounded-r-md";
    return "rounded-2xl rounded-tr-md";
  }
  if (pos === "first") return "rounded-2xl rounded-bl-md";
  if (pos === "middle") return "rounded-2xl rounded-l-md";
  return "rounded-2xl rounded-tl-md";
}

export function MessageBubble({
  msg,
  parent,
  mine,
  groupPos,
  showMeta,
  menuScope,
  avatarSize,
  connectedWallet,
  pinnedId,
  canPin,
  onReact,
  onUnreact,
  onReply,
  onPin,
  onUnpin,
  onDelete,
  onJumpTo,
}: MessageBubbleProps) {
  const pda = useSenderIdentity(msg.senderWallet);
  // The replied-to message's sender PDA, so the quote strip can name who was
  // replied to (not just echo their text). Hook is unconditional; an empty
  // string (no parent) resolves to null.
  const parentPda = useSenderIdentity(parent?.senderWallet ?? "");
  const isReply = msg.kind === WtKind.Reply;
  const showPlaceholder = msg.locked || msg.tombstoned;
  const lastOfGroup = groupPos === "single" || groupPos === "last";
  const firstReceived = !mine && showMeta && (groupPos === "single" || groupPos === "first");

  // Presence for the sender, only resolved when this bubble actually draws the
  // received avatar (the first bubble of a received group). Passing null
  // otherwise keeps the RPC footprint to the visible avatars.
  const presence = usePlayerPresence(firstReceived ? pda : null);

  // Actions-menu open state, shared by the desktop hover button and the mobile
  // long-press; the menu only mounts for non-placeholder bubbles.
  const [menuOpen, setMenuOpen] = useState(false);

  // Mobile long-press: a timer started on pointerdown fires the menu unless the
  // finger lifts or moves past the tolerance (a scroll) first.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Mouse uses the hover button; only arm the long-press for touch/pen.
    if (e.pointerType === "mouse") return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = pressStart.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) clearPress();
  };

  // Gutter width tracks the avatar so received middle/last bubbles align under
  // the first bubble even when no avatar is drawn on those rows.
  const gutterStyle = { width: avatarSize };

  // The avatar gutter is only rendered for received rows; own rows never show an
  // avatar (iOS convention) and align to the right edge.
  const avatarCell = mine ? null : (
    <div className="shrink-0" style={gutterStyle}>
      {firstReceived ? (
        <div className="relative">
          {pda ? (
            <PlayerActionsMenu playerPda={pda} scope={menuScope}>
              <PlayerAvatar wallet={msg.senderWallet} size={avatarSize} />
            </PlayerActionsMenu>
          ) : (
            <PlayerAvatar wallet={msg.senderWallet} size={avatarSize} />
          )}
          {presence.online ? (
            <PresenceDot online size={9} className="absolute bottom-0 right-0" />
          ) : null}
        </div>
      ) : null}
    </div>
  );

  // Bubble fill. Received/placeholder bubbles carry a border so they read as
  // bubbles in light mode, where surface-overlay sits only a few percent off the
  // chat background; the own (accent) bubble needs no border. Locked/tombstoned
  // use a flat neutral fill on either side so the placeholder never wears the
  // saturated own-accent.
  const bubbleFill = showPlaceholder
    ? "border border-border-default bg-surface-overlay text-text-muted italic opacity-70"
    : mine
      ? "bg-accent text-white"
      : "border border-border-default bg-surface-overlay text-text-primary";

  // Quote strip tint sits a touch darker on the accent bubble than the neutral one.
  const quoteTint = mine ? "bg-black/10" : "bg-black/5";

  return (
    <div className={cn("flex w-full items-end gap-2", mine ? "justify-end" : "justify-start")}>
      {avatarCell}

      <div
        className={cn(
          // min-w-0 is load-bearing: a flex item's default min-width:auto
          // overrides max-w, so a nowrap reply quote would force the column past
          // 78%. min-w-0 lets the cap win and the quote truncate inside it.
          "flex min-w-0 max-w-[78%] flex-col gap-0.5",
          mine ? "items-end" : "items-start",
        )}
      >
        {firstReceived ? (
          pda ? (
            <PlayerActionsMenu playerPda={pda} scope={menuScope}>
              <PlayerName
                playerPda={pda}
                fallbackKey={msg.senderWallet}
                className="px-1 text-[11px] font-semibold text-text-secondary"
              />
            </PlayerActionsMenu>
          ) : (
            // pda is only null transiently while the client warms up; show the
            // wallet identity rather than a wrong definitive "Unknown" label.
            <PlayerName
              playerPda={null}
              fallbackKey={msg.senderWallet}
              className="px-1 text-[11px] font-semibold text-text-secondary"
            />
          )
        ) : null}

        {/* The bubble plus its actions affordance. group/bubble lets the desktop
            hover trigger fade in on hover; the long-press handlers (touch only)
            arm the same menu on mobile. Locked/tombstoned bubbles get no menu. */}
        <div
          className="group/bubble relative min-w-0"
          onPointerDown={showPlaceholder ? undefined : onPointerDown}
          onPointerMove={showPlaceholder ? undefined : onPointerMove}
          onPointerUp={showPlaceholder ? undefined : clearPress}
          onPointerCancel={showPlaceholder ? undefined : clearPress}
        >
          <div
            className={cn(
              "whitespace-pre-wrap break-words px-3 py-2 text-sm",
              cornerClass(mine, groupPos),
              bubbleFill,
              msg.pending && "opacity-70",
            )}
          >
            {isReply && parent ? (
              <button
                type="button"
                onClick={() => onJumpTo(msg.parentId)}
                className={cn(
                  "mb-1 flex w-full items-start gap-1 rounded-md border-l-2 border-border-default/60 px-2 py-1 text-left text-[11px] opacity-80 transition-opacity hover:opacity-100",
                  quoteTint,
                )}
              >
                <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  {/* Who was replied to: inherits the bubble text color, just bolded. */}
                  <PlayerName
                    playerPda={parentPda}
                    fallbackKey={parent.senderWallet}
                    className="truncate font-semibold"
                  />
                  <span className="truncate">
                    {parent.locked || parent.tombstoned ? placeholderFor(parent) : parent.body}
                  </span>
                </span>
              </button>
            ) : null}

            {showPlaceholder ? (
              <span className="flex items-center gap-1.5">
                {msg.locked ? <Lock className="h-3 w-3 shrink-0" aria-hidden /> : null}
                {placeholderFor(msg)}
              </span>
            ) : (
              msg.body
            )}
          </div>

          {/* The actions menu. Absolutely-positioned just outside the bubble's
              inner edge so it never shifts the bubble layout; the trigger fades
              in on desktop hover, and the mobile long-press opens the same menu
              (its trigger button is visually hidden on mobile). Centered with
              inset-y-0 + flex rather than -translate-y-1/2: a transform here
              would become the containing block for the menu's fixed BottomSheet,
              trapping and clipping it (PlayerActionsMenu has no such wrapper). */}
          {showPlaceholder ? null : (
            <div
              className={cn(
                "absolute inset-y-0 flex items-center",
                mine ? "-left-7" : "-right-7",
              )}
            >
              <MessageActionsMenu
                msg={msg}
                mine={mine}
                canPin={canPin}
                pinnedId={pinnedId}
                open={menuOpen}
                onOpenChange={setMenuOpen}
                onReact={onReact}
                onReply={onReply}
                onPin={onPin}
                onUnpin={onUnpin}
                onDelete={onDelete}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-opacity hover:bg-surface-overlay hover:text-text-primary",
                    menuOpen
                      ? "opacity-100"
                      : "opacity-50 lg:opacity-0 lg:group-hover/bubble:opacity-100",
                  )}
                  aria-label="Message actions"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </span>
              </MessageActionsMenu>
            </div>
          )}
        </div>

        {!showPlaceholder ? (
          <ReactionRow
            reactions={msg.reactions}
            connectedWallet={connectedWallet}
            pending={msg.pending === true}
            mine={mine}
            onToggle={(emoji, reactedByMe) =>
              reactedByMe ? onUnreact(emoji) : onReact(emoji)
            }
          />
        ) : null}

        {lastOfGroup ? (
          <div
            className={cn(
              "flex items-center gap-1 px-1",
              mine ? "justify-end" : "justify-start",
            )}
          >
            {msg.createdAt > 0 ? (
              <span className="text-[10px] text-text-muted">
                {new Date(msg.createdAt * 1000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {mine ? (
              msg.pending ? (
                <LoaderCircle
                  className="h-3 w-3 animate-spin text-text-muted"
                  aria-label="Sending"
                />
              ) : (
                <Check className="h-3 w-3 text-text-muted" aria-label="Delivered" />
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
