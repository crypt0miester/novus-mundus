"use client";

import { EventsList } from "./events-list";

/** Active tab — Pending (upcoming) and Active events. */
export function EventsTab() {
  return <EventsList filter="active" />;
}
