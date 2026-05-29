"use client";

// DM conversation view.
//
// The route param `peer` is the other player's PlayerAccount PDA (base58). The
// thread PDA is the sorted-pair PDA derived from the connected player's
// PlayerAccount PDA and the peer's, so deriveDmThreadPda(me, peer) is symmetric
// and resolves the same thread for both participants. DM bodies are encrypted
// with a constant key_version of 1; the HttpKeyProvider serves only version 1
// for DM scope, wired through ThreadRenderer into useWarTable.
//
// The header is an iOS conversation header: a back chevron to the inbox, then
// the peer avatar + name. Tapping the peer opens PlayerActionsMenu (View on map
// / View profile); Send message is hidden in dm scope since we are already here.

import { use, useMemo } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { ChevronLeft } from "lucide-react";
import { deriveDmThreadPda, WarTableScope } from "novus-mundus-sdk";
import { PageTransition } from "@/components/shared/PageTransition";
import { PlayerName } from "@/components/war-table/PlayerName";
import { ThreadRenderer } from "@/components/war-table";
import { PlayerAvatar } from "@/components/war-table/PlayerAvatar";
import { PlayerActionsMenu } from "@/components/war-table/PlayerActionsMenu";
import { useAccountStore } from "@/lib/store/accounts";

// Parse a base58 PlayerAccount PDA, or null when the param is malformed.
function parsePlayerPda(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function BackLink() {
  return (
    <Link
      href="/messages"
      aria-label="Back to messages"
      className="inline-flex shrink-0 items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-text-primary"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
      Messages
    </Link>
  );
}

export default function DmConversationPage({ params }: { params: Promise<{ peer: string }> }) {
  const { peer } = use(params);
  const myPlayerPda = useAccountStore((s) => s.myPlayerPda);

  // Narrow the route param before deriving the thread PDA so a malformed peer is
  // a clean message here instead of a thrown PublicKey inside the renderer.
  const peerPda = useMemo(() => parsePlayerPda(peer), [peer]);

  const threadPda = useMemo(() => {
    if (!peerPda || !myPlayerPda) return null;
    const mine = new PublicKey(myPlayerPda);
    // Same player on both operands means there is no conversation to open.
    if (mine.equals(peerPda)) return null;
    const [pda] = deriveDmThreadPda(mine, peerPda);
    return pda;
  }, [peerPda, myPlayerPda]);

  if (!peerPda) {
    return (
      <PageTransition>
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <BackLink />
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
            CONVERSATION NOT FOUND
          </h1>
          <p className="text-sm text-text-muted">That player address is not valid.</p>
        </div>
      </PageTransition>
    );
  }

  const peerBase58 = peerPda.toBase58();

  return (
    <PageTransition>
      <div className="mx-auto flex h-full max-w-2xl flex-col gap-3">
        <div className="flex items-center gap-3">
          <BackLink />
          <PlayerActionsMenu playerPda={peerBase58} scope="dm">
            <span className="flex items-center gap-3">
              <PlayerAvatar playerPda={peerBase58} size={36} />
              <PlayerName
                playerPda={peerBase58}
                className="tier-title font-display text-lg font-bold tracking-wide"
              />
            </span>
          </PlayerActionsMenu>
        </div>

        <div className="min-h-0 flex-1">
          {!myPlayerPda || !threadPda ? (
            <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
              {myPlayerPda
                ? "You cannot message yourself."
                : "Connect your account to view this conversation."}
            </div>
          ) : (
            <ThreadRenderer
              threadPda={threadPda}
              scope={WarTableScope.Dm}
              peer={peerBase58}
              canPost={true}
              placeholder="write a message..."
              maxHeightClass="max-h-none"
            />
          )}
        </div>
      </div>
    </PageTransition>
  );
}
