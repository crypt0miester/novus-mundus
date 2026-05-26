"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  createRallyCreateInstruction,
  parsePlayer,
  parseEncounter,
  parseCastle,
  isNullPubkey,
  isTraveling,
  RallyTargetType,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { bnToSafeNumber } from "@/lib/utils";
import { useIsMountedRef } from "@/lib/hooks/useIsMountedRef";

/** Allowed gather windows, in minutes — matches the picks on the old Rally tab. */
const GATHER_OPTIONS = [5, 15, 60];
const TARGET_LABEL: Record<number, string> = {
  0: "player",
  1: "encounter",
  2: "castle",
};

interface RallyComposerPanelProps {
  /** Target account PDA (player, encounter, or castle) as base58. */
  targetPubkey: string;
  /** RallyTargetType: 0=Player, 1=Encounter, 2=Castle. */
  targetType: number;
  /** City where the target lives — required for the instruction. */
  targetCityId: number;
  /** Display label for the target (e.g. "Wild encounter", "Player #42"). */
  targetLabel?: string;
}

/**
 * Rally composer — extracted from the /team Rally tab "Create Rally" form,
 * with target/targetType preselected from the EntityPanel. The on-chain
 * rally is gathered in the creator's current city; the march travels to the
 * target's city. Creator must be on a team; chain rejects otherwise.
 */
export function RallyComposerPanel({
  targetPubkey,
  targetType,
  targetCityId,
  targetLabel,
}: RallyComposerPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const close = useRightPanelStore((s) => s.close);
  const isMounted = useIsMountedRef();

  const targetKey = useMemo(() => new PublicKey(targetPubkey), [targetPubkey]);
  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const lockedHeroes = useLockedHeroes();
  const [heroSlot, setHeroSlot] = useState(NO_HERO_SLOT);
  const [units, setUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [weapons, setWeapons] = useState<[number, number, number]>([0, 0, 0]);
  const [gatherMinutes, setGatherMinutes] = useState(15);

  useEffect(() => {
    setUnits([0, 0, 0]);
    setWeapons([0, 0, 0]);
    setHeroSlot(NO_HERO_SLOT);
  }, [targetPubkey]);

  // Chain stores units/weapons as u64; BN.toNumber() throws past 2^53.
  // Whales (legendary tier, long sessions) can plausibly accrue beyond
  // that, and the composer caps inputs via these counts — falling back
  // to MAX_SAFE_INTEGER means the input is bounded by Number range
  // rather than crashing the panel on a stat read.
  const ownedUnits: [number, number, number] = [
    bnToSafeNumber(player?.defensiveUnit1),
    bnToSafeNumber(player?.defensiveUnit2),
    bnToSafeNumber(player?.defensiveUnit3),
  ];
  const ownedWeapons: [number, number, number] = [
    bnToSafeNumber(player?.meleeWeapons),
    bnToSafeNumber(player?.rangedWeapons),
    bnToSafeNumber(player?.siegeWeapons),
  ];

  // Verify the target still exists on chain — surfaced if the user opens a
  // rally for an encounter that just despawned, or a castle account that
  // was closed in a transition. Stops the form from posting a tx that the
  // PDA-validation would bounce.
  const { data: targetAlive } = useQuery({
    queryKey: ["rally-composer", "target-alive", targetPubkey],
    queryFn: async () => {
      const info = await connection.getAccountInfo(targetKey);
      if (!info) return false;
      switch (targetType) {
        case 0:
          return !!parsePlayer(info);
        case 1:
          return !!parseEncounter(info);
        case 2:
          return !!parseCastle(info);
        default:
          return false;
      }
    },
    staleTime: 10_000,
  });

  const traveling = player ? isTraveling(player) : false;
  // Chain rally::create rejects with InsufficientUnits when units sum to
  // zero — weapons-only is not a valid commitment. Disable the submit so
  // the user can't burn a priority fee on a deterministic chain reject.
  const hasAnyUnit = units.some((n) => n > 0);
  const hasAnyCommitment = hasAnyUnit || weapons.some((n) => n > 0);
  const submitDisabled = !teamId || traveling || !hasAnyUnit || targetAlive === false;

  const handleCreate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    if (!teamId) throw new Error("You must be on a team to create a rally");
    if (!hasAnyUnit) throw new Error("Commit at least one defensive unit to the rally");
    const hero = heroSlot < 3 ? lockedHeroes[heroSlot] : null;
    const ix = createRallyCreateInstruction(
      {
        owner: publicKey,
        gameEngine: client.gameEngine,
        rallyId: player.rallyStats.totalRalliesCreated.toNumber(),
        target: targetKey,
        teamId: teamId.toNumber(),
        rallyCityId: player.currentCity,
      },
      {
        targetType: targetType as RallyTargetType,
        gatherDuration: gatherMinutes * 60,
        targetCityId,
        defensiveUnit1: units[0],
        defensiveUnit2: units[1],
        defensiveUnit3: units[2],
        meleeWeapons: weapons[0],
        rangedWeapons: weapons[1],
        siegeWeapons: weapons[2],
        heroSlotIndex: hero ? heroSlot : NO_HERO_SLOT,
        heroMint: hero?.mint,
        heroTemplateId: hero?.templateId,
      },
    );
    const sig = await transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: `Rally raised against ${targetLabel ?? TARGET_LABEL[targetType]}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
    // User may have closed the panel (or navigated away) during the
    // 30+s sign-confirm-invalidate cycle. Don't call close() on an
    // unmounted component — it's a no-op for the right-panel store
    // but would race with any subsequent panel push.
    if (isMounted.current) close();
    return sig;
  };

  // Submit lives on the MorphTabBar instead of inside the panel — Rally is
  // the panel's single primary action and matches the pattern used by the
  // rally detail / arena / dungeon panels.
  useMorphActions([
    {
      id: "raise-rally",
      label: "Raise Rally",
      variant: "primary",
      disabled: submitDisabled,
      onClick: handleCreate,
    },
  ]);

  // ─── Early states ───────────────────────────────────────────────

  if (!teamId) {
    return (
      <p className="text-sm text-text-muted">Join a team to raise a rally.</p>
    );
  }

  if (targetAlive === false) {
    return (
      <p className="text-sm text-text-muted">
        The target is no longer on the chain — pick another.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Target identity */}
      <div className="rounded-lg border border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          Target — {TARGET_LABEL[targetType] ?? "entity"}
        </div>
        <div className="text-sm text-text-primary">
          {targetLabel ?? `${TARGET_LABEL[targetType] ?? "entity"} in city ${targetCityId}`}
        </div>
      </div>

      {traveling && (
        <div className="rounded-lg border border-border-gold bg-accent/20 px-3 py-2 text-xs text-danger">
          You are currently traveling — rally creation may be restricted.
        </div>
      )}

      {/* Gather window */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Gather Window
        </div>
        <div className="mt-1 flex gap-2">
          {GATHER_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setGatherMinutes(m)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                gatherMinutes === m
                  ? "border-border-gold bg-accent/20 text-text-primary"
                  : "border-zinc-800 text-text-muted hover:border-zinc-700"
              }`}
            >
              {m < 60 ? `${m}m` : "1h"}
            </button>
          ))}
        </div>
      </div>

      {/* Units */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Defensive Units
        </div>
        <TripleCountInput
          labels={DEFENSIVE_UNIT_LABELS}
          icons={DEFENSIVE_UNIT_ICONS}
          available={ownedUnits}
          value={units}
          onChange={setUnits}
          dense
        />
      </div>

      {/* Weapons */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Weapons
        </div>
        <TripleCountInput
          labels={WEAPON_LABELS}
          icons={WEAPON_ICONS}
          available={ownedWeapons}
          value={weapons}
          onChange={setWeapons}
          dense
        />
      </div>

      {/* Hero buttons — only when the player has at least one locked hero. */}
      {lockedHeroes.some((h) => h !== null) && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Hero (optional)
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHeroSlot(NO_HERO_SLOT)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                heroSlot === NO_HERO_SLOT
                  ? "border-border-gold/50 bg-accent/30 text-text-gold"
                  : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
              }`}
            >
              None
            </button>
            {lockedHeroes.map((h, i) =>
              h ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => setHeroSlot(i)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    heroSlot === i
                      ? "border-border-gold/50 bg-accent/30 text-text-gold"
                      : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
                  }`}
                >
                  {h.name}
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      <TxButton
        onClick={handleCreate}
        disabled={submitDisabled}
        className="hidden md:block"
      >
        Raise Rally
      </TxButton>
    </div>
  );
}
