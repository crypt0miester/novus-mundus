"use client";

import { useKingdomEvents, type EventStatusFilter } from "@/lib/hooks/useKingdomEvents";
import { usePlayer } from "@/lib/hooks/usePlayer";
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
  const { data: playerData } = usePlayer();
  const currentEvent = Number(playerData?.account?.currentEvent ?? 0n);
  const joinedName =
    currentEvent !== 0
      ? events.find((e) => Number(e.account.id) === currentEvent)?.account.name
      : undefined;

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading events...</p>;
  }

  // One event per player: surface which one they're in and that the rest stay
  // locked. Shown only on the active tab, where joining happens.
  const banner =
    filter === "active" && currentEvent !== 0 ? (
      <div className="card accent-border">
        <p className="text-sm text-text-secondary">
          You're entered in{" "}
          <span className="font-semibold text-text-gold">
            {joinedName || `event #${currentEvent}`}
          </span>
          . You can only take part in one event at a time, so the others stay locked until it
          finishes.
        </p>
      </div>
    ) : null;

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        {banner}
        <div className="card">
          <p className="text-sm text-text-muted">
            {filter === "active"
              ? "No active or upcoming events right now. Check back soon."
              : "No finalized events yet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banner}
      {/* Gallery grid rather than a single full-width stack: narrow viewports keep
          the cards one-per-row, but desktop (xl+) fans them out to 2, and 3 on very
          wide screens. `items-start` keeps each card at its natural height, since
          leaderboards vary in length. */}
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
    </div>
  );
}
