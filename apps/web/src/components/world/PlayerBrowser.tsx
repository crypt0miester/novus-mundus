"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useWorldPlayers,
  useWorldCities,
  useWorldTeams,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { useViewMode } from "@/lib/hooks/useViewMode";
import { PlayerCard } from "@/components/shared/PlayerCard";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { ViewToggle } from "@/components/shared/ViewToggle";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { matchesPlayerQuery, playerScore } from "@/lib/players";
import { shortenAddress } from "@/lib/utils";
import { isNullPubkey } from "novus-mundus-sdk";
import type { PlayerAccount } from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";

type PlayerRow = { pubkey: PublicKey; account: PlayerAccount };

const SORTS = [
  { key: "networth", label: "Networth" },
  { key: "level", label: "Level" },
  { key: "combat", label: "Combat Power" },
  { key: "reputation", label: "Reputation" },
  { key: "newest", label: "Newest" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

const PAGE_SIZE = 48;

/**
 * Browsable, searchable directory of every player in the realm — the answer to
 * "find a player". Sortable, paginated, with a card grid or a compact table.
 */
export function PlayerBrowser() {
  const { data: players, isLoading } = useWorldPlayers();
  const { data: cities } = useWorldCities();
  const { data: teams } = useWorldTeams();
  const citizen = useCitizenStatus();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("networth");
  const [page, setPage] = useState(0);
  const [view, setView] = useViewMode("players");

  const cityMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cities ?? []) m.set(c.account.cityId, c.account.name);
    return m;
  }, [cities]);

  const teamMap = useMemo(() => {
    const m = new Map<string, { id: number; name: string }>();
    for (const t of teams ?? [])
      m.set(t.pubkey.toBase58(), {
        id: t.account.id.toNumber(),
        name: t.account.name,
      });
    return m;
  }, [teams]);

  // Resolve every player's domain up front so the search can match it.
  const allOwners = useMemo(() => (players ?? []).map((p) => p.account.owner), [players]);
  const domainNames = useDomainNames(allOwners);

  const selfAddress = citizen.player?.owner.toBase58();

  // Search and sort are split so a domain resolving elsewhere — which hands
  // back a new `domainNames` map — re-filters but does not also re-sort.
  const searchFiltered = useMemo(() => {
    if (!players) return [] as PlayerRow[];
    return players.filter((p) =>
      matchesPlayerQuery(
        p.account,
        p.account.owner.toBase58(),
        domainNames.get(p.account.owner.toBase58()),
        search,
      ),
    );
  }, [players, search, domainNames]);

  const filtered = useMemo(
    () =>
      [...searchFiltered].sort(
        (a, b) => playerScore(b.account, sort) - playerScore(a.account, sort),
      ),
    [searchFiltered, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const columns: Column<PlayerRow>[] = [
    {
      key: "player",
      header: "Player",
      cell: (p) => {
        const addr = p.account.owner.toBase58();
        const label = p.account.name || domainNames.get(addr) || shortenAddress(addr, 4);
        return (
          <Link
            href={`/world/players/${addr}`}
            className="font-medium text-text-primary transition-colors hover:text-text-gold"
          >
            {label}
          </Link>
        );
      },
    },
    {
      key: "level",
      header: "Lv",
      align: "center",
      className: "w-14",
      cell: (p) => p.account.level,
    },
    {
      key: "city",
      header: "City",
      className: "hidden w-32 sm:table-cell",
      cell: (p) => cityMap.get(p.account.currentCity) ?? "—",
    },
    {
      key: "team",
      header: "Team",
      className: "hidden w-36 md:table-cell",
      cell: (p) => {
        if (isNullPubkey(p.account.team)) return <span className="text-text-muted">—</span>;
        const t = teamMap.get(p.account.team.toBase58());
        if (!t) return <span className="text-text-muted">—</span>;
        return (
          <Link href={`/world/teams/${t.id}`} className="transition-colors hover:text-text-gold">
            {t.name || `#${t.id}`}
          </Link>
        );
      },
    },
    {
      key: "networth",
      header: "Networth",
      align: "right",
      className: "w-28",
      cell: (p) => <GoldNumber value={p.account.networth.toNumber()} size="sm" />,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading players...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search players by name, domain, or address..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="min-w-[200px] flex-1 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-gold focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as SortKey);
            setPage(0);
          }}
          className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-border-gold focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <ViewToggle mode={view} onChange={setView} />
      </div>

      {/* List */}
      {view === "grid" ? (
        pageData.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pageData.map((p) => {
              const addr = p.account.owner.toBase58();
              return (
                <PlayerCard
                  key={addr}
                  address={addr}
                  player={p.account}
                  displayName={domainNames.get(addr) ?? shortenAddress(addr, 4)}
                  showCity
                  cityName={cityMap.get(p.account.currentCity)}
                  highlight={addr === selfAddress}
                />
              );
            })}
          </div>
        ) : (
          <div className="card">
            <p className="text-sm text-text-muted">No players match that search.</p>
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          rows={pageData}
          rowKey={(p) => p.account.owner.toBase58()}
          rowClassName={(p) => (p.account.owner.toBase58() === selfAddress ? "bg-accent/10" : "")}
          empty="No players match that search."
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="rounded px-3 py-1 text-xs text-text-secondary hover:text-text-gold disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-xs text-text-muted">
            {safePage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            disabled={safePage >= totalPages - 1}
            className="rounded px-3 py-1 text-xs text-text-secondary hover:text-text-gold disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}

      <div className="text-center text-xs text-text-muted">
        {filtered.length} player{filtered.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
