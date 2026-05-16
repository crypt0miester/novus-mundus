"use client";

import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import {
  useDailyActivity,
  type Archetype,
  type StartResponse,
} from "@/lib/hooks/useDailyActivity";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";
import { formatTime } from "@/lib/utils";
import { McqGame } from "./games/McqGame";
import { MemoryGame } from "./games/MemoryGame";
import { SetSelectGame } from "./games/SetSelectGame";
import { AssignmentGame } from "./games/AssignmentGame";
import { OrderingGame } from "./games/OrderingGame";
import { ReflexGame } from "./games/ReflexGame";

interface MinigameSessionProps {
  building: number;
  onComplete: (score: number, windowBonus: number) => void;
}

/** Props a single-shot game component takes (one graded `onSubmit`). */
interface SingleShotProps {
  presentation: unknown;
  submitting: boolean;
  onSubmit: (answer: unknown) => void;
}

/** Props a multi-move game component takes (a `/move` loop, then `onComplete`). */
interface MultiMoveProps {
  presentation: unknown;
  submitting: boolean;
  sendMove: (move: unknown) => Promise<MoveResponse>;
  onComplete: () => void;
}

/**
 * Each archetype's game component and whether it drives a `/move` loop. The
 * components' presentation props are narrower than `unknown`, so the cast is
 * confined here — `StartResponse.presentation` is `unknown` by design.
 */
const GAMES: Record<
  Archetype,
  | { multiMove: false; component: ComponentType<SingleShotProps> }
  | { multiMove: true; component: ComponentType<MultiMoveProps> }
> = {
  mcq: { multiMove: false, component: McqGame as ComponentType<SingleShotProps> },
  "set-select": {
    multiMove: false,
    component: SetSelectGame as ComponentType<SingleShotProps>,
  },
  assignment: {
    multiMove: false,
    component: AssignmentGame as ComponentType<SingleShotProps>,
  },
  ordering: {
    multiMove: false,
    component: OrderingGame as ComponentType<SingleShotProps>,
  },
  memory: { multiMove: true, component: MemoryGame as ComponentType<MultiMoveProps> },
  reflex: { multiMove: true, component: ReflexGame as ComponentType<MultiMoveProps> },
};

/**
 * Drives one Class B mini-game: starts (or resumes) the session, renders the
 * archetype's game component, runs any move loop, and co-signs the result.
 */
export function MinigameSession({ building, onComplete }: MinigameSessionProps) {
  const { startSession, sendMove, submitSession } = useDailyActivity();
  const [session, setSession] = useState<StartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);

  const begin = useCallback(() => {
    setError(null);
    setSession(null);
    startSession(building)
      .then(setSession)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "could not start the mini-game"),
      );
  }, [building, startSession]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    begin();
  }, [begin]);

  const submit = useCallback(
    async (answer?: unknown) => {
      if (!session) return;
      setSubmitting(true);
      setError(null);
      try {
        const { score, windowBonus } = await submitSession(
          building,
          session.sessionId,
          answer,
        );
        onComplete(score, windowBonus);
      } catch (e) {
        setError(e instanceof Error ? e.message : "submission failed");
        setSubmitting(false);
      }
    },
    [session, building, submitSession, onComplete],
  );

  if (error) {
    return (
      <div className="card text-center">
        <p className="mb-3 text-sm text-red-400">{error}</p>
        <button
          onClick={begin}
          className="rounded-lg border border-border-gold bg-amber-900/20 px-5 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-amber-900/40"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="card text-center text-sm text-text-muted">
        Preparing the mini-game…
      </div>
    );
  }

  const entry = GAMES[session.archetype];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-text-muted">
        <span>{session.flavor.title}</span>
        <Deadline deadlineMs={session.deadline} />
      </div>
      {entry.multiMove ? (
        <entry.component
          presentation={session.presentation}
          submitting={submitting}
          sendMove={(move) => sendMove(session.sessionId, move)}
          onComplete={() => submit()}
        />
      ) : (
        <entry.component
          presentation={session.presentation}
          submitting={submitting}
          onSubmit={(answer) => submit(answer)}
        />
      )}
    </div>
  );
}

/**
 * An isolated countdown leaf — owns its own 1s tick so the per-second update
 * writes to a ref instead of re-rendering the game subtree. The server
 * enforces the real deadline; this is a soft display.
 */
function Deadline({ deadlineMs }: { deadlineMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      if (!ref.current) return;
      const s = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
      ref.current.textContent = `⏱ ${formatTime(s, "compact")}`;
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadlineMs]);

  return <span ref={ref} className="font-mono tabular-nums" />;
}
