"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  parseRally,
  derivePlayerPda,
  deriveEstatePda,
  createRallyJoinInstruction,
  createRallyExecuteInstruction,
  createRallyCancelInstruction,
  createRallyProcessReturnInstruction,
  createRallyCloseInstruction,
  canCloseRally,
  RallyStatus,
  isNullPubkey,
  isTraveling,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  WEAPON_LABELS,
} from "@/components/shared/TripleCountInput";
import { formatTime } from "@/lib/utils";
import { useMorphActions } from "@/lib/hooks/useMorphActions";

const TARGET_TYPE = ["Player", "Encounter", "Castle"];
const ENCOUNTER_RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "World Event"];

interface RallyDetailPanelProps {
  rallyPubkey: string;
}

/**
 * Detail + join view for a joinable team rally — opened from the Rally tab's
 * "Joinable Team Rallies" list into the RightPanel. Shows the gather window,
 * the march/combat timeline, the target encounter, and a self-contained join
 * (troop commitment + hero).
 */
export function RallyDetailPanel({ rallyPubkey }: RallyDetailPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const close = useRightPanelStore((s) => s.close);

  const rallyKey = useMemo(() => new PublicKey(rallyPubkey), [rallyPubkey]);

  const { data: rally, isLoading } = useQuery({
    queryKey: ["rally", "detail", rallyPubkey],
    queryFn: async () => {
      const info = await connection.getAccountInfo(rallyKey);
      return info ? parseRally(info) : null;
    },
    staleTime: 10_000,
  });

  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const lockedHeroes = useLockedHeroes();
  const [heroSlot, setHeroSlot] = useState(NO_HERO_SLOT);
  const [units, setUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [weapons, setWeapons] = useState<[number, number, number]>([0, 0, 0]);
  const [nextOpen, setNextOpen] = useState(false);

  const ownedUnits: [number, number, number] = [
    player?.defensiveUnit1?.toNumber?.() ?? 0,
    player?.defensiveUnit2?.toNumber?.() ?? 0,
    player?.defensiveUnit3?.toNumber?.() ?? 0,
  ];
  const ownedWeapons: [number, number, number] = [
    player?.meleeWeapons?.toNumber?.() ?? 0,
    player?.rangedWeapons?.toNumber?.() ?? 0,
    player?.siegeWeapons?.toNumber?.() ?? 0,
  ];

  // The target encounter, when this rally hunts one — matched out of the
  // rally's target city.
  const encounterCity = rally && rally.targetType === 1 ? rally.targetCity : null;
  const { data: encounters } = useEncounters(encounterCity);
  const targetEncounter = useMemo(() => {
    if (!rally || rally.targetType !== 1) return null;
    return (encounters ?? []).find((e) => e.pubkey.equals(rally.target)) ?? null;
  }, [encounters, rally]);

  const handleJoin = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");
    if (!teamId) throw new Error("Team not loaded");
    const joinHero = heroSlot < 3 ? lockedHeroes[heroSlot] : null;
    const ix = createRallyJoinInstruction(
      {
        owner: publicKey,
        gameEngine: client.gameEngine,
        rally: rallyKey,
        rallyCreator: rally.creator,
        rallyId: rally.id.toNumber(),
        teamId: teamId.toNumber(),
        rallyCityId: rally.rallyCity ?? 0,
      },
      {
        defensiveUnit1: units[0],
        defensiveUnit2: units[1],
        defensiveUnit3: units[2],
        meleeWeapons: weapons[0],
        rangedWeapons: weapons[1],
        siegeWeapons: weapons[2],
        heroSlotIndex: joinHero ? heroSlot : NO_HERO_SLOT,
        heroMint: joinHero?.mint,
        heroTemplateId: joinHero?.templateId,
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Joined rally!",
        onPhase: reportPhase,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  // March = execute the rally — sends the gathered force at the target.
  // rally_execute expects 4 fixed accounts + one RallyParticipant account per
  // participant, so we fetch the participant PDAs and pass them (leader first).
  const handleMarch = async (reportPhase: (p: TxPhase) => void) => {
    if (!rally) throw new Error("Rally not loaded");
    const ge = client.gameEngine;
    const [leaderPlayer] = derivePlayerPda(ge, rally.creator);
    const [leaderEstate] = deriveEstatePda(leaderPlayer);
    const parts = await client.fetchRallyParticipants(rallyKey, rally);
    const ordered = [...parts].sort(
      (a, b) => Number(b.account.isLeader) - Number(a.account.isLeader),
    );
    const ix = createRallyExecuteInstruction({
      gameEngine: ge,
      rally: rallyKey,
      target: rally.target,
      leaderEstate,
      rallyParticipants: ordered.map((p) => p.pubkey),
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Rally is marching!",
        onPhase: reportPhase,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  const handleCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");
    const ix = createRallyCancelInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
      rally: rallyKey,
      rallyId: rally.id.toNumber(),
      rallyCityId: rally.rallyCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Rally cancelled.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature); // panel stays open — re-renders into the cancelled state
  };

  // Settle an ended rally. Processes the viewer's return and — when that
  // return (or a prior one) leaves every participant home — bundles the
  // permissionless close into the *same* transaction, so a rally that only
  // needs the viewer resolves in a single click. close_rally runs after
  // process_return within the tx, so the returned_count it checks is current.
  const handleResolve = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");

    const returnedCount = rally.returnedCount ?? 0;
    const participantCount = rally.participantCount ?? 0;
    // Once this return lands, is every participant accounted for?
    const willClose = closeable || returnedCount + 1 >= participantCount;

    const instructions = [];
    if (!closeable) {
      instructions.push(
        createRallyProcessReturnInstruction({
          gameEngine: client.gameEngine,
          rally: rallyKey,
          rallyCreator: rally.creator,
          rallyId: rally.id.toNumber(),
          participantOwner: publicKey,
          rallyCityId: rally.rallyCity ?? 0,
          homeCityId: player?.currentCity ?? 0,
        }),
      );
    }
    if (willClose) {
      instructions.push(
        createRallyCloseInstruction({
          rally: rallyKey,
          leaderOwner: rally.creator,
        }),
      );
    }

    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"], ["rally"]],
        successMessage: closeable
          ? "Rally closed."
          : willClose
            ? "Return processed and rally closed."
            : "Return processed.",
        onPhase: reportPhase,
      })
      .then((r) => {
        if (willClose) close();
        return r.signature;
      });
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading rally…</p>;
  }
  if (!rally) {
    return <p className="text-sm text-text-muted">This rally is no longer available.</p>;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const gatherAt = rally.gatherAt?.toNumber?.() ?? 0;
  const createdAt = rally.createdAt?.toNumber?.() ?? 0;
  const gatherDone = gatherAt > 0 && nowSec >= gatherAt;
  const marchDuration = rally.marchDuration ?? 0;
  const traveling = player ? isTraveling(player) : false;
  const full = (rally.participantCount ?? 0) >= (rally.maxParticipants ?? 0);
  const noCommit = units.every((n) => n === 0) && weapons.every((n) => n === 0);
  const isCreator = !!publicKey && rally.creator.equals(publicKey);
  const minParticipants = rally.minParticipants || 2;
  const joinedCount = rally.participantCount ?? 0;
  const enoughForMarch = joinedCount >= minParticipants;

  // Rally lifecycle — every section below keys off this.
  const status = rally.status ?? RallyStatus.Gathering;
  const isGathering = status === RallyStatus.Gathering;
  const isReturning = status === RallyStatus.Returning;
  const isCompleted = status === RallyStatus.Completed;
  const isCancelled = status === RallyStatus.Cancelled;
  const inFlight = status === RallyStatus.Marching || status === RallyStatus.Combat;

  // March only while gathering, once enough members joined and the gather
  // window (== execute_at on-chain) has elapsed.
  const canMarch = isGathering && gatherDone && enoughForMarch && !traveling;
  // Close only after the rally has ended and all participants returned.
  const closeable = canCloseRally(rally);

  // Join is omitted from the morph bar — the sheet still needs the troop/weapon
  // /hero inputs visible above the bar, and committing zero is the most common
  // failure mode.
  const morphActions = (() => {
    if (isGathering && isCreator) {
      return [
        {
          id: "march-rally",
          label: !enoughForMarch
            ? "March (missing participants)"
            : !gatherDone
              ? "March (after gather)"
              : "March Rally",
          variant: "primary" as const,
          disabled: !canMarch,
          onClick: handleMarch,
        },
        {
          id: "cancel-rally",
          label: "Cancel Rally",
          variant: "danger" as const,
          onClick: handleCancel,
        },
      ];
    }
    if (isReturning || isCompleted || isCancelled) {
      return [
        {
          id: "resolve-rally",
          label: closeable
            ? "Close Rally"
            : (rally.returnedCount ?? 0) + 1 >= joinedCount
              ? "Return & Close"
              : "Process Return",
          variant: "primary" as const,
          onClick: handleResolve,
        },
      ];
    }
    return null;
  })();
  useMorphActions(morphActions);

  // Post-gathering status line, shown in place of the gather window.
  const statusBanner = isCancelled
    ? { text: "This rally was cancelled.", tone: "text-red-400" }
    : isCompleted
      ? { text: "The rally is complete.", tone: "text-green-400" }
      : isReturning
        ? { text: "The rally is returning home.", tone: "text-text-secondary" }
        : status === RallyStatus.Combat
          ? { text: "The rally is in combat.", tone: "text-text-gold" }
          : { text: "The rally is marching to its target.", tone: "text-text-gold" };

  return (
    <div className="space-y-4">
      {/* Leader + target type */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted">Led by</div>
          <div className="font-mono text-sm text-text-primary">
            <DomainName pubkey={rally.creator} chars={4} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">Target</div>
          <div className="text-sm text-text-primary">{TARGET_TYPE[rally.targetType ?? 0]}</div>
        </div>
      </div>

      {/* Status — the gather window while gathering, a status line after */}
      <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
        {isGathering ? (
          gatherDone ? (
            <div className="text-sm font-semibold text-green-400">Gathering complete</div>
          ) : (
            <GoldCountdown
              endsAt={gatherAt}
              startedAt={createdAt}
              label="Gather window"
              showProgress
              format="compact"
            />
          )
        ) : (
          <div className={`text-sm font-semibold ${statusBanner.tone}`}>{statusBanner.text}</div>
        )}
      </div>

      {/* What happens next — only meaningful while gathering */}
      {isGathering && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 text-xs">
          <button
            type="button"
            onClick={() => setNextOpen((v) => !v)}
            className="flex w-full items-center justify-between p-3 text-left font-semibold uppercase tracking-wider text-text-muted"
          >
            <span>What happens next</span>
            <span aria-hidden>{nextOpen ? "▾" : "▸"}</span>
          </button>
          {nextOpen && (
            <div className="px-3 pb-3">
              <ol className="space-y-1.5">
                <li className={gatherDone ? "text-zinc-600 line-through" : "text-text-secondary"}>
                  1. Gather — members commit troops
                  {gatherDone ? "" : " (in progress)"}
                </li>
                <li className="text-text-secondary">
                  2. March — the leader sends the rally at the target
                  {marchDuration > 0 ? ` (~${formatTime(marchDuration, "compact")})` : ""}
                </li>
                <li className="text-text-secondary">
                  3. Combat — the rally attacks once it arrives
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Target encounter — while the target still matters */}
      {rally.targetType === 1 && !isCancelled && !isCompleted && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Encounter
          </div>
          {targetEncounter ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-primary">
                  #{targetEncounter.account.id.toString()} ·{" "}
                  {ENCOUNTER_RARITY[targetEncounter.account.rarity] ?? "—"}
                </span>
                <span className="text-text-muted">Lv {targetEncounter.account.level}</span>
              </div>
              {(() => {
                const hp = targetEncounter.account.health?.toNumber?.() ?? 0;
                const maxHp = targetEncounter.account.maxHealth?.toNumber?.() ?? 0;
                const pct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
                return (
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-text-muted">
                      <span>Health</span>
                      <span>
                        {hp.toLocaleString()} / {maxHp.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              <div className="flex justify-between text-xs text-text-muted">
                <span>Defense {targetEncounter.account.defense}</span>
                <span>{targetEncounter.account.attackerCount} attacking</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Encounter details unavailable — it may be in another city or already cleared.
            </p>
          )}
        </div>
      )}

      {/* Force gathered so far */}
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Joined</div>
          <div className="text-sm font-semibold text-text-primary">
            {rally.participantCount ?? 0}/{rally.maxParticipants ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Units</div>
          <GoldNumber value={rally.totalUnits?.toNumber?.() ?? 0} size="sm" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Power</div>
          <GoldNumber value={rally.totalPower?.toNumber?.() ?? 0} size="sm" />
        </div>
      </div>

      {/* Gathering — the leader marches or cancels */}
      {isGathering && isCreator && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border-gold/40 bg-accent/10 p-3 text-xs text-text-muted">
            This is your rally — you committed troops when you raised it. Marching sends the
            gathered force at the target.
          </div>

          {traveling && (
            <p className="text-xs text-danger">
              You are traveling — rally actions may be restricted.
            </p>
          )}

          <TxButton onClick={handleMarch} disabled={!canMarch} className="hidden lg:block">
            {!enoughForMarch
              ? "March Rally (missing participants)"
              : !gatherDone
                ? "March (after gather window)"
                : "March Rally"}
          </TxButton>
          <TxButton onClick={handleCancel} variant="danger" className="hidden lg:block">
            Cancel Rally
          </TxButton>
        </div>
      )}

      {/* In flight — nothing to do here until it returns home */}
      {inFlight && (
        <div className="rounded-lg border border-border-gold/40 bg-accent/10 p-3 text-xs text-text-muted">
          The rally is underway. Return and close unlock once it comes home.
        </div>
      )}

      {/* Ended or returning — recover committed troops, then close */}
      {(isReturning || isCompleted || isCancelled) && (
        <div className="space-y-3">
          {isCancelled && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3 text-xs text-text-muted">
              The rally was called off. Recover the troops and weapons you committed — once everyone
              is home the rally closes in the same step.
            </div>
          )}
          <TxButton onClick={handleResolve} className="hidden lg:block">
            {closeable
              ? "Close Rally"
              : (rally.returnedCount ?? 0) + 1 >= joinedCount
                ? "Process Return & Close"
                : "Process Return"}
          </TxButton>
        </div>
      )}

      {/* Gathering — a teammate commits troops and joins */}
      {isGathering && !isCreator && (
        <>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Your defensive units
            </div>
            <TripleCountInput
              labels={DEFENSIVE_UNIT_LABELS}
              available={ownedUnits}
              value={units}
              onChange={setUnits}
            />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Your weapons
            </div>
            <TripleCountInput
              labels={WEAPON_LABELS}
              available={ownedWeapons}
              value={weapons}
              onChange={setWeapons}
            />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Hero
            </div>
            <select
              value={heroSlot}
              onChange={(e) => setHeroSlot(Number(e.target.value))}
              className="w-full rounded border border-zinc-800 bg-surface px-2 py-1.5 text-sm text-text-primary"
            >
              <option value={NO_HERO_SLOT}>No hero</option>
              {lockedHeroes.map((h, i) =>
                h ? (
                  <option key={i} value={i}>
                    Slot {i}: {h.name}
                  </option>
                ) : null,
              )}
            </select>
          </div>

          {traveling && (
            <p className="text-xs text-danger">You are traveling — joining may be restricted.</p>
          )}

          <TxButton onClick={handleJoin} disabled={traveling || full || noCommit || !teamId}>
            {full ? "Rally is full" : noCommit ? "Commit troops to join" : "Join Rally"}
          </TxButton>
        </>
      )}
    </div>
  );
}
