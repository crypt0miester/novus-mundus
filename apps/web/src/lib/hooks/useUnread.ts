"use client";

// Unread-messages indicator for DMs + the team war-room.
//
// useUnreadSync (mount ONCE near the app root) keeps the DM discovery and the
// team-thread peek alive app-wide and feeds the team latest-id into the read
// store. useUnread is a cheap, subscription-free reader usable in any number of
// components (nav badge, left panel, inbox rows): a thread is unread when its
// latest message id exceeds the last-seen cursor (see lib/store/wt-read).

import { useEffect, useMemo } from "react";
import { WarTableScope, idToHex } from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useWarTableStore } from "@/lib/store/war-table";
import { useWtReadStore } from "@/lib/store/wt-read";
import { useDmInbox } from "@/lib/hooks/useDmInbox";
import { useThreadPeek } from "@/lib/hooks/useThreadPeek";

/**
 * The single global subscriber. Mounted once via <UnreadSync /> in the game
 * layout so the badge is live on every page (not just /messages). Renders nothing.
 */
export function useUnreadSync(): void {
  // DM discovery + live onLogs(myPlayerPda); writes useWarTableStore.dmConversations.
  useDmInbox();

  const teamPda = useAccountStore((s) => s.team?.pubkey ?? null);
  const setTeamLatestId = useWtReadStore((s) => s.setTeamLatestId);
  // Peeks the team thread's newest message without forcing a SIWS popup.
  const teamLatest = useThreadPeek(teamPda, WarTableScope.Team, { enabled: !!teamPda });

  useEffect(() => {
    setTeamLatestId(teamLatest ? idToHex(teamLatest.id) : "");
  }, [teamLatest, setTeamLatestId]);
}

export function UnreadSync(): null {
  useUnreadSync();
  return null;
}

export interface UnreadState {
  /** Number of threads (DMs + team) with messages newer than last-seen. */
  total: number;
  /** Whether a specific thread PDA is unread. */
  isUnread: (threadPda: string) => boolean;
}

export function useUnread(): UnreadState {
  const dmConversations = useWarTableStore((s) => s.dmConversations);
  const lastSeen = useWtReadStore((s) => s.lastSeen);
  const teamLatestId = useWtReadStore((s) => s.teamLatestId);
  const teamPda = useAccountStore((s) => (s.team ? s.team.pubkey.toBase58() : null));

  return useMemo(() => {
    const unread = new Set<string>();
    for (const c of dmConversations.values()) {
      if (c.lastMessageId && c.lastMessageId > (lastSeen[c.threadPda] ?? "")) {
        unread.add(c.threadPda);
      }
    }
    if (teamPda && teamLatestId && teamLatestId > (lastSeen[teamPda] ?? "")) {
      unread.add(teamPda);
    }
    return { total: unread.size, isUnread: (t: string) => unread.has(t) };
  }, [dmConversations, lastSeen, teamLatestId, teamPda]);
}
