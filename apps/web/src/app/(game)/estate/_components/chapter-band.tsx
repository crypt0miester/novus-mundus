"use client";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useAct } from "@/lib/hooks/useAct";
import { buildChronicleFacts, nextBeat } from "@/lib/narrative";
import type { Act } from "@/lib/narrative";

/**
 * The three chapters the climb passes through, in the Cairn's reckoning. The
 * six acts collapse to a coarser arc the land itself can be read against:
 * Foundation while the ground is taken and the first walls rise, Expansion
 * once the road notices and a House is sworn, Mastery once the realm has
 * learned the name.
 */
const CHAPTERS: Record<Act, { name: string; standing: string }> = {
  0: { name: "Foundation", standing: "The ground is yours. The holding has not begun." },
  1: { name: "Foundation", standing: "The first walls rise. This is where a holding is made." },
  2: { name: "Expansion", standing: "The road has noticed. The land reaches past one claim." },
  3: { name: "Expansion", standing: "A House at your back. The holding is a name now." },
  4: { name: "Mastery", standing: "The realm has learned to say it. The climb is steep here." },
  5: { name: "Mastery", standing: "A crown, and a court of your own. The land answered." },
};

/**
 * The chapter band — a slim header on the estate naming where the land stands
 * on the climb (Foundation / Expansion / Mastery) and the next beat ahead in
 * the Cairn's voice. PLAYER_JOURNEY_GAMEPLAN.md §6.1.
 */
export function ChapterBand() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { act, ownsCastle } = useAct();

  const chapter = CHAPTERS[act];
  const facts = buildChronicleFacts(
    playerData?.account,
    estateData?.account,
    ownsCastle,
  );
  const next = nextBeat(facts);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-default bg-surface-raised/40 px-4 py-2.5">
      <span className="font-display text-sm font-bold tracking-wide tier-title">
        {chapter.name}
      </span>
      <span className="h-3 w-px shrink-0 bg-border-default" />
      <p className="min-w-0 flex-1 truncate text-xs leading-relaxed text-text-secondary">
        {next ? next.framing : chapter.standing}
      </p>
    </div>
  );
}
