"use client";

import { useState, useMemo } from "react";
import { useWorldTeams, useCitizenStatus } from "@/lib/hooks/world";
import { TeamCard } from "@/components/shared/TeamCard";
import { Badge } from "@/components/shared/Badge";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { DomainName } from "@/components/shared/DomainName";
import { ViewToggle } from "@/components/shared/ViewToggle";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useViewMode } from "@/lib/hooks/useViewMode";
import Link from "next/link";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { effectiveTeamCapacity } from "@/lib/teamCapacity";
import { systemFraming } from "@/lib/narrative";
import { useTransitionStore } from "@/lib/store/transition";
import { createTeamJoinInstruction, parsePlayer } from "novus-mundus-sdk";

const HOUSE_FRAMING = systemFraming("house");

type SortOption = "members" | "treasury" | "name" | "newest";

export function TeamBrowser() {
  const { data: teams, isLoading } = useWorldTeams();
  const citizen = useCitizenStatus();
  const [search, setSearch] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("members");
  const [view, setView] = useViewMode("teams");

  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const nowSec = useChainNow();

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
        result.sort((a, b) => b.account.treasury.toNumber() - a.account.treasury.toNumber());
        break;
      case "name":
        result.sort((a, b) => a.account.name.localeCompare(b.account.name));
        break;
      case "newest":
        result.sort((a, b) => b.account.createdAt.toNumber() - a.account.createdAt.toNumber());
        break;
    }

    return result;
  }, [teams, search, publicOnly, sort]);

  const citizenHasTeam =
    citizen.isCitizen &&
    citizen.player &&
    citizen.player.team.toBase58() !== "11111111111111111111111111111111";

  const handleJoin = async (t: (typeof filtered)[number], reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    // Capacity follows the leader's live subscription tier, not the stored cap.
    const leaderInfo = await connection.getAccountInfo(t.account.leader);
    const leaderCore = leaderInfo ? parsePlayer(leaderInfo) : null;
    const capacity = effectiveTeamCapacity(t.account, leaderCore, nowSec);
    const slots = await client.fetchTeamMembers(t.pubkey);
    const usedSlots = new Set(slots.map((s) => s.account.slotIndex));
    let freeSlot = -1;
    for (let i = 0; i < capacity; i++) {
      if (!usedSlots.has(i)) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot < 0) throw new Error("Team is full");
    const ix = createTeamJoinInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
      team: t.pubkey,
      teamId: t.account.id.toNumber(),
      slotIndex: freeSlot,
      leaderPlayer: t.account.leader,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"], ["teamMembers"]],
        successMessage: `Joined ${t.account.name}!`,
        onPhase: reportPhase,
      })
      .then((r) => {
        useTransitionStore.getState().triggerActBeat({ act: 3, phase: "oath" });
        return r.signature;
      });
  };

  const columns: Column<(typeof filtered)[number]>[] = [
    {
      key: "house",
      header: "House",
      cell: (t) => {
        const isPublic = (t.account.settings & 1) !== 0;
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/world/teams/${t.account.id.toNumber()}`}
              className="font-medium text-text-primary transition-colors hover:text-text-gold"
            >
              {t.account.name || `Team #${t.account.id.toNumber()}`}
            </Link>
            <Badge variant={isPublic ? "success" : "default"} className="px-1 py-0 text-[10px]">
              {isPublic ? "Public" : "Private"}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "members",
      header: "Sworn Blades",
      align: "center",
      className: "w-32",
      cell: (t) => (
        <span>
          {t.account.memberCount}/{t.account.maxMembers}
          {t.account.minLevelToJoin > 1 && (
            <span className="ml-1 text-text-muted">· Lv {t.account.minLevelToJoin}+</span>
          )}
        </span>
      ),
    },
    {
      key: "treasury",
      header: "War-chest",
      align: "right",
      className: "hidden w-28 sm:table-cell",
      cell: (t) => (
        <span className="inline-flex items-center justify-end gap-1">
          <GameIcon id="resource-cash" size={14} />
          <GoldNumber value={t.account.treasury.toNumber()} size="sm" />
        </span>
      ),
    },
    {
      key: "leader",
      header: "Leader",
      className: "hidden w-28 md:table-cell",
      cell: (t) => <DomainName pubkey={t.account.leader} chars={4} />,
    },
  ];
  if (citizen.isCitizen && !citizenHasTeam) {
    columns.push({
      key: "action",
      header: "",
      align: "right",
      className: "w-24",
      cell: (t) => {
        const isPublic = (t.account.settings & 1) !== 0;
        if (!isPublic) return null;
        return (
          <TxButton onClick={(rp) => handleJoin(t, rp)} variant="secondary" className="text-xs">
            Swear In
          </TxButton>
        );
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Reading the rolls of the Houses...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          {HOUSE_FRAMING.title}
        </h2>
        <p className="mt-1 text-xs italic text-text-muted">{HOUSE_FRAMING.line}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search Houses..."
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
          <option value="members">Most Sworn Blades</option>
          <option value="treasury">Largest War-chest</option>
          <option value="name">Name (A-Z)</option>
          <option value="newest">Newest Banner</option>
        </select>
        <ViewToggle mode={view} onChange={setView} className="ml-auto" />
      </div>

      {/* Grid / Table */}
      {view === "grid" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => {
              const isPublic = (t.account.settings & 1) !== 0;
              const canJoin = citizen.isCitizen && !citizenHasTeam && isPublic;

              return (
                <TeamCard
                  key={t.pubkey.toBase58()}
                  teamId={t.account.id.toNumber()}
                  team={t.account}
                  lordlyLabels
                  actions={
                    canJoin ? (
                      <TxButton
                        onClick={(rp) => handleJoin(t, rp)}
                        variant="secondary"
                        className="text-xs"
                      >
                        Swear In
                      </TxButton>
                    ) : undefined
                  }
                />
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="card">
              <p className="text-sm text-text-muted">No House answers to that search.</p>
            </div>
          )}
        </>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.pubkey.toBase58()}
          empty="No House answers to that search."
        />
      )}

      {citizen.isCitizen && !citizenHasTeam && (
        <div className="card accent-border">
          <h3 className="mb-1 text-sm font-semibold text-text-primary">Raise your own banner.</h3>
          <p className="text-xs text-text-muted">
            No House here suits you? Found one of your own on the Team screen and let others swear
            to it.
          </p>
        </div>
      )}

      <div className="text-center text-xs text-text-muted">
        {filtered.length} House{filtered.length !== 1 ? "s" : ""} on the rolls
      </div>
    </div>
  );
}
