"use client";

import { useCallback } from "react";
import { useCoSign, deserializeCoSignTx } from "@/lib/cosign";
import { useTransact } from "./useTransact";

/**
 * Client for one estate daily-activity mini-game session
 * (`DAILY_ACTIVITY_MINIGAMES.md` §12).
 *
 * Wraps the three endpoints: `/start` and `/move` return JSON, the co-sign
 * route returns a partial-signed transaction the wallet finishes via
 * `useTransact`. All are session-gated — `useCoSign.requestJson` runs the
 * one-time SIWS handshake on a 401 and retries.
 */

/** A puzzle archetype's client-safe presentation (shape per archetype). */
export type Presentation = unknown;

/** The puzzle archetype a session runs (server `DAILY_ACTIVITY_MINIGAMES.md`). */
export type Archetype =
  | "mcq"
  | "set-select"
  | "assignment"
  | "ordering"
  | "memory"
  | "reflex";

export interface StartResponse {
  sessionId: string;
  building: number;
  archetype: Archetype;
  multiMove: boolean;
  window: string;
  flavor: { title: string; tagline: string };
  presentation: Presentation;
  progress: unknown;
  deadline: number;
}

export interface MoveResponse {
  result: unknown;
  done: boolean;
}

export function useDailyActivity() {
  const { requestJson } = useCoSign();
  const transact = useTransact();

  /** Start (or resume) a mini-game session for a building. */
  const startSession = useCallback(
    (building: number) =>
      requestJson<StartResponse>(`/api/minigame/estate/${building}/start`, {}),
    [requestJson],
  );

  /** Apply one move to a multi-move session. */
  const sendMove = useCallback(
    (sessionId: string, move: unknown) =>
      requestJson<MoveResponse>(`/api/minigame/${sessionId}/move`, { move }),
    [requestJson],
  );

  /**
   * Grade and co-sign a finished session, then submit the transaction. Returns
   * the final score and any window-completion bonus folded into it (§8).
   */
  const submitSession = useCallback(
    async (
      building: number,
      sessionId: string,
      answer?: unknown,
    ): Promise<{ score: number; windowBonus: number }> => {
      const { transaction, score, windowBonus } = await requestJson<{
        transaction: string;
        score: number;
        windowBonus: number;
      }>("/api/cosign/estate/daily-activity", {
        buildingType: building,
        sessionId,
        answer,
      });
      await transact.mutateAsync({
        versionedTx: deserializeCoSignTx(transaction),
        invalidateKeys: [["estate"], ["player"]],
        successMessage: "Daily activity complete",
      });
      return { score, windowBonus };
    },
    [requestJson, transact],
  );

  /** Co-sign and submit a Class A choice (Citadel stance / Sanctuary blessing). */
  const submitChoice = useCallback(
    async (
      building: number,
      payload: { choice?: number; heroMint?: string },
    ): Promise<void> => {
      const { transaction } = await requestJson<{ transaction: string }>(
        "/api/cosign/estate/daily-activity",
        { buildingType: building, ...payload },
      );
      await transact.mutateAsync({
        versionedTx: deserializeCoSignTx(transaction),
        invalidateKeys: [["estate"], ["player"]],
        successMessage: "Daily activity complete",
      });
    },
    [requestJson, transact],
  );

  return { startSession, sendMove, submitSession, submitChoice };
}
