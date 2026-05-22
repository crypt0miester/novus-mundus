"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  useWorldPlayers,
  useWorldCities,
  useWorldTeams,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { cn, shortenAddress } from "@/lib/utils";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { playerScore } from "@/lib/players";

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

export function LeaderboardView() {
  const { data: players, isLoading } = useWorldPlayers();
  const { data: cities } = useWorldCities();
  const { data: teams } = useWorldTeams();
  const citizen = useCitizenStatus();
  const [activeTab, setActiveTab] = useState<SortKey>("networth");
  const [page, setPage] = useState(0);

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
            const isSelf =
              citizen.isCitizen &&
              citizen.player &&
              p.account.owner.toBase58() === citizen.player.owner.toBase58();

            return (
              <div
                key={p.pubkey.toBase58()}
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
                    value={playerScore(p.account, activeTab)}
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
