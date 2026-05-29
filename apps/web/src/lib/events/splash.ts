// Event splash art resolution — two layers (images/events/events.json):
//   1. a dedicated per-event splash for marquee events (event-<id>.webp), and
//   2. a class default so every event has *some* art (event-class-<class>.webp).
//
// IMPORTANT: there is NO on-chain "event class". `EventAccount.eventType`
// is the *scoring metric* (TotalDamageDealt, HighestCash, ...), not a
// cadence — see EventType in programs/novus_mundus/src/types.rs. The
// class default is therefore derived from the only honest on-chain cadence
// signal we have: the event's scheduled duration. If a real class field is
// ever added on-chain, swap `classFromDuration` for a direct read.

// Marquee events that ship a dedicated splash. Kept explicit (rather than
// probing for a 404) so every returned path resolves to a real file.
const DEDICATED_EVENT_IDS = new Set([1, 2, 3]);

const DAY = 86_400;

export type EventClass = "daily" | "weekly" | "seasonal" | "world";

// Bucket a scheduled duration (seconds) into a cadence class. A duration of
// 0 or less reads as open-ended / permanent ("world").
export function classFromDuration(durationSec: number): EventClass {
  if (durationSec <= 0) return "world";
  if (durationSec <= 2 * DAY) return "daily";
  if (durationSec <= 10 * DAY) return "weekly";
  if (durationSec <= 60 * DAY) return "seasonal";
  return "world";
}

export function eventSplashPath(eventId: number, startTime: number, endTime: number): string {
  if (DEDICATED_EVENT_IDS.has(eventId)) {
    return `/img/events/event-${eventId}.webp`;
  }
  return `/img/events/event-class-${classFromDuration(endTime - startTime)}.webp`;
}
