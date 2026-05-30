"use client";

// Messages inbox: lists the connected player's DM conversations as an
// iOS-style conversation list.
//
// useDmInbox discovers the threads from chain (sender-side via
// getSignaturesForAddress) and keeps them live. Each row shows the peer's
// avatar, domain name (falling back to a shortened PDA inside DomainName), the
// fixed encrypted-message preview, and a chevron, and links to the conversation
// view at /messages/[peer]. DM bodies are encrypted and the inbox never fetches
// keys, so the preview is a label rather than decoded text.
//
// The header "New message" button opens NewMessageComposer to pick a recipient.
// DmConvo carries no timestamp and no unread flag, so rows omit both; adding
// lastCreatedAt and an unread cursor are flagged follow-ups, not shimmed here.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Inbox, LoaderCircle, SquarePen } from "lucide-react";
import { PageTransition } from "@/components/shared/PageTransition";
import { PlayerName } from "@/components/war-table/PlayerName";
import { PlayerAvatar } from "@/components/war-table/PlayerAvatar";
import { NewMessageComposer } from "@/components/war-table/NewMessageComposer";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { useDmInbox } from "@/lib/hooks/useDmInbox";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { usePresence } from "@/lib/hooks/usePresence";
import type { DmConvo } from "@/lib/store/war-table";

// A stable per-peer number so each row's presence breathe jitters out of phase
// with the rest of the roster instead of pulsing in lockstep.
function seedFromPda(pda: string): number {
  let h = 0;
  for (let i = 0; i < pda.length; i++) {
    h = (h * 31 + pda.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function ConversationRow({ convo, online }: { convo: DmConvo; online: boolean }) {
  return (
    <Link
      href={`/messages/${convo.peerPlayerPda}`}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-overlay"
    >
      <div className="relative shrink-0">
        <PlayerAvatar playerPda={convo.peerPlayerPda} size={44} />
        <PresenceDot
          online={online}
          hideOffline
          seed={seedFromPda(convo.peerPlayerPda)}
          className="absolute bottom-0 right-0"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PlayerName
            playerPda={convo.peerPlayerPda}
            className="truncate text-sm font-semibold text-text-primary"
          />
        </div>
        <p className="truncate text-xs text-text-muted">{convo.lastPreview}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}

function MessagesContent() {
  const { conversations, isLoading } = useDmInbox();
  const [composerOpen, setComposerOpen] = useState(false);

  // Warm the peer domains once for the whole list; each row still renders via
  // DomainName, which reads the shared cache.
  const peerPdas = useMemo(
    () => conversations.map((c) => c.peerPlayerPda),
    [conversations],
  );
  useDomainNames(peerPdas);

  // Presence for every peer in the inbox: peerPlayerPda IS the PlayerAccount
  // PDA, so it feeds usePresence directly. Only the visible rows are queried.
  const presence = usePresence(peerPdas);

  return (
    <PageTransition>
      <div className="mx-auto flex h-full max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
            MESSAGES
          </h1>
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-border-gold hover:text-text-primary"
          >
            <SquarePen className="h-4 w-4" aria-hidden />
            New message
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && conversations.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              Loading conversations
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-sm text-text-muted">
              <Inbox className="h-8 w-8 opacity-60" aria-hidden />
              <div>
                <p className="text-text-secondary">No conversations yet</p>
                <p className="mt-1 text-xs">
                  Tap New message, or open a player profile and choose Message, to start a direct message.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-default/50">
              {conversations.map((convo) => (
                <ConversationRow
                  key={convo.threadPda}
                  convo={convo}
                  online={presence[convo.peerPlayerPda]?.online ?? false}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewMessageComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </PageTransition>
  );
}

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <MessagesContent />
    </Suspense>
  );
}
