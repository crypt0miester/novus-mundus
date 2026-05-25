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
    <div className="space-y-4">
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
