"use client";

import {
  GameFooter,
  GameHeader,
  GameTimer,
  useFireOnce,
  useIndexedSelection,
} from "./_shell";

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
// to actually count the bright stars and pick. Tuned against the Observatory
// "Star Reading" archetype; if a tougher archetype lands later, lift this to
// the presentation payload.
const MS_PER_QUESTION = 6_000;

/**
 * MCQ game UI — Observatory "Star Reading". Each question shows a constellation
 * (a row of bright ★ and dim ☆ stars) and asks for the bright count. The player
 * answers every question, then submits — or runs out the round-wide timer, at
 * which point the current answers snap-submit and unanswered slots score zero.
 */
export function McqGame({ presentation, submitting, onSubmit }: McqGameProps) {
  const { questions } = presentation;
  const [answers, setAnswer] = useIndexedSelection<number | null>(() => questions.map(() => null));

  const answered = answers.filter((a) => a !== null).length;
  const allAnswered = answered === questions.length;
  const totalMs = MS_PER_QUESTION * questions.length;

  const fireSubmit = useFireOnce(() => onSubmit(answers.map((a) => a ?? -1)));

  return (
    <div className="space-y-3">
      <GameHeader
        current={Math.min(answered + 1, questions.length)}
        total={questions.length}
        noun="Reading"
      />
      <GameTimer totalMs={totalMs} paused={submitting} onExpire={fireSubmit} />

      {questions.map((q, qi) => (
        <div key={qi} className="card">
          {q.display && (
            <div className="mb-2 flex flex-wrap gap-1.5 text-2xl leading-none">
              {q.display.split(" ").map((g, gi) => (
                <span key={gi} className={g === "★" ? "text-gold-300" : "text-zinc-600"}>
                  {g}
                </span>
              ))}
            </div>
          )}
          <p className="mb-3 text-sm text-text-secondary">{q.prompt}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              return (
                <button
                  key={oi}
                  disabled={submitting}
                  onClick={() => setAnswer(qi, oi)}
                  className={`min-w-[3rem] rounded-lg border px-4 py-2 text-sm font-semibold tabular-nums transition-all ${
                    selected
                      ? "scale-105 border-border-gold bg-accent/30 text-text-gold shadow-[0_0_12px_-2px_rgba(220,180,90,0.55)]"
                      : "border-border-default text-text-secondary hover:border-border-gold/50"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}

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
