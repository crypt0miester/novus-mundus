"use client";

import { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import Link from "next/link";
import { animate, utils } from "animejs";
import {
  useWorldPlayers,
  useWorldCities,
  useWorldTeams,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { cn, shortenAddress, prefersReducedMotion } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { playerScore } from "@/lib/players";
import { REORDER, DUR } from "@/lib/motion/tokens";

const TABS = [
  { key: "networth", label: "Networth" },
  { key: "combat", label: "Combat Power" },
  { key: "level", label: "Level" },
  { key: "reputation", label: "Reputation" },
  { key: "attacks", label: "Attacks" },
  { key: "encounters", label: "Encounters" },
] as const;

type SortKey = (typeof TABS)[number]["key"];

const PAGE_SIZE = 50;

// Medal glow per podium rank: a one-shot box-shadow pulse when a row crosses the
// edge INTO the top 3. Box-shadow is main-thread paint, so this stays a short
// settling pulse (not an ambient loop) per the motion perf rules.
const MEDAL_GLOW: Record<number, string> = {
  1: "0 0 0px rgba(251,191,36,0)",
  2: "0 0 0px rgba(212,212,216,0)",
  3: "0 0 0px rgba(180,83,9,0)",
};
const MEDAL_GLOW_PEAK: Record<number, string> = {
  1: "0 0 18px rgba(251,191,36,0.55)",
  2: "0 0 16px rgba(212,212,216,0.45)",
  3: "0 0 16px rgba(180,83,9,0.45)",
};

export function LeaderboardView() {
  const { data: players, isLoading } = useWorldPlayers();
  const { data: cities } = useWorldCities();
  const { data: teams } = useWorldTeams();
  const citizen = useCitizenStatus();
  const [activeTab, setActiveTab] = useState<SortKey>("networth");
  const [page, setPage] = useState(0);
  const reduce = useReducedMotion();

  const cityMap = useMemo(() => {
    if (!cities) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const c of cities) {
      map.set(c.account.cityId, c.account.name);
    }
    return map;
  }, [cities]);

  const teamMap = useMemo(() => {
    if (!teams) return new Map<string, { id: number; name: string }>();
    const map = new Map<string, { id: number; name: string }>();
    for (const t of teams) {
      map.set(t.pubkey.toBase58(), {
        id: t.account.id.toNumber(),
        name: t.account.name,
      });
    }
    return map;
  }, [teams]);

  const sorted = useMemo(() => {
    if (!players) return [];
    return [...players].sort(
      (a, b) => playerScore(b.account, activeTab) - playerScore(a.account, activeTab),
    );
  }, [players, activeTab]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pageOwners = useMemo(() => pageData.map((p) => p.account.owner), [pageData]);
  const domainNames = useDomainNames(pageOwners);

  // Per-row identity keyed by on-chain pubkey, so the FLIP and count-up follow
  // the same player across a metric switch rather than tracking DOM index.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const setRowRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  // First rects from the PREVIOUS committed layout. Compared against the freshly
  // committed Last rects to invert and play back to identity.
  const prevRects = useRef(new Map<string, DOMRect>());
  // In-flight FLIP tweens, cancelled (never reverted) on the next reflow / unmount.
  const flipAnims = useRef<Array<{ cancel?: () => void }>>([]);

  // Target scores for the currently visible rows, keyed by pubkey.
  const targetScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pageData) {
      map.set(p.pubkey.toBase58(), playerScore(p.account, activeTab));
    }
    return map;
    // pageData identity changes with players / activeTab / page, which is exactly
    // when the visible scores can change.
  }, [pageData, activeTab]);

  // Displayed (possibly mid-count-up) scores fed to GoldNumber as a controlled
  // value. Seeded to the first target set so the initial paint is truthful.
  const [displayScores, setDisplayScores] = useState<Map<string, number>>(targetScores);
  const displayRef = useRef(displayScores);
  displayRef.current = displayScores;
  const countAnim = useRef<{ cancel?: () => void } | null>(null);

  // A layout signature that flips only when the visible ordering / paging can
  // actually move a row. Re-renders from a background data poll that leave the
  // order intact will not retrigger the FLIP.
  const orderSig = pageData.map((p) => p.pubkey.toBase58()).join(",");

  // FLIP: runs after commit (rows already reordered) but before paint, so we can
  // invert each visible row to its old slot and play the delta to zero. Capturing
  // the "First" rects relies on useLayoutEffect ordering: prevRects holds the
  // pre-reorder layout recorded at the end of the last run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the order signature; rect maps + reduce are read imperatively and intentionally untracked.
  useLayoutEffect(() => {
    const rows = rowRefs.current;
    // Reduced motion: snap. Record Last rects for a truthful next diff, no invert.
    if (prefersReducedMotion()) {
      const next = new Map<string, DOMRect>();
      for (const [key, el] of rows) next.set(key, el.getBoundingClientRect());
      prevRects.current = next;
      return;
    }

    // Retarget cleanly if a previous reflow is still settling.
    for (const a of flipAnims.current) a.cancel?.();
    flipAnims.current = [];

    // Batch all reads first (avoid layout thrash), then all writes.
    const next = new Map<string, DOMRect>();
    const deltas: Array<[HTMLDivElement, number]> = [];
    for (const [key, el] of rows) {
      const last = el.getBoundingClientRect();
      next.set(key, last);
      const first = prevRects.current.get(key);
      // No prior rect means the row is paging in/out: guard dy and skip the
      // invert so it does not fly in from an arbitrary off-screen origin.
      if (!first) continue;
      const dy = first.top - last.top;
      if (dy) deltas.push([el, dy]);
    }
    prevRects.current = next;

    for (const [el, dy] of deltas) {
      // Invert to the old position, play back to identity. composition "replace"
      // so an overlapping reflow retargets without snapping back; cancel() (never
      // revert) handles interruption and leaves the settled transform alone.
      const a = animate(el, {
        translateY: [dy, 0],
        ease: REORDER,
        composition: "replace",
      });
      flipAnims.current.push(a);
    }
  }, [orderSig]);

  // Synchronized count-up: tween every visible row's displayed score from its old
  // value to the new target on the same beat as the FLIP. Plain-object tween, one
  // shared clock, writing whole rows of numbers per frame (GoldNumber renders the
  // controlled value as a static span, so this stays cheap). The previous displayed
  // values are read off a ref to seed the tween, so they stay out of the deps.
  useEffect(() => {
    countAnim.current?.cancel?.();
    const from = displayRef.current;

    // Reduced motion: set final values directly, skip the count-up.
    if (reduce) {
      setDisplayScores(targetScores);
      return;
    }

    // Nothing to roll if every visible score already matches (e.g. a benign
    // re-render). Still commit the target map so newly-visible rows are exact.
    let changed = false;
    for (const [key, target] of targetScores) {
      if (from.get(key) !== target) {
        changed = true;
        break;
      }
    }
    if (!changed && from.size === targetScores.size) {
      return;
    }

    const proxy = { t: 0 };
    const start = new Map(from);
    const a = animate(proxy, {
      t: [0, 1],
      duration: DUR.base,
      ease: "outQuart",
      onUpdate: () => {
        const frame = new Map<string, number>();
        for (const [key, target] of targetScores) {
          const begin = start.get(key) ?? target;
          frame.set(key, utils.round(begin + (target - begin) * proxy.t, 0));
        }
        setDisplayScores(frame);
      },
      onComplete: () => {
        setDisplayScores(new Map(targetScores));
      },
    });
    countAnim.current = a;
    return () => {
      a.cancel?.();
    };
  }, [targetScores, reduce]);

  // Medal glow: edge-detect rows entering the top 3 (Set-diff of podium pubkeys
  // across reorders) and fire a one-shot rank-colored glow pulse. Fires on the
  // EDGE only, not every render or background poll.
  const prevPodium = useRef(new Set<string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: edge-detected against the order signature; the podium set is read/written imperatively.
  useLayoutEffect(() => {
    const onFirstPage = page === 0;
    const nextPodium = new Set<string>();
    if (onFirstPage) {
      for (let i = 0; i < Math.min(3, pageData.length); i++) {
        nextPodium.add(pageData[i].pubkey.toBase58());
      }
    }

    if (!prefersReducedMotion()) {
      for (const key of nextPodium) {
        if (prevPodium.current.has(key)) continue;
        const el = rowRefs.current.get(key);
        if (!el) continue;
        const rank = pageData.findIndex((p) => p.pubkey.toBase58() === key) + 1;
        const base = MEDAL_GLOW[rank];
        const peak = MEDAL_GLOW_PEAK[rank];
        if (!base || !peak) continue;
        animate(el, {
          boxShadow: [base, peak, base],
          duration: DUR.slow,
          ease: "outQuad",
        });
      }
    }
    prevPodium.current = nextPodium;
  }, [orderSig, page]);

  // Cancel any in-flight FLIP / count-up on unmount without reverting (FLIP
  // settles to identity on its own; reverting would wipe the committed transform).
  useEffect(() => {
    return () => {
      for (const a of flipAnims.current) a.cancel?.();
      countAnim.current?.cancel?.();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading leaderboard...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Citizen highlight */}
      {citizen.isCitizen && citizen.player && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted">
                Your {TABS.find((t) => t.key === activeTab)?.label}
              </div>
              <GoldNumber value={playerScore(citizen.player, activeTab)} prefix="◆ " />
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Level</div>
              <div className="text-2xl font-bold text-text-gold">{citizen.player.level}</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface p-1 scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setPage(0);
            }}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-surface-raised text-text-gold"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="space-y-1">
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-2 text-xs font-semibold uppercase text-text-muted">
            <span className="w-12 text-center">#</span>
            <span className="flex-1">Player</span>
            <span className="hidden w-24 text-right sm:block">Team</span>
            <span className="hidden w-28 text-right sm:block">City</span>
            <span className="w-24 text-right">Score</span>
          </div>
          {pageData.map((p, i) => {
            const rank = page * PAGE_SIZE + i + 1;
            const key = p.pubkey.toBase58();
            const isSelf =
              citizen.isCitizen &&
              citizen.player &&
              p.account.owner.toBase58() === citizen.player.owner.toBase58();
            const target = targetScores.get(key) ?? playerScore(p.account, activeTab);
            const display = displayScores.get(key);

            return (
              <div
                key={key}
                ref={(el) => setRowRef(key, el)}
                style={{ willChange: "transform" }}
                className={cn(
                  "flex items-center gap-4 rounded-lg px-2 py-2",
                  rank <= 3 && "bg-accent/10",
                  isSelf && "accent-border-bright",
                )}
              >
                <span
                  className={cn(
                    "w-12 text-center text-sm font-bold",
                    rank === 1
                      ? "text-gold-400"
                      : rank === 2
                        ? "text-zinc-300"
                        : rank === 3
                          ? "text-gold-700"
                          : "text-text-muted",
                  )}
                >
                  {rank}
                </span>
                <Link
                  href={`/world/players/${p.account.owner.toBase58()}`}
                  className="flex-1 truncate text-sm text-text-secondary hover:text-text-gold transition-colors"
                >
                  {p.account.name ||
                    domainNames.get(p.account.owner.toBase58()) ||
                    shortenAddress(p.account.owner.toBase58())}
                  {(p.account.name || domainNames.get(p.account.owner.toBase58())) && (
                    <span className="ml-1 text-text-muted">Lv{p.account.level}</span>
                  )}
                </Link>
                <span className="hidden w-24 truncate text-right text-xs sm:block">
                  {(() => {
                    const teamPda = p.account.team.toBase58();
                    if (teamPda === "11111111111111111111111111111111")
                      return <span className="text-text-muted">-</span>;
                    const tInfo = teamMap.get(teamPda);
                    if (!tInfo) return <span className="text-text-muted">-</span>;
                    return (
                      <Link
                        href={`/world/teams/${tInfo.id}`}
                        className="text-text-secondary hover:text-text-gold transition-colors"
                      >
                        {tInfo.name || `#${tInfo.id}`}
                      </Link>
                    );
                  })()}
                </span>
                <span className="hidden w-28 truncate text-right text-xs text-text-muted sm:block">
                  {cityMap.get(p.account.currentCity) ?? "-"}
                </span>
                <span className="w-24 text-right">
                  <GoldNumber
                    value={target}
                    controlledValue={display}
                    size="sm"
                    glow={rank <= 3}
                  />
                </span>
              </div>
            );
          })}
          {pageData.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">No players found.</p>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded px-3 py-1 text-xs text-text-secondary hover:text-text-gold disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-text-muted">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded px-3 py-1 text-xs text-text-secondary hover:text-text-gold disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
