import "server-only";
import { Rng } from "./rng";

/**
 * Server-computed mini-game score (0-100) for the `game_authority`-vouched
 * score instructions (expedition strike, estate daily-activity).
 *
 * Design decision: there is no client-trustworthy mini-game yet, so the score
 * is a deterministic *server* roll, seeded by the action's on-chain state. This
 * makes the co-signature meaningful — the client cannot inflate the score — and
 * consistent (a retried request reproduces the same score). When a real,
 * server-authoritative skill mini-game exists, this roll is replaced by a
 * validated mini-game result.
 *
 * The roll lands in a fair "engaged play" band (60-95, avg ~77): a real reward
 * for taking the action, never a guaranteed perfect 100.
 */
export function rollScore(
  domain: string,
  account: string,
  discriminator: string,
): number {
  return 60 + new Rng(domain, account, discriminator).nextInt(36);
}
