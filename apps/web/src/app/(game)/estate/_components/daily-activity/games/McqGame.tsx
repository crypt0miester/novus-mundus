"use client";

import { lazy, Suspense } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { prefersReducedMotion } from "@/lib/utils";
import { useWebGL2Ready } from "@/lib/webgl/useWebGL2Ready";
import { useFx } from "../GameStage";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";

// The Observatory marquee renders the constellation as a 3D star field; the
// chunk (three.js) is only fetched when a star-reading game actually opens.
const StarField3D = lazy(() => import("../StarField3D"));
const ENABLE_STAR_3D = true;

/** Client-safe MCQ presentation (server `mcq` archetype, key removed). */
export interface McqPresentation {
  questions: { prompt: string; display?: string; options: string[] }[];
}

interface McqGameProps {
  presentation: McqPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

// 6s per question — fast enough to feel a tap-clock, slow enough for a human
// to actually count the bright stars and pick.
const MS_PER_QUESTION = 6_000;

/** Flat ★/☆ row — the fallback (and SSR / reduced-motion) constellation. */
function TextStars({ display }: { display: string }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 text-2xl leading-none">
      {display.split(" ").map((g, gi) => (
        <span key={gi} className={g === "★" ? "text-gold-300" : "text-zinc-600"}>
          {g}
        </span>
      ))}
    </div>
  );
}

/**
 * MCQ game UI — Observatory "Star Reading" and the text quizzes (Academy,
 * Infirmary). Each question shows a constellation (3D star field where WebGL2
 * is available, flat ★/☆ row otherwise) and asks for the bright count, or a
 * text prompt with options. Answering locks the choice in and dims the rest;
 * the round-wide timer snap-submits, unanswered slots scoring zero. The answer
 * (an option index per question) is unchanged, so server grading is untouched.
 */
export function McqGame({ presentation, submitting, onSubmit }: McqGameProps) {
  const { questions } = presentation;
  const fx = useFx();
  const [answers, setAnswer] = useIndexedSelection<number | null>(() => questions.map(() => null));

  // Defer the 3D swap to after mount so SSR and the first client render both
  // emit the text row (no hydration mismatch), then upgrade if WebGL2 is there.
  // Render every constellation in 3D when WebGL2 is available; reduced motion
  // gets a STATIC 3D scene (not a drop to the text row), since reduced-motion
  // suppresses animation, not 3D rendering. Each StarField3D owns one small
  // WebGL context and releases it on unmount — a star-reading game has only a
  // few questions, so the per-question contexts stay well under the iOS cap.
  const webglReady = useWebGL2Ready();
  const use3d = ENABLE_STAR_3D && webglReady;

  const answered = answers.filter((a) => a !== null).length;
  const allAnswered = answered === questions.length;
  const totalMs = MS_PER_QUESTION * questions.length;

  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(answers.map((a) => a ?? -1));
  });

  return (
    <div className="space-y-3">
      <GameHeader
        current={Math.min(answered + 1, questions.length)}
        total={questions.length}
        noun="Reading"
      />
      <GameTimer totalMs={totalMs} paused={submitting} onExpire={fireSubmit} />

      {questions.map((q, qi) => {
        const locked = answers[qi] !== null;
        return (
          <div key={qi} className="card">
            {q.display &&
              (use3d ? (
                <Suspense fallback={<TextStars display={q.display} />}>
                  <StarField3D display={q.display} animate={!prefersReducedMotion()} />
                </Suspense>
              ) : (
                <TextStars display={q.display} />
              ))}
            <p className="mb-3 text-sm text-text-secondary">{q.prompt}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt, oi) => {
                const selected = answers[qi] === oi;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={submitting}
                    onClick={(e) => {
                      setAnswer(qi, oi);
                      playSfx("select");
                      fx.burstEl(e.currentTarget, { count: 8 });
                    }}
                    className={`min-w-[3rem] rounded-lg border px-4 py-2 text-sm font-semibold tabular-nums transition-all ${
                      selected
                        ? "scale-105 border-border-gold bg-accent/30 text-text-gold shadow-[0_0_12px_-2px_rgba(220,180,90,0.55)]"
                        : `border-border-default text-text-secondary hover:border-border-gold/50 ${
                            locked ? "opacity-50" : ""
                          }`
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <GameFooter
        progress={{ done: answered, total: questions.length, noun: "answered" }}
        submitLabel={allAnswered ? "Submit reading" : "Submit (skipped count as wrong)"}
        submitting={submitting}
        disabled={false}
        onSubmit={fireSubmit}
      />
    </div>
  );
}
