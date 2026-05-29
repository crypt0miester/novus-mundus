"use client";

// MobileTeamDock: a collapsed strip docked above the mobile bottom nav that
// expands the team panel (chat / treasury / settings) into a BottomSheet.
//
// Collapsed, it shows the House name, a one-line peek of the latest war-table
// message, and an unread dot. Tapping it opens the sheet (children); opening or
// closing marks the latest message seen. The peek and unread are driven by
// useThreadPeek, which never forces a SIWS popup: the body is shown only when a
// key is already available, otherwise the strip reads "New messages".
//
// The strip is lg:hidden; the BottomSheet is mobile-only by construction. The
// peek subscription is gated to mobile so the desktop sidebar stays the single
// subscriber for the team thread.

import { useMemo, type ReactNode } from "react";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChevronUp, Shield } from "lucide-react";
import { WarTableScope, idToHex } from "novus-mundus-sdk";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { useThreadPeek } from "@/lib/hooks/useThreadPeek";
import { useIsMobile } from "@/lib/hooks/useMediaQuery";
import { useWtReadStore } from "@/lib/store/wt-read";
import { PlayerName } from "@/components/war-table/PlayerName";
import { useSenderIdentity } from "@/components/war-table/MessageBubble";

const textDecoder = new TextDecoder();

export interface MobileTeamDockProps {
  threadPda: PublicKey | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MobileTeamDock({ threadPda, title, open, onOpenChange, children }: MobileTeamDockProps) {
  const isMobile = useIsMobile();
  const { publicKey } = useWallet();
  const latest = useThreadPeek(threadPda, WarTableScope.Team, {
    enabled: isMobile && !!threadPda,
  });
  const threadB58 = threadPda ? threadPda.toBase58() : null;

  const lastSeenMap = useWtReadStore((s) => s.lastSeen);
  const markReadStore = useWtReadStore((s) => s.markRead);
  const lastSeen = threadB58 ? (lastSeenMap[threadB58] ?? "") : "";

  // Own messages never count as unread.
  const latestIdHex = latest ? idToHex(latest.id) : "";
  const mine = !!latest && !!publicKey && latest.senderWallet.equals(publicKey);
  const unread = !!latest && !!threadB58 && !mine && latestIdHex > lastSeen;

  // Decoded body of the latest message; empty when there is none or it is locked.
  const body = useMemo(
    () => (latest?.decrypted ? textDecoder.decode(latest.payload).trim() : ""),
    [latest],
  );

  const peekText = useMemo(() => {
    if (!latest) return "Plan the next move with your House";
    if (latest.decrypted) return body.length > 0 ? body : "New message";
    return "New messages";
  }, [latest, body]);

  // Prefix the peek with the sender (team chat is a group, so who said it
  // matters), but only for a real decrypted message, not the empty-state copy or
  // a locked "New messages" strip. The sender PDA derives from the wallet the
  // same way the bubbles resolve it.
  const senderWallet = latest ? latest.senderWallet.toBase58() : "";
  const senderPda = useSenderIdentity(senderWallet);
  const showSender = !!latest && latest.decrypted && body.length > 0;

  const markSeen = () => {
    if (latest && threadB58) markReadStore(threadB58, latestIdHex);
  };
  const handleOpen = () => {
    onOpenChange(true);
    markSeen();
  };
  const handleClose = () => {
    onOpenChange(false);
    markSeen();
  };

  return (
    <>
      {/* Collapsed strip: mobile/tablet only, fixed just above the bottom nav. */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Open the war-table"
        className="fixed inset-x-0 z-40 mx-auto flex max-w-2xl items-center px-3 lg:hidden bottom-[calc(5rem+env(safe-area-inset-bottom)+0.5rem)] md:bottom-4"
      >
        <span className="flex w-full items-center gap-3 rounded-full border border-border-default bg-surface-raised/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
            <Shield className="h-4 w-4" aria-hidden />
            {unread && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-accent"
                aria-hidden
              />
            )}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              {title}
            </span>
            <span className="block truncate text-sm text-text-secondary">
              {showSender ? (
                <span className="font-medium text-text-primary">
                  {mine ? (
                    "You: "
                  ) : (
                    <>
                      <PlayerName playerPda={senderPda} fallbackKey={senderWallet} />
                      {": "}
                    </>
                  )}
                </span>
              ) : null}
              {peekText}
            </span>
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        </span>
      </button>

      <BottomSheet open={open} onClose={handleClose} title={title} fillerVh={0}>
        <div className="space-y-4 px-1 pb-2">{children}</div>
      </BottomSheet>
    </>
  );
}
