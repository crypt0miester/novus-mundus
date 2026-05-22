"use client";

import { GameFooter, useIndexedSelection } from "./_shell";

/** Client-safe MCQ presentation (server `mcq` archetype, key removed). */
export interface McqPresentation {
  questions: { prompt: string; display?: string; options: string[] }[];
}

interface McqGameProps {
  presentation: McqPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

/**
 * MCQ game UI — Observatory "Star Reading". Each question shows a constellation
 * (a row of bright ★ and dim ☆ stars) and asks for the bright count. The player
 * answers every question, then submits once.
 */
export function McqGame({ presentation, submitting, onSubmit }: McqGameProps) {
  const { questions } = presentation;
  const [answers, setAnswer] = useIndexedSelection<number | null>(() => questions.map(() => null));

  const answered = answers.filter((a) => a !== null).length;
  const allAnswered = answered === questions.length;

  return (
    <div className="space-y-3">
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
                  className={`min-w-[3rem] rounded-lg border px-4 py-2 text-sm font-semibold tabular-nums transition-colors ${
                    selected
                      ? "border-border-gold bg-accent/30 text-text-gold"
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
        submitLabel="Submit reading"
        submitting={submitting}
        disabled={!allAnswered}
        onSubmit={() => onSubmit(answers.map((a) => a ?? -1))}
      />
    </div>
  );
}
