"use client";

import { useState, useMemo } from "react";
import { useWorldTeams, useCitizenStatus } from "@/lib/hooks/world";
import { TeamCard } from "@/components/shared/TeamCard";
import Link from "next/link";

type SortOption = "members" | "treasury" | "name" | "newest";

export function TeamBrowser() {
  const { data: teams, isLoading } = useWorldTeams();
  const citizen = useCitizenStatus();
  const [search, setSearch] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("members");

  const filtered = useMemo(() => {
    if (!teams) return [];
    let result = [...teams];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.account.name.toLowerCase().includes(q));
    }

    if (publicOnly) {
      result = result.filter((t) => (t.account.settings & 1) !== 0);
    }

    switch (sort) {
      case "members":
        result.sort((a, b) => b.account.memberCount - a.account.memberCount);
        break;
      case "treasury":
        result.sort(
          (a, b) => b.account.treasury.toNumber() - a.account.treasury.toNumber()
        );
        break;
      case "name":
        result.sort((a, b) => a.account.name.localeCompare(b.account.name));
        break;
      case "newest":
        result.sort(
          (a, b) => b.account.createdAt.toNumber() - a.account.createdAt.toNumber()
        );
        break;
    }

    return result;
  }, [teams, search, publicOnly, sort]);

  const citizenHasTeam =
    citizen.isCitizen &&
    citizen.player &&
    citizen.player.team.toBase58() !== "11111111111111111111111111111111";

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading teams...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search teams..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-gold focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={publicOnly}
            onChange={(e) => setPublicOnly(e.target.checked)}
            className="rounded border-zinc-700"
          />
          Public only
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-border-gold focus:outline-none"
        >
          <option value="members">Most Members</option>
          <option value="treasury">Highest Treasury</option>
          <option value="name">Name (A-Z)</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {/* Grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((t) => {
          const isPublic = (t.account.settings & 1) !== 0;
          const canJoin =
            citizen.isCitizen && !citizenHasTeam && isPublic;

          return (
            <TeamCard
              key={t.pubkey.toBase58()}
              teamId={t.account.id.toNumber()}
              team={t.account}
              actions={
                canJoin ? (
                  <Link
                    href={`/team?join=${t.account.id.toNumber()}`}
                    className="rounded border border-border-gold px-2 py-1 text-xs text-text-gold hover:bg-amber-900/20 transition-colors"
                  >
                    Join
                  </Link>
                ) : undefined
              }
            />
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="card">
          <p className="text-sm text-text-muted">
            No teams match your filters.
          </p>
        </div>
      )}

      <div className="text-center text-xs text-text-muted">
        {filtered.length} team{filtered.length !== 1 ? "s" : ""} found
      </div>
    </div>
  );
}
