"use client";

import { useState } from "react";
import { isNullPubkey } from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useDailyActivity } from "@/lib/hooks/useDailyActivity";
import { ACTIVITY_BY_BUILDING, rewardSummary } from "./meta";
import { MinigameSession } from "./MinigameSession";
import { StanceChoice, stanceName } from "./choices/StanceChoice";
import { BlessingChoice } from "./choices/BlessingChoice";
import { ActivityResult } from "./ActivityResult";
import { useDailyActivities, WINDOW_LABEL, type OwnedActivity } from "./useDailyActivities";

interface DailyActivityPanelProps {
  building: number;
  /** When provided (modal use), closing the result calls it. */
  onClose?: () => void;
}

interface ActivityOutcome {
  score?: number;
  summary: string;
}

/** Why the activity can't be launched right now, for the gated-state notice. */
function windowGateMessage(activity: OwnedActivity): string {
  switch (activity.status) {
    case "done":
      return "You've already completed this activity for today's window.";
    case "missed":
      return `The ${WINDOW_LABEL[activity.window]} window has closed for today.`;
    default:
      return `Not open yet — this plays in the ${WINDOW_LABEL[activity.window]} window.`;
  }
}

/**
 * One building's daily activity, end to end. A skill game (`play`) gets an
 * intro then the `MinigameSession`; a Class A choice (`stance` / `blessing`)
 * renders its choice screen directly. Either way it finishes on `ActivityResult`.
 */
export function DailyActivityPanel({ building, onClose }: DailyActivityPanelProps) {
  const meta = ACTIVITY_BY_BUILDING.get(building);
  const { data: playerData } = usePlayer();
  const { submitChoice } = useDailyActivity();
  const daily = useDailyActivities();

  const [started, setStarted] = useState(false);
  const [outcome, setOutcome] = useState<ActivityOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!meta) {
    return (
      <div className="card text-center text-sm text-text-muted">
        This activity isn’t available yet.
      </div>
    );
  }

  // The activity's window status (available / later / missed / done). The
  // server (and the on-chain `daily_activity` gate) reject an out-of-window
  // play, so block the launch here rather than letting the run fail.
  //
  // Also gate while `daily` is still loading: without this guard, a player
  // who taps Begin in the load window plays a full minigame only to have
  // submitChoice reject after the fact.
  const dailyReady = !!daily;
  const activity = daily?.owned.find((a) => a.meta.building === building) ?? null;
  const gated = !started && (!dailyReady || (!!activity && activity.status !== "available"));
  const gateMessage = activity ? windowGateMessage(activity) : "Checking today's window…";

  const runChoice = async (payload: { choice?: number; heroMint?: string }, summary: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await submitChoice(building, payload);
      setOutcome({ summary });
    } catch (e) {
      setError(e instanceof Error ? e.message : "submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const chooseStance = (choice: number) =>
    runChoice({ choice }, `Watch set — ${stanceName(choice)} stance for the day.`);

  const chooseHero = (heroMint: string) =>
    runChoice({ heroMint }, "Hero blessed — +25% effectiveness for the day.");

  const heroes = (playerData?.account?.activeHeroes ?? [])
    .filter((h) => !isNullPubkey(h))
    .map((h) => h.toBase58());

  const closeResult = () => {
    if (onClose) {
      onClose();
    } else {
      setOutcome(null);
      setStarted(false);
    }
  };

  return (
    <div className="space-y-3">
      <header>
        <h3 className="font-display text-lg font-bold text-text-primary">{meta.title}</h3>
        <p className="text-xs text-text-muted">{meta.tagline}</p>
      </header>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {outcome ? (
        <ActivityResult
          title={meta.title}
          score={outcome.score}
          summary={outcome.summary}
          onClose={closeResult}
        />
      ) : gated ? (
        <div className="card text-center">
          <p className="text-sm text-text-secondary">{gateMessage}</p>
        </div>
      ) : meta.kind === "play" ? (
        started ? (
          <MinigameSession
            building={building}
            onComplete={(score, windowBonus) =>
              setOutcome({
                score,
                summary:
                  rewardSummary(building, score) +
                  (windowBonus > 0 ? ` ✦ Window complete — +${windowBonus} bonus folded in.` : ""),
              })
            }
          />
        ) : (
          <div className="card text-center">
            <p className="mb-4 text-sm text-text-secondary">{meta.tagline}</p>
            <button
              onClick={() => setStarted(true)}
              className="rounded-lg border border-border-gold bg-accent/20 px-6 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-accent/40"
            >
              Begin
            </button>
          </div>
        )
      ) : meta.kind === "stance" ? (
        <StanceChoice submitting={submitting} onChoose={chooseStance} />
      ) : (
        <BlessingChoice heroes={heroes} submitting={submitting} onChoose={chooseHero} />
      )}
    </div>
  );
}
