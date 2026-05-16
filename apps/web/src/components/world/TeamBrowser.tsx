"use client";

import { useState, useMemo } from "react";
import { useWorldTeams, useCitizenStatus } from "@/lib/hooks/world";
import { TeamCard } from "@/components/shared/TeamCard";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import { systemFraming } from "@/lib/narrative";
import { useTransitionStore } from "@/lib/store/transition";
import { createTeamJoinInstruction } from "novus-mundus-sdk";

const HOUSE_FRAMING = systemFraming("house");

type SortOption = "members" | "treasury" | "name" | "newest";

export function TeamBrowser() {
  const { data: teams, isLoading } = useWorldTeams();
  const citizen = useCitizenStatus();
  const [search, setSearch] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("members");

  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();

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

  const handleJoin = async (
    t: (typeof filtered)[number],
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const slots = await client.fetchTeamMembers(t.pubkey);
    const usedSlots = new Set(slots.map((s) => s.account.slotIndex));
    let freeSlot = -1;
    for (let i = 0; i < t.account.maxMembers; i++) {
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
          <p className="text-sm text-text-muted">
            No House answers to that search.
          </p>
        </div>
      )}

      {citizen.isCitizen && !citizenHasTeam && (
        <div className="card accent-border">
          <h3 className="mb-1 text-sm font-semibold text-text-primary">
            Raise your own banner.
          </h3>
          <p className="text-xs text-text-muted">
            No House here suits you? Found one of your own on the Team screen and
            let others swear to it.
          </p>
        </div>
      )}

      <div className="text-center text-xs text-text-muted">
        {filtered.length} House{filtered.length !== 1 ? "s" : ""} on the rolls
      </div>
    </div>
  );
}
