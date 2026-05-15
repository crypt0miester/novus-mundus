"use client";

import { EventsList } from "./events-list";

/** History tab — Finalized events. */
export function HistoryTab() {
  return <EventsList filter="history" />;
}
