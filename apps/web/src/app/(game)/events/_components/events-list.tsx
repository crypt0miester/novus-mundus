"use client";

import { useKingdomEvents, type EventStatusFilter } from "@/lib/hooks/useKingdomEvents";
import { EventCard } from "./event-card";

/*
 * Shared event list. `filter` selects which statuses to render:
 *  - "active" → Pending (0) + Active (1)
 *  - "history" → Finalized (2)
 *
 * All data flows through zustand. See useKingdomEvents for how events and
 * the current player's EventParticipations are seeded and kept live.
 */
export function EventsList({ filter }: { filter: EventStatusFilter }) {
  const { events, participationByEventId, isLoading } = useKingdomEvents({ filter });

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading events...</p>;
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-text-muted">
          {filter === "active"
            ? "No active or upcoming events right now. Check back soon."
            : "No finalized events yet."}
        </p>
      </div>
    );
  }

  return (
    // Gallery grid rather than a single full-width stack: narrow viewports keep
    // the cards one-per-row, but desktop (xl+) fans them out to 2, and 3 on very
    // wide screens, so a content-dense card never stretches across the whole
    // pane. The 2-col break waits for xl so the card's inner prize grid stays
    // roomy after the left sidebar claims its width. `items-start` keeps each
    // card at its natural height — leaderboards vary in length, so equal-height
    // stretching would leave tall empty cards.
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3 items-start">
      {events.map(({ pubkey, account }) => (
        <EventCard
          key={pubkey}
          eventPubkey={pubkey}
          event={account}
          participation={participationByEventId.get(account.id.toString()) ?? null}
        />
      ))}
    </div>
  );
}
